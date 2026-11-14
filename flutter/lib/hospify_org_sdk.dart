/// Hospify for Organisations SOS inside your own Flutter app.
///
/// ```dart
/// final hospify = Hospify.start(
///   publishableKey: 'hpk_test_...',
///   getToken: () => api.hospifyToken(), // your server: POST /v1/org/agents/{id}/sessions
/// );
/// await hospify.sos.start(note: 'Need help');
/// ```
///
/// Docs: https://developers.hospify.africa/docs/sdks/flutter
library hospify_org_sdk;

export 'src/client.dart';
export 'src/errors.dart';
export 'src/geolocator_location.dart';
export 'src/models.dart';
