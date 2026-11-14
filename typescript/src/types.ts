/** What the Hospify for Organisations API sends back. Times are ISO 8601 in UTC. */

export interface Agent {
  external_id: string;
  display_name: string;
  team: string | null;
  site: string | null;
  active: boolean;
  livemode: boolean;
  last_active_at: string | null;
  created_at: string | null;
}

export interface Location {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  /** NIPOST building postcode at that spot, when known. */
  postcode: string | null;
  at: string | null;
}

export type IncidentStatus = "open" | "acknowledged" | "resolved" | "false_alarm";

export interface Incident {
  id: string;
  status: IncidentStatus;
  /** 0: the agent's supervisors; 1: every admin in the organisation. */
  escalation_step: number;
  livemode: boolean;
  agent: { external_id: string; display_name: string } | null;
  staff: { name: string } | null;
  team: string | null;
  site: string | null;
  note: string | null;
  location: Location | null;
  battery: number | null;
  acknowledged_at: string | null;
  /** The supervisor who took it, by name. */
  responder: string | null;
  closed_at: string | null;
  outcome: "resolved" | "false_alarm" | null;
  resolution_note: string | null;
  created_at: string | null;
  timeline?: { kind: string; note: string | null; at: string | null; by: string | null }[];
  trail?: { lat: number; lng: number; accuracy_m: number | null; at: string | null }[];
}

/** What the agent's app sees about their own SOS. */
export interface SosState {
  id: string;
  status: IncidentStatus;
  escalation_step: number;
  livemode: boolean;
  acknowledged_at: string | null;
  responder: string | null;
  closed_at: string | null;
  outcome: "resolved" | "false_alarm" | null;
  created_at: string | null;
}

export type EventType =
  | "incident.created"
  | "incident.location"
  | "incident.acknowledged"
  | "incident.escalated"
  | "incident.note"
  | "incident.safe"
  | "incident.resolved"
  | "checkin.missed"
  | "ping";

export interface HospifyEvent<T = Incident> {
  id: string;
  type: EventType;
  livemode: boolean;
  created_at: string;
  data: T;
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next?: string | null;
}
