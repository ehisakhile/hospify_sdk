import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'errors.dart';
import 'geolocator_location.dart';
import 'models.dart';

const _version = '1.0.1';

/// Hospify SOS inside your app.
class Hospify {
  /// Your publishable key: hpk_test_... or hpk_live_...
  final String publishableKey;

  /// Asks YOUR server for a session token for the signed-in agent (it calls POST /v1/org/agents/{id}/sessions).
  final Future<String> Function() getToken;

  /// Where the agent is; null sends no location.
  final LocationProvider? location;

  /// How often to send location while an SOS is open.
  final Duration locationEvery;

  /// How often to check who's responding while an SOS is open.
  final Duration pollEvery;
  /// The API address. Leave the default.
  final String baseUrl;
  final http.Client _http;

  String? _token;
  Future<String>? _tokenFuture;
  late final Sos sos = Sos._(this);

  Hospify._(this.publishableKey, this.getToken, this.location, this.locationEvery, this.pollEvery, this.baseUrl, this._http);

  /// Starts the SDK. [location] defaults to [GeolocatorLocation]; pass `useLocation: false` to send none.
  factory Hospify.start({
    required String publishableKey,
    required Future<String> Function() getToken,
    LocationProvider? location,
    bool useLocation = true,
    Duration locationEvery = const Duration(seconds: 10),
    Duration pollEvery = const Duration(seconds: 5),
    String baseUrl = 'https://api.hospify.cloud',
    http.Client? httpClient,
  }) {
    if (!publishableKey.startsWith('hpk_')) {
      throw const HospifyError('invalid_key', 'Use your publishable key (hpk_test_... or hpk_live_...) in the app. Never the secret key.');
    }
    return Hospify._(publishableKey, getToken, useLocation ? (location ?? GeolocatorLocation()) : null, locationEvery, pollEvery,
        baseUrl.replaceAll(RegExp(r'/$'), ''), httpClient ?? http.Client());
  }

  /// True for hpk_test_ keys: the whole flow runs, nobody is alerted.
  bool get testMode => publishableKey.startsWith('hpk_test_');

  Future<String> _session({bool fresh = false}) {
    if (_token != null && !fresh) return Future.value(_token);
    return _tokenFuture ??= getToken().then((t) {
      _tokenFuture = null;
      if (!t.startsWith('hst_')) {
        throw const HospifyError('invalid_session', 'getToken must return the session token (hst_...) from your server.');
      }
      return _token = t;
    }, onError: (Object e) {
      _tokenFuture = null;
      throw e is HospifyError ? e : const HospifyError('token_failed', "Couldn't get a session token from your server.");
    });
  }

  /// An agent call. Refreshes the session token once if it has expired.
  Future<dynamic> request(String method, String path, [Map<String, dynamic>? body]) async {
    Future<dynamic> send(bool fresh) async {
      final token = await _session(fresh: fresh);
      final req = http.Request(method, Uri.parse('$baseUrl$path'))
        ..headers.addAll({
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
          'Hospify-Publishable-Key': publishableKey,
          'Hospify-Sdk': 'flutter/$_version',
          if (body != null) 'Content-Type': 'application/json',
        });
      if (body != null) req.body = jsonEncode(body);
      http.Response res;
      try {
        res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
      } catch (_) {
        throw const HospifyError('network_error', "Couldn't reach Hospify. Check the connection and try again.");
      }
      if (res.statusCode == 204) return null;
      dynamic data;
      try {
        data = res.body.isEmpty ? null : jsonDecode(res.body);
      } catch (_) {}
      if (res.statusCode >= 400) {
        final err = data is Map ? data['error'] : null;
        throw HospifyError(err is Map ? '${err['code']}' : 'http_error',
            err is Map ? '${err['message']}' : 'Hospify answered ${res.statusCode}.', res.statusCode);
      }
      return data;
    }

    try {
      return await send(false);
    } on HospifyError catch (e) {
      if (e.status == 401 && (e.code == 'session_expired' || e.code == 'invalid_session')) {
        _token = null;
        return send(true);
      }
      rethrow;
    }
  }

