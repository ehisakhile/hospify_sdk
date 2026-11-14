import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hospify_org_sdk/hospify_org_sdk.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FixedLocation extends LocationProvider {
  @override
  Future<LocationFix?> current() async => const LocationFix(latitude: 6.6018, longitude: 3.3515, accuracyM: 12, battery: 41);
}

void main() {
  test('the app refuses a secret key', () {
    expect(() => Hospify.start(publishableKey: 'hsk_live_x', getToken: () async => 'hst_x'),
        throwsA(isA<HospifyError>().having((e) => e.code, 'code', 'invalid_key')));
  });

  test('an SOS sends the location and publishable key, refreshes an expired token, hears the responder and stops when safe', () async {
    final calls = <http.Request>[];
    var status = 'open';
    String? responder;
    var expiredOnce = true;
    Map<String, dynamic> sos() => {'id': 'inc_7', 'status': status, 'escalation_step': 0, 'livemode': false,
                                    'responder': responder, 'outcome': status == 'resolved' ? 'resolved' : null};
    final client = MockClient((req) async {
      calls.add(req);
      final json = (int code, Object? body) => http.Response(body == null ? '' : jsonEncode(body), code);
      if (req.url.path == '/v1/org/sos' && req.headers['Authorization'] == 'Bearer hst_old' && expiredOnce) {
        expiredOnce = false;
        return json(401, {'error': {'code': 'session_expired', 'message': 'expired'}});
      }
      if (req.url.path == '/v1/org/sos') return json(201, sos());
      if (req.url.path == '/v1/org/sos/inc_7') return json(200, sos());
      if (req.url.path == '/v1/org/sos/inc_7/location') return json(204, null);
      if (req.url.path == '/v1/org/sos/inc_7/safe') {
        status = 'resolved';
        return json(200, sos());
      }
      return json(404, {'error': {'code': 'not_found', 'message': 'no'}});
    });
    final tokens = ['hst_old', 'hst_new'];
    final hospify = Hospify.start(
      publishableKey: 'hpk_test_abc',
      getToken: () async => tokens.removeAt(0),
      location: FixedLocation(),
      locationEvery: const Duration(milliseconds: 20),
      pollEvery: const Duration(milliseconds: 20),
      httpClient: client,
    );
    final heard = <String?>[];
    hospify.sos.updates.listen((s) => heard.add(s.responder));

    final s = await hospify.sos.start(note: 'Need help');
    expect(s.id, 'inc_7');
    final sent = calls.where((c) => c.url.path == '/v1/org/sos').toList();
    expect(sent, hasLength(2));
    expect(sent[1].headers['Authorization'], 'Bearer hst_new');
    expect(sent[1].headers['Hospify-Publishable-Key'], 'hpk_test_abc');
    expect(jsonDecode(sent[1].body), containsPair('battery', 41));

    responder = 'Kunle Ade';
    await Future<void>.delayed(const Duration(milliseconds: 90));
    expect(heard, contains('Kunle Ade'));
    expect(calls.any((c) => c.url.path == '/v1/org/sos/inc_7/location'), isTrue);

    expect((await hospify.sos.safe()).status, 'resolved');
    final n = calls.length;
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(calls.length, n);
    hospify.stop();
  });
}
