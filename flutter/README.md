# hospify_org_sdk

Hospify for Organisations SOS inside your own Flutter app. See https://developers.hospify.africa/docs/flutter

```dart
final hospify = Hospify.start(
  publishableKey: 'hpk_test_...',
  getToken: () => api.hospifyToken(),
);
hospify.sos.updates.listen((s) => print(s.responder));
await hospify.sos.start(note: 'Need help');
```