  /// The signed-in agent, and their open SOS if there is one.
  Future<(Agent, SosState?)> me() async {
    final d = (await request('GET', '/v1/org/me')) as Map<String, dynamic>;
    final open = d['open_sos'];
    return (Agent.fromJson((d['agent'] as Map).cast()), open is Map ? SosState.fromJson(open.cast()) : null);
  }

  /// Stops location and status timers (for example when the agent signs out).
  void stop() {
    sos.stopTracking();
    _token = null;
  }
}

/// The agent's SOS.
class Sos {
  final Hospify _h;
  Sos._(this._h);

  SosState? _state;
  final _updates = StreamController<SosState>.broadcast();
  Timer? _locationTimer;
  Timer? _pollTimer;
  StreamSubscription<LocationFix>? _watch;
  LocationFix? _lastFix;
  bool _sending = false;

  /// The SOS as last seen, or null.
  SosState? get current => _state;
  /// True while the SOS is open or acknowledged.
  bool get isOpen => _state?.isOpen ?? false;

  /// Every change: acknowledged, escalated, closed.
  Stream<SosState> get updates => _updates.stream;

  /// Raises an SOS (or updates the agent's open one) with their location, then keeps sending location
  /// and checking who is responding until it's closed.
  Future<SosState> start({String? note}) async {
    final fix = await _h.location?.current().catchError((_) => null);
    if (fix != null) _lastFix = fix;
    final d = await _h.request('POST', '/v1/org/sos', {
      if (note != null) 'note': note,
      if (fix != null) ...fix.toJson(),
    });
    _set(SosState.fromJson((d as Map).cast()));
    _track();
    return _state!;
  }

  /// The agent is safe: closes the SOS and tells everyone who was alerted.
  Future<SosState> safe({String? note}) => _close('safe', note);

  /// Raised by mistake: closes it as a false alarm and tells everyone who was alerted.
  Future<SosState> cancel({String? note}) => _close('cancel', note);

  /// After an app restart: picks up an SOS that's still open and carries on tracking it.
  Future<SosState?> resume() async {
    final (_, open) = await _h.me();
    if (open != null) {
      _set(open);
      _track();
    }
    return open;
  }

  /// Asks Hospify now: is anyone responding?
  Future<SosState?> refresh() async {
    if (_state == null) return null;
    final d = await _h.request('GET', '/v1/org/sos/${_state!.id}');
    _set(SosState.fromJson((d as Map).cast()));
    return _state;
  }

  /// Stops sending location and checking status, without closing the SOS.
  void stopTracking() {
    _locationTimer?.cancel();
    _pollTimer?.cancel();
    _watch?.cancel();
    _locationTimer = _pollTimer = null;
    _watch = null;
  }

  Future<SosState> _close(String action, String? note) async {
    if (_state == null) throw const HospifyError('no_sos', "There's no SOS to close.");
    final d = await _h.request('POST', '/v1/org/sos/${_state!.id}/$action', {if (note != null) 'note': note});
    _set(SosState.fromJson((d as Map).cast()));
    stopTracking();
    return _state!;
  }

  void _set(SosState s) {
    final changed = s != _state;
    _state = s;
    if (changed) _updates.add(s);
    if (!s.isOpen) stopTracking();
  }

  void _track() {
    if (!isOpen || _pollTimer != null) return;
    final loc = _h.location;
    if (loc != null) {
      _watch = loc.watch()?.listen((f) => _lastFix = f, onError: (_) {});
      _locationTimer = Timer.periodic(_h.locationEvery, (_) => _sendLocation());
    }
    _pollTimer = Timer.periodic(_h.pollEvery, (_) => refresh().catchError((_) => _state));
  }

  Future<void> _sendLocation() async {
    final loc = _h.location;
    if (_state == null || _sending || loc == null) return;
    _sending = true;
    try {
      final fix = (_watch != null && _lastFix != null) ? _lastFix : await loc.current();
      if (fix == null) return;
      _lastFix = fix;
      await _h.request('POST', '/v1/org/sos/${_state!.id}/location', fix.toJson());
    } on HospifyError catch (e) {
      if (e.code == 'incident_closed') await refresh().catchError((_) => _state);
    } catch (_) {
    } finally {
      _sending = false;
    }
  }
}
