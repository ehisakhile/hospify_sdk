import 'package:geolocator/geolocator.dart';

import 'models.dart';

/// Location from the geolocator plugin. Asks for permission the first time it's needed.
///
/// For location while the app is in the background during an SOS, add the background location
/// settings geolocator documents (Android foreground service, iOS "location" background mode).
class GeolocatorLocation extends LocationProvider {
  final Future<int?> Function()? battery;
  GeolocatorLocation({this.battery});

  bool? _allowed;

  Future<bool> _ok() async {
    if (_allowed == true) return true;
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    _allowed = p == LocationPermission.always || p == LocationPermission.whileInUse;
    return _allowed!;
  }

  Future<LocationFix> _fix(Position p) async => LocationFix(
        latitude: p.latitude,
        longitude: p.longitude,
        accuracyM: p.accuracy,
        battery: battery == null ? null : await battery!().catchError((_) => null),
      );

  @override
  Future<LocationFix?> current() async {
    try {
      if (!await _ok()) return null;
      final p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 8)),
      );
      return await _fix(p);
    } catch (_) {
      return null;
    }
  }

  @override
  Stream<LocationFix>? watch() => Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5),
      ).asyncMap(_fix);
}
