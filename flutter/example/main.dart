// A field agent's SOS screen. Your app signs the agent in as it always does; your server gives
// it a Hospify session token (POST /v1/org/agents/{id}/sessions with your secret key).
import 'package:flutter/material.dart';
import 'package:hospify_org_sdk/hospify_org_sdk.dart';

/// Replace with a call to your own server.
Future<String> fetchHospifyToken() async => throw UnimplementedError('Ask your server for an hst_ token');

void main() => runApp(const MaterialApp(home: SosScreen()));

/// One button: hold to raise an SOS, then see who is responding.
class SosScreen extends StatefulWidget {
  /// The screen.
  const SosScreen({super.key});

  @override
  State<SosScreen> createState() => _SosScreenState();
}

class _SosScreenState extends State<SosScreen> {
  final hospify = Hospify.start(publishableKey: 'hpk_test_...', getToken: fetchHospifyToken);
  SosState? sos;
  String? error;

  @override
  void initState() {
    super.initState();
    hospify.sos.updates.listen((s) => setState(() => sos = s));
    hospify.sos.resume(); // picks up an SOS left open before the app restarted
  }

  @override
  void dispose() {
    hospify.stop();
    super.dispose();
  }

  Future<void> _run(Future<SosState> Function() action) async {
    try {
      final s = await action();
      setState(() {
        sos = s;
        error = null;
      });
    } on HospifyError catch (e) {
      setState(() => error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final open = sos?.isOpen ?? false;
    final status = !open
        ? 'Hold the button if you need help'
        : sos!.responder != null
            ? '${sos!.responder} is on it'
            : 'Alert sent. Waiting for a supervisor';
    return Scaffold(
      appBar: AppBar(title: Text(hospify.testMode ? 'SOS (test mode)' : 'SOS')),
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(status, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 24),
          if (!open)
            GestureDetector(
              onLongPress: () => _run(() => hospify.sos.start(note: 'Need help')),
              child: const CircleAvatar(radius: 72, backgroundColor: Colors.red, child: Text('SOS', style: TextStyle(fontSize: 32, color: Colors.white))),
            )
          else ...[
            FilledButton(onPressed: () => _run(hospify.sos.safe), child: const Text("I'm safe")),
            TextButton(onPressed: () => _run(hospify.sos.cancel), child: const Text('Raised by mistake')),
          ],
          if (error != null) Padding(padding: const EdgeInsets.all(16), child: Text(error!, style: const TextStyle(color: Colors.red))),
        ]),
      ),
    );
  }
}
