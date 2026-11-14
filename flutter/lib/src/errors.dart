/// Every failed call: the API's error code (for example `kyb_required`), a message for people, and the HTTP status.
class HospifyError implements Exception {
  /// The API's error code, for example `kyb_required` or `network_error`.
  final String code;

  /// What went wrong, in words you can show people.
  final String message;

  /// The HTTP status, or 0 when Hospify wasn't reached.
  final int status;

  /// An error with [code], [message] and the HTTP [status].
  const HospifyError(this.code, this.message, [this.status = 0]);

  @override
  String toString() => 'HospifyError($code): $message';
}
