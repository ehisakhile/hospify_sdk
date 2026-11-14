/// Every failed call: the API's error code (for example `kyb_required`), a message for people, and the HTTP status.
class HospifyError implements Exception {
  final String code;
  final String message;
  final int status;
  const HospifyError(this.code, this.message, [this.status = 0]);

  @override
  String toString() => 'HospifyError($code): $message';
}
