import { UserRole } from './solar';

export type WorkforceLiveStatus = 'online' | 'moving' | 'idle' | 'offline';

export type RealtimeTransportState =
  | 'pusher-connected'
  | 'pusher-connecting'
  | 'sse-fallback'
  | 'disconnected';

export type PusherConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | RealtimeTransportState;

// Centralized timing constants for presence & heartbeat
export const PRESENCE_TIMEOUT_MS = 120 * 1000; // 120 seconds timeout with clock skew tolerance
export const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 20 seconds heartbeat interval

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
}

export interface LocationUpdatePayload {
  userId: string;
  employeeCode?: string;
  name?: string;
  role?: string;
  latitude: number;
  longitude: number;
  accuracy?: number; // in meters
  heading?: number; // in degrees
  speed?: number; // in km/h
  timestamp?: string; // ISO string
  activity?: string;
  batteryLevel?: number;
}

export interface PresenceUpdatePayload {
  userId: string;
  alternateUserId?: string;
  employeeCode?: string;
  name?: string;
  email?: string;
  role?: string;
  isOnline: boolean;
  lastSeenAt: string;
  isSharingLocation?: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  status?: WorkforceLiveStatus;
}

export interface LiveEmployeeLocation {
  userId: string;
  employeeCode?: string;
  name: string;
  email?: string;
  role: UserRole | string;
  avatar?: string;
  phone: string;
  department: string;
  designation?: string;
  
  // Real Presence & Location Sharing State
  isOnline: boolean;
  isSharingLocation: boolean;
  lastSeenAt?: string;

  // Real GPS Coordinates (undefined when no real location broadcasted)
  latitude?: number;
  longitude?: number;
  hasLocation: boolean;
  
  accuracy?: number; // in meters
  heading?: number; // in degrees (0-360)
  speed?: number; // in km/h
  updatedAt: string; // ISO timestamp
  status: WorkforceLiveStatus;
  
  // Assigned Project & Site
  assignedProjectId?: string;
  assignedProjectCode?: string;
  assignedProjectTitle?: string;
  assignedCustomerName?: string;
  assignedSiteAddress?: string;
  assignedSiteCoordinates?: LocationCoordinates;
  distanceToSiteKm?: number;
  estimatedArrivalMinutes?: number;

  // Additional telemetry
  batteryLevel?: number; // percentage (0-100)
  currentActivity?: string; // e.g. "En route to ABC Industries", "Executing Site Survey", "Inspecting Inverter"
  lastLocationAddress?: string;
}

export interface TrackingFilterOptions {
  searchQuery: string;
  status: 'ALL' | 'online' | 'moving' | 'idle' | 'offline';
  role: string; // 'ALL' or specific role
  assignment: 'ALL' | 'ASSIGNED' | 'UNASSIGNED';
}

export interface LiveTrackingStats {
  totalEligible: number;
  onlineCount: number;
  movingCount: number;
  idleCount: number;
  offlineCount: number;
  assignedCount: number;
}

// Configurable eligible field worker roles
export const ELIGIBLE_FIELD_ROLES: string[] = [
  'Site Survey Engineer',
  'Site Inspector',
  'Civil Team',
  'Civil Engineer',
  'Structure Team',
  'Structure Engineer',
  'Installation Team',
  'Installation Engineer',
  'Electrical Team',
  'Electrical Engineer',
  'Project Engineer',
  'Technician',
  'Service Engineer',
  'Service Manager'
];
