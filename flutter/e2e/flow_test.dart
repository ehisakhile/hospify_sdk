// End to end: the Flutter SDK against a local copy of the real Org API
// (hospify_api: .venv/bin/python -m tests.sdk_contract_server). Run:
//   HOSPIFY_E2E='<keys json>' flutter test e2e/flow_test.dart
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hospify_org_sdk/hospify_org_sdk.dart';
import 'package:http/http.dart' as http;

class FixedLocation extends LocationProvider {
  @override
  Future<LocationFix?> current() async => const LocationFix(latitude: 9.0765, longitude: 7.3986, accuracyM: 10);
}

void main() {
  final raw = Platform.environment['HOSPIFY_E2E'];
  test('Flutter SDK against the real API', () async {
    final keys = jsonDecode(raw!) as Map<String, dynamic>;
    final base = keys['base_url'] as String;
    Future<dynamic> server(String method, String path, [Object? body]) async {
      final r = await http.Request(method, Uri.parse('$base/v1/org$path'))
          .also((q) {
            q.headers.addAll({'Authorization': 'Bearer ${keys['secret']}', 'Content-Type': 'application/json'});
            if (body != null) q.body = jsonEncode(body);
          })
          .send();
      final text = await r.stream.bytesToString();
      return text.isEmpty ? null : jsonDecode(text);
    }

    await server('PUT', '/agents/AGT-ABJ-7', {'display_name': 'Agent Wuse', 'team': 'Abuja'});
    final hospify = Hospify.start(
      publishableKey: keys['publishable'] as String,
      getToken: () async => (await server('POST', '/agents/AGT-ABJ-7/sessions'))['token'] as String,
      location: FixedLocation(),
      baseUrl: base,
      locationEvery: const Duration(milliseconds: 200),
      pollEvery: const Duration(milliseconds: 200),
    );
    final heard = <String>[];
    hospify.sos.updates.listen((s) => heard.add(s.status));
    final s = await hospify.sos.start(note: 'Car followed me from the site');
    expect(s.status, 'open');
    await server('POST', '/incidents/${s.id}/acknowledge', {'by': 'Control room'});
    await Future<void>.delayed(const Duration(milliseconds: 700));
    expect(heard, contains('acknowledged'));
    final (agent, open) = await hospify.me();
    expect((agent.displayName, open?.id), ('Agent Wuse', s.id));
    expect((await hospify.sos.cancel()).outcome, 'false_alarm');
    final detail = await server('GET', '/incidents/${s.id}?trail=true');
    expect((detail['trail'] as List).length, greaterThanOrEqualTo(2));
    hospify.stop();
  }, skip: raw == null ? 'Set HOSPIFY_E2E to run against a local API' : false);
}

extension<T> on T {
  T also(void Function(T) f) {
    f(this);
    return this;
  }
}
