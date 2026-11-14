/// A position from the device.
class LocationFix {
  final double latitude;
  final double longitude;
  final double? accuracyM;

  /// Battery percentage, 0 to 100, if known.
  final int? battery;
  const LocationFix({required this.latitude, required this.longitude, this.accuracyM, this.battery});

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        if (accuracyM != null) 'accuracy_m': accuracyM,
        if (battery != null) 'battery': battery,
      };
}

/// Where the agent is. [GeolocatorLocation] is the default; pass your own for anything else.
abstract class LocationProvider {
  /// One fix now, or null if location is off or refused.
  Future<LocationFix?> current();

  /// Continuous fixes while an SOS is open. Cancel the subscription to stop.
  Stream<LocationFix>? watch() => null;
}

/// What the agent's app sees about their own SOS.
class SosState {
  final String id;

  /// open, acknowledged, resolved or false_alarm.
  final String status;

  /// 0: the agent's supervisors; 1: every admin in the organisation.
  final int escalationStep;
  final bool livemode;
  final DateTime? acknowledgedAt;

  /// The supervisor who took it, by name.
  final String? responder;
  final DateTime? closedAt;

  /// resolved or false_alarm, once closed.
  final String? outcome;
  final DateTime? createdAt;

  const SosState({
    required this.id,
    required this.status,
    this.escalationStep = 0,
    this.livemode = false,
    this.acknowledgedAt,
    this.responder,
    this.closedAt,
    this.outcome,
    this.createdAt,
  });

  bool get isOpen => status == 'open' || status == 'acknowledged';

  static DateTime? _t(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

  factory SosState.fromJson(Map<String, dynamic> j) => SosState(
        id: j['id'] as String,
        status: j['status'] as String,
        escalationStep: (j['escalation_step'] as num?)?.toInt() ?? 0,
        livemode: j['livemode'] == true,
        acknowledgedAt: _t(j['acknowledged_at']),
        responder: j['responder'] as String?,
        closedAt: _t(j['closed_at']),
        outcome: j['outcome'] as String?,
        createdAt: _t(j['created_at']),
      );

  @override
  bool operator ==(Object other) =>
      other is SosState &&
      other.id == id &&
      other.status == status &&
      other.escalationStep == escalationStep &&
      other.responder == responder &&
      other.acknowledgedAt == acknowledgedAt &&
      other.closedAt == closedAt;

  @override
  int get hashCode => Object.hash(id, status, escalationStep, responder, acknowledgedAt, closedAt);
}

/// The signed-in agent.
class Agent {
  final String externalId;
  final String displayName;
  final String? team;
  final String? site;
  final bool active;
  final bool livemode;
  const Agent({required this.externalId, required this.displayName, this.team, this.site, this.active = true, this.livemode = false});

  factory Agent.fromJson(Map<String, dynamic> j) => Agent(
        externalId: j['external_id'] as String,
        displayName: j['display_name'] as String,
        team: j['team'] as String?,
        site: j['site'] as String?,
        active: j['active'] != false,
        livemode: j['livemode'] == true,
      );
}
