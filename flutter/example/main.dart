// A field agent's SOS screen. Your app signs the agent in as it always does; your server gives
// it a Hospify session token (POST /v1/org/agents/{id}/sessions with your secret key).
//
// Built from the basic widgets library so it runs on any Flutter version; in your app use your
// own design system's buttons.
import 'package:flutter/widgets.dart';
import 'package:hospify_org_sdk/hospify_org_sdk.dart';

/// Replace with a call to your own server.
Future<String> fetchHospifyToken() async => throw UnimplementedError('Ask your server for an hst_ token');

const _red = Color(0xFFD92D20);
const _green = Color(0xFF16A34A);

void main() => runApp(WidgetsApp(
      color: _green,
      builder: (_, __) => const SosScreen(),
    ));

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

  Widget _button(String label, Color color, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.only(top: 12),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
          child: Text(label, style: const TextStyle(color: Color(0xFFFFFFFF), fontWeight: FontWeight.bold)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final open = sos?.isOpen ?? false;
    final status = !open
        ? 'Hold the button if you need help'
        : sos!.responder != null
            ? '${sos!.responder} is on it'
            : 'Alert sent. Waiting for a supervisor';
    return Container(
      color: const Color(0xFFFFFFFF),
      alignment: Alignment.center,
      child: DefaultTextStyle(
        style: const TextStyle(color: Color(0xFF111111), fontSize: 18),
        textAlign: TextAlign.center,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (hospify.testMode) const Text('Test mode: nobody is alerted', style: TextStyle(fontSize: 13)),
          Padding(padding: const EdgeInsets.all(24), child: Text(status)),
          if (!open)
            GestureDetector(
              onLongPress: () => _run(() => hospify.sos.start(note: 'Need help')),
              child: Container(
                width: 144,
                height: 144,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: _red, shape: BoxShape.circle),
                child: const Text('SOS', style: TextStyle(fontSize: 32, color: Color(0xFFFFFFFF))),
              ),
            )
          else ...[
            _button("I'm safe", _green, () => _run(hospify.sos.safe)),
            _button('Raised by mistake', const Color(0xFF666666), () => _run(hospify.sos.cancel)),
          ],
          if (error != null) Padding(padding: const EdgeInsets.all(16), child: Text(error!, style: const TextStyle(color: _red))),
        ]),
      ),
    );
  }
}
