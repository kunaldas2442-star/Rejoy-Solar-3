import { storageService } from './storage';
import { pusherService } from './pusherService';
import {
  LiveEmployeeLocation,
  WorkforceLiveStatus,
  ELIGIBLE_FIELD_ROLES,
  LocationUpdatePayload,
  PresenceUpdatePayload,
  PRESENCE_TIMEOUT_MS
} from '../types/tracking';

const REAL_LOCATIONS_STORAGE_KEY = 'solarpulse_real_employee_locations_v1';

// Haversine formula to calculate accurate distance between coordinates (in km)
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance * 10) / 10;
}

// Convert relative timestamp to human readable format ("Just now", "8 sec ago", etc.)
export function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return 'No updates';
  try {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    if (isNaN(diffMs)) return 'Recently';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5) return 'Just now';
    if (diffSec < 60) return `${diffSec} sec ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} hr ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  } catch {
    return 'Recently';
  }
}

class LiveLocationService {
  private employeeLocations: Map<string, LiveEmployeeLocation> = new Map();
  // Alias map to resolve by email, employeeCode, or authUid to the primary employee id
  private alternateIdMap: Map<string, string> = new Map();
  private listeners: Set<(locations: LiveEmployeeLocation[]) => void> = new Set();
  private unsubscribeLocationPusher: (() => void) | null = null;
  private unsubscribePresencePusher: (() => void) | null = null;
  private staleCheckTimer: any = null;
  private isInitialFetched = false;

  constructor() {
    this.initializeFieldWorkers();

    // 1. Listen to real-time location stream from Pusher
    this.unsubscribeLocationPusher = pusherService.onLocationUpdate((payload) => {
      this.handleIncomingLocation(payload);
    });

    // 2. Listen to real-time presence stream from Pusher
    this.unsubscribePresencePusher = pusherService.onPresenceUpdate((payload) => {
      this.handleIncomingPresence(payload);
    });

    // 3. Periodic stale presence checker (marks offline if heartbeat expires)
    if (typeof window !== 'undefined') {
      this.staleCheckTimer = setInterval(() => {
        this.checkStaleLocations();
      }, 15000);

      // Perform initial load from server
      this.fetchServerLocations();
    }
  }

  // Check whether an employee role is eligible for field tracking
  isEligibleFieldWorker(role: string, department?: string): boolean {
    if (!role) return false;
    const normalizedRole = role.toLowerCase().trim();
    const normalizedDept = (department || '').toLowerCase().trim();

    // Disqualify customer and office-only roles
    if (
      normalizedRole.includes('customer') ||
      normalizedRole.includes('accountant') ||
      normalizedRole.includes('finance') ||
      normalizedRole.includes('hr') ||
      normalizedRole.includes('director') ||
      normalizedRole.includes('executive assistant') ||
      normalizedDept.includes('hr') ||
      normalizedDept.includes('finance') ||
      normalizedDept.includes('accounting')
    ) {
      return false;
    }

    // Match against eligible field worker titles
    return (
      ELIGIBLE_FIELD_ROLES.some((r) =>
        normalizedRole.includes(r.toLowerCase())
      ) ||
      normalizedDept.includes('engineering') ||
      normalizedDept.includes('operation') ||
      normalizedDept.includes('installation') ||
      normalizedDept.includes('electrical') ||
      normalizedDept.includes('civil') ||
      normalizedDept.includes('structure') ||
      normalizedDept.includes('service')
    );
  }

  private isLocationSharing: boolean = false;

  public setLocationSharingActive(active: boolean) {
    this.isLocationSharing = active;
  }

  public isLocationSharingActive(): boolean {
    return this.isLocationSharing;
  }

  /**
   * Resolves any user identifier (emp-id, email, code, auth uid) to canonical employee ID
   */
  public resolveCanonicalId(rawId: string, email?: string, employeeCode?: string, alternateUserId?: string): string {
    const cleanId = rawId ? rawId.trim().toLowerCase() : '';
    const cleanAlt = alternateUserId ? alternateUserId.trim().toLowerCase() : '';
    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanCode = employeeCode ? employeeCode.trim().toLowerCase() : '';

    if (!cleanId && !cleanEmail && !cleanCode && !cleanAlt) return rawId || '';

    // Direct match in active memory
    if (rawId && this.employeeLocations.has(rawId)) return rawId;
    if (alternateUserId && this.employeeLocations.has(alternateUserId)) return alternateUserId;

    // Check alias maps
    if (cleanId && this.alternateIdMap.has(cleanId)) return this.alternateIdMap.get(cleanId)!;
    if (cleanAlt && this.alternateIdMap.has(cleanAlt)) return this.alternateIdMap.get(cleanAlt)!;
    if (cleanEmail && this.alternateIdMap.has(cleanEmail)) return this.alternateIdMap.get(cleanEmail)!;
    if (cleanCode && this.alternateIdMap.has(cleanCode)) return this.alternateIdMap.get(cleanCode)!;

    // Search active locations in memory by email or employeeCode
    for (const [id, emp] of this.employeeLocations.entries()) {
      if (cleanEmail && emp.email && emp.email.trim().toLowerCase() === cleanEmail) {
        if (cleanId) this.alternateIdMap.set(cleanId, id);
        if (cleanAlt) this.alternateIdMap.set(cleanAlt, id);
        return id;
      }
      if (cleanCode && emp.employeeCode && emp.employeeCode.trim().toLowerCase() === cleanCode) {
        if (cleanId) this.alternateIdMap.set(cleanId, id);
        if (cleanAlt) this.alternateIdMap.set(cleanAlt, id);
        return id;
      }
    }

    // Search storageService employees for canonical mapping
    try {
      const allEmployees = storageService.getEmployees();
      for (const emp of allEmployees) {
        const empId = emp.id;
        const matchEmail = cleanEmail && emp.email && emp.email.trim().toLowerCase() === cleanEmail;
        const matchCode = cleanCode && emp.employeeCode && emp.employeeCode.trim().toLowerCase() === cleanCode;
        const matchAuth = (cleanId && emp.authUid && emp.authUid.trim().toLowerCase() === cleanId) ||
                          (cleanAlt && emp.authUid && emp.authUid.trim().toLowerCase() === cleanAlt);
        const matchId = (cleanId && emp.id && emp.id.trim().toLowerCase() === cleanId) ||
                        (cleanAlt && emp.id && emp.id.trim().toLowerCase() === cleanAlt);

        if (matchEmail || matchCode || matchAuth || matchId) {
          if (cleanId) this.alternateIdMap.set(cleanId, empId);
          if (cleanAlt) this.alternateIdMap.set(cleanAlt, empId);
          if (cleanEmail) this.alternateIdMap.set(cleanEmail, empId);
          if (cleanCode) this.alternateIdMap.set(cleanCode, empId);
          return empId;
        }
      }
    } catch {
      // Non-blocking
    }

    return rawId;
  }

  private initializeFieldWorkers() {
    const allEmployees = storageService.getEmployees();
    const allProjects = storageService.getProjects();

    // Map alternate IDs for all workforce members first for universal resolution
    allEmployees.forEach((emp) => {
      if (emp.id) this.alternateIdMap.set(emp.id.toLowerCase(), emp.id);
      if (emp.employeeCode) this.alternateIdMap.set(emp.employeeCode.toLowerCase(), emp.id);
      if (emp.email) this.alternateIdMap.set(emp.email.toLowerCase(), emp.id);
      if (emp.authUid) this.alternateIdMap.set(emp.authUid.toLowerCase(), emp.id);
    });

    // Load any cached locations from previous local session
    let savedLocations: Record<string, Partial<LiveEmployeeLocation>> = {};
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(REAL_LOCATIONS_STORAGE_KEY);
        if (raw) {
          savedLocations = JSON.parse(raw);
        }
      } catch (e) {
        console.warn('Could not read saved locations from storage:', e);
      }
    }

    // Initialize all existing staff in the system so Admin has baseline metadata
    allEmployees.forEach((emp) => {
      // Find assigned solar project if available
      const assignedProject = allProjects.find(
        (p) =>
          p.projectManagerId === emp.id ||
          (p.assignedUsers && p.assignedUsers.some((u) => u.userId === emp.id))
      );

      // Check for real GPS fix from saved cache
      const cached = savedLocations[emp.id];
      const hasRealCoordinates =
        cached &&
        typeof cached.latitude === 'number' &&
        typeof cached.longitude === 'number';

      const lastSeenMs = cached?.lastSeenAt ? new Date(cached.lastSeenAt).getTime() : 0;
      const isOnline = lastSeenMs > 0 && Date.now() - lastSeenMs < PRESENCE_TIMEOUT_MS;

      const record: LiveEmployeeLocation = {
        userId: emp.id,
        employeeCode: emp.employeeCode || emp.id,
        name: emp.name,
        email: emp.email,
        role: emp.systemRole || emp.designation || 'Field Worker',
        avatar: emp.photoUrl,
        phone: emp.phone,
        department: emp.department,
        designation: emp.designation,

        isOnline,
        isSharingLocation: cached?.isSharingLocation ?? false,
        lastSeenAt: cached?.lastSeenAt,

        latitude: hasRealCoordinates ? cached.latitude : undefined,
        longitude: hasRealCoordinates ? cached.longitude : undefined,
        hasLocation: Boolean(hasRealCoordinates),

        accuracy: hasRealCoordinates ? cached.accuracy : undefined,
        heading: hasRealCoordinates ? cached.heading : undefined,
        speed: hasRealCoordinates ? cached.speed : undefined,
        updatedAt: cached?.updatedAt || new Date().toISOString(),

        status: !isOnline
          ? 'offline'
          : hasRealCoordinates
          ? ((cached?.speed || 0) > 3 ? 'moving' : 'idle')
          : 'online',

        batteryLevel: cached?.batteryLevel,
        currentActivity: !hasRealCoordinates
          ? (isOnline ? 'Online • Location Standby' : 'Location unavailable')
          : cached?.currentActivity || 'Field Operations',
        lastLocationAddress: cached?.lastLocationAddress
      };

      if (assignedProject) {
        record.assignedProjectId = assignedProject.id;
        record.assignedProjectCode = assignedProject.projectCode;
        record.assignedProjectTitle = `${assignedProject.capacityKw} kW ${assignedProject.systemType || 'Solar EPC'} - ${assignedProject.customerName}`;
        record.assignedCustomerName = assignedProject.customerName;
        record.assignedSiteAddress = assignedProject.siteAddress || assignedProject.city;

        if (assignedProject.latitude && assignedProject.longitude) {
          record.assignedSiteCoordinates = {
            latitude: assignedProject.latitude,
            longitude: assignedProject.longitude
          };
          if (record.hasLocation && record.latitude !== undefined && record.longitude !== undefined) {
            record.distanceToSiteKm = calculateDistanceKm(
              record.latitude,
              record.longitude,
              assignedProject.latitude,
              assignedProject.longitude
            );
          }
        }
      }

      this.employeeLocations.set(emp.id, record);
    });
  }

  /**
   * Admin Initial Load: Fetch latest known locations & presence from central server
   */
  async fetchServerLocations(): Promise<void> {
    try {
      const res = await fetch('/api/workforce/locations');
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success || !Array.isArray(data.locations)) return;

      const now = Date.now();

      // Process and deduplicate server records
      data.locations.forEach((srv: any) => {
        if (!srv || !srv.userId) return;
        const targetId = this.resolveCanonicalId(srv.userId, srv.email, srv.employeeCode);
        const existing = this.employeeLocations.get(targetId);

        const hasCoords = typeof srv.latitude === 'number' && typeof srv.longitude === 'number';
        const lastSeenMs = srv.lastSeenAt ? new Date(srv.lastSeenAt).getTime() : 0;
        const existingLastSeenMs = existing?.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;

        // Guard against older server snapshot clobbering newer local presence fix
        if (existing && existing.isOnline && srv.lastSeenAt && lastSeenMs < existingLastSeenMs && !srv.isOnline) {
          return;
        }

        // Presence is online if server marked online or within timeout window
        const isOnline = Boolean(srv.isOnline) || (lastSeenMs > 0 && Math.abs(now - lastSeenMs) < PRESENCE_TIMEOUT_MS);
        const effectiveLastSeen = srv.lastSeenAt || existing?.lastSeenAt || new Date().toISOString();

        if (existing) {
          // Always apply authoritative server presence state
          existing.isOnline = isOnline;
          existing.lastSeenAt = effectiveLastSeen;

          if (typeof srv.isSharingLocation === 'boolean') {
            existing.isSharingLocation = srv.isSharingLocation;
          }
          if (srv.name && (!existing.name || existing.name.startsWith('Field Worker ('))) {
            existing.name = srv.name;
          }
          if (srv.role) existing.role = srv.role;
          if (srv.employeeCode && (!existing.employeeCode || existing.employeeCode === existing.userId)) {
            existing.employeeCode = srv.employeeCode;
          }
          if (srv.email && !existing.email) existing.email = srv.email;

          if (hasCoords) {
            existing.latitude = srv.latitude;
            existing.longitude = srv.longitude;
            existing.hasLocation = true;
            existing.accuracy = srv.accuracy;
            existing.heading = srv.heading;
            existing.speed = srv.speed;
            existing.batteryLevel = srv.batteryLevel ?? existing.batteryLevel;
            existing.currentActivity = srv.activity || existing.currentActivity;
            existing.updatedAt = srv.updatedAt || effectiveLastSeen;

            if (existing.assignedSiteCoordinates) {
              existing.distanceToSiteKm = calculateDistanceKm(
                srv.latitude,
                srv.longitude,
                existing.assignedSiteCoordinates.latitude,
                existing.assignedSiteCoordinates.longitude
              );
            }
          }

          // Presence is independent of GPS: online employees without GPS are status 'online'
          existing.status = !isOnline
            ? 'offline'
            : existing.hasLocation && typeof existing.latitude === 'number'
            ? ((existing.speed || 0) > 3 ? 'moving' : 'idle')
            : 'online';

          if (!existing.hasLocation && isOnline) {
            existing.currentActivity = existing.isSharingLocation
              ? 'Online • Awaiting GPS fix'
              : 'Online • Standby';
          }

          this.employeeLocations.set(targetId, { ...existing });
        } else {
          // Add newly discovered worker dynamically even if not in storage
          const newRecord: LiveEmployeeLocation = {
            userId: targetId,
            employeeCode: srv.employeeCode || targetId,
            name: srv.name || `Field Worker (${targetId.slice(0, 6)})`,
            email: srv.email,
            role: srv.role || 'Field Engineer',
            phone: '+91 98250 00000',
            department: 'Operations',
            isOnline,
            isSharingLocation: srv.isSharingLocation ?? true,
            lastSeenAt: effectiveLastSeen,
            latitude: hasCoords ? srv.latitude : undefined,
            longitude: hasCoords ? srv.longitude : undefined,
            hasLocation: hasCoords,
            accuracy: srv.accuracy,
            heading: srv.heading,
            speed: srv.speed,
            batteryLevel: srv.batteryLevel,
            currentActivity: !isOnline
              ? 'Offline'
              : hasCoords
              ? (srv.speed && srv.speed > 3 ? 'In Transit / Moving' : 'On Site / Active')
              : (srv.isSharingLocation ? 'Online • Awaiting GPS fix' : 'Online • Standby'),
            updatedAt: srv.updatedAt || effectiveLastSeen,
            status: !isOnline ? 'offline' : hasCoords ? ((srv.speed || 0) > 3 ? 'moving' : 'idle') : 'online'
          };
          this.employeeLocations.set(targetId, newRecord);
          this.alternateIdMap.set(targetId.toLowerCase(), targetId);
          if (srv.userId && srv.userId !== targetId) {
            this.alternateIdMap.set(srv.userId.toLowerCase(), targetId);
          }
          if (srv.email) this.alternateIdMap.set(srv.email.toLowerCase(), targetId);
          if (srv.employeeCode) this.alternateIdMap.set(srv.employeeCode.toLowerCase(), targetId);
        }
      });

      this.isInitialFetched = true;
      this.notifyListeners();
    } catch (err) {
      console.warn('[Workforce] Could not fetch server locations:', err);
    }
  }

  /**
   * Process Real-Time GPS Location updates from Pusher / SSE
   */
  private handleIncomingLocation(payload: LocationUpdatePayload) {
    if (!payload || !payload.userId || typeof payload.latitude !== 'number' || typeof payload.longitude !== 'number') {
      return;
    }

    const canonicalId = this.resolveCanonicalId(payload.userId, undefined, payload.employeeCode);
    const existing = this.employeeLocations.get(canonicalId);
    const speed = payload.speed !== undefined ? payload.speed : 0;
    const isMoving = speed > 3;
    const timestamp = payload.timestamp || new Date().toISOString();

    let updated: LiveEmployeeLocation;

    if (existing) {
      updated = {
        ...existing,
        latitude: payload.latitude,
        longitude: payload.longitude,
        hasLocation: true,
        isOnline: true,
        isSharingLocation: true,
        accuracy: payload.accuracy,
        heading: payload.heading,
        speed: payload.speed,
        batteryLevel: payload.batteryLevel ?? existing.batteryLevel,
        currentActivity: payload.activity || (isMoving ? 'In Transit / Moving' : 'On Site / Active'),
        updatedAt: timestamp,
        lastSeenAt: timestamp,
        status: isMoving ? 'moving' : 'idle'
      };

      if (payload.name && (!updated.name || updated.name.startsWith('Field Worker ('))) {
        updated.name = payload.name;
      }
      if (payload.role) updated.role = payload.role;
      if (payload.employeeCode && (!updated.employeeCode || updated.employeeCode === updated.userId)) {
        updated.employeeCode = payload.employeeCode;
      }

      if (updated.assignedSiteCoordinates) {
        updated.distanceToSiteKm = calculateDistanceKm(
          payload.latitude,
          payload.longitude,
          updated.assignedSiteCoordinates.latitude,
          updated.assignedSiteCoordinates.longitude
        );
      }
      this.employeeLocations.set(canonicalId, updated);
    } else {
      // Dynamic worker entry if not previously configured
      updated = {
        userId: canonicalId,
        employeeCode: payload.employeeCode || canonicalId,
        name: payload.name || `Field Worker (${canonicalId.slice(0, 6)})`,
        role: payload.role || 'Field Engineer',
        phone: '+91 98250 00000',
        department: 'Operations',
        isOnline: true,
        isSharingLocation: true,
        latitude: payload.latitude,
        longitude: payload.longitude,
        hasLocation: true,
        accuracy: payload.accuracy,
        heading: payload.heading,
        speed: payload.speed,
        batteryLevel: payload.batteryLevel,
        currentActivity: payload.activity || (isMoving ? 'In Transit' : 'Active'),
        updatedAt: timestamp,
        lastSeenAt: timestamp,
        status: isMoving ? 'moving' : 'idle'
      };
      this.employeeLocations.set(canonicalId, updated);
      this.alternateIdMap.set(canonicalId.toLowerCase(), canonicalId);
      if (payload.userId !== canonicalId) {
        this.alternateIdMap.set(payload.userId.toLowerCase(), canonicalId);
      }
      if (payload.employeeCode) {
        this.alternateIdMap.set(payload.employeeCode.toLowerCase(), canonicalId);
      }
    }

    this.persistRealLocation(canonicalId, updated);
    this.notifyListeners();
  }

  /**
   * Process Real-Time Presence updates from Pusher / SSE
   */
  private handleIncomingPresence(payload: PresenceUpdatePayload) {
    if (!payload || !payload.userId) return;

    console.log(`[Presence] presence.updated received ${payload.userId}`);

    const canonicalId = this.resolveCanonicalId(
      payload.userId,
      payload.email,
      payload.employeeCode,
      payload.alternateUserId
    );
    const existing = this.employeeLocations.get(canonicalId);
    const isOnline = Boolean(payload.isOnline);
    const timestamp = payload.lastSeenAt || new Date().toISOString();
    const payloadTime = new Date(timestamp).getTime();
    const existingTime = existing?.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;

    // Guard against out-of-order older Pusher events marking a newer online user offline
    if (existing && existing.isOnline && payloadTime < existingTime && !isOnline) {
      return;
    }

    const hasPayloadCoords = typeof payload.latitude === 'number' && typeof payload.longitude === 'number';

    if (existing) {
      existing.isOnline = isOnline;
      existing.lastSeenAt = timestamp;
      existing.updatedAt = timestamp;
      if (typeof payload.isSharingLocation === 'boolean') {
        existing.isSharingLocation = payload.isSharingLocation;
      }
      if (payload.role) existing.role = payload.role;
      if (payload.employeeCode && (!existing.employeeCode || existing.employeeCode === existing.userId)) {
        existing.employeeCode = payload.employeeCode;
      }
      if (payload.name && (!existing.name || existing.name.startsWith('Field Worker ('))) {
        existing.name = payload.name;
      }
      if (payload.email && !existing.email) existing.email = payload.email;

      if (hasPayloadCoords) {
        existing.latitude = payload.latitude;
        existing.longitude = payload.longitude;
        existing.hasLocation = true;
        if (payload.accuracy !== undefined) existing.accuracy = payload.accuracy;
        if (payload.speed !== undefined) existing.speed = payload.speed;
      }

      const hasCoords = Boolean(existing.hasLocation && typeof existing.latitude === 'number' && typeof existing.longitude === 'number');

      // Determine status independently from GPS
      if (!isOnline) {
        existing.status = 'offline';
        existing.currentActivity = 'Offline';
      } else if (hasCoords) {
        existing.status = (existing.speed && existing.speed > 3) ? 'moving' : 'idle';
        existing.currentActivity = (existing.speed && existing.speed > 3) ? 'In Transit / Moving' : 'On Site / Active';
      } else {
        existing.status = 'online';
        existing.currentActivity = existing.isSharingLocation
          ? 'Online • Awaiting GPS fix'
          : 'Online • Standby';
      }

      this.employeeLocations.set(canonicalId, { ...existing });
      this.persistRealLocation(canonicalId, existing);
    } else {
      // Dynamic worker entry if receiving presence for a worker not yet in local state
      const hasCoords = hasPayloadCoords;
      const newRecord: LiveEmployeeLocation = {
        userId: canonicalId,
        employeeCode: payload.employeeCode || canonicalId,
        name: payload.name || `Field Worker (${canonicalId.slice(0, 6)})`,
        email: payload.email,
        role: payload.role || 'Field Engineer',
        phone: '+91 98250 00000',
        department: 'Operations',
        isOnline,
        isSharingLocation: payload.isSharingLocation ?? true,
        lastSeenAt: timestamp,
        updatedAt: timestamp,
        hasLocation: hasCoords,
        latitude: hasCoords ? payload.latitude : undefined,
        longitude: hasCoords ? payload.longitude : undefined,
        accuracy: payload.accuracy,
        speed: payload.speed,
        status: !isOnline ? 'offline' : hasCoords ? ((payload.speed || 0) > 3 ? 'moving' : 'idle') : 'online',
        currentActivity: !isOnline
          ? 'Offline'
          : hasCoords
          ? ((payload.speed || 0) > 3 ? 'In Transit / Moving' : 'On Site / Active')
          : (payload.isSharingLocation ? 'Online • Awaiting GPS fix' : 'Online • Standby')
      };
      this.employeeLocations.set(canonicalId, newRecord);
      this.alternateIdMap.set(canonicalId.toLowerCase(), canonicalId);
      if (payload.userId && payload.userId !== canonicalId) {
        this.alternateIdMap.set(payload.userId.toLowerCase(), canonicalId);
      }
      if (payload.alternateUserId) {
        this.alternateIdMap.set(payload.alternateUserId.toLowerCase(), canonicalId);
      }
      if (payload.email) {
        this.alternateIdMap.set(payload.email.toLowerCase(), canonicalId);
      }
      if (payload.employeeCode) {
        this.alternateIdMap.set(payload.employeeCode.toLowerCase(), canonicalId);
      }
      this.persistRealLocation(canonicalId, newRecord);
    }

    this.notifyListeners();
  }

  /**
   * Periodic stale presence check (strictly checks presence timeout, NOT location loss)
   */
  private checkStaleLocations() {
    let hasChanges = false;
    const now = Date.now();

    this.employeeLocations.forEach((emp) => {
      if (emp.isOnline) {
        const lastSeenMs = emp.lastSeenAt ? new Date(emp.lastSeenAt).getTime() : 0;
        if (lastSeenMs > 0 && now - lastSeenMs > PRESENCE_TIMEOUT_MS) {
          emp.isOnline = false;
          emp.isSharingLocation = false;
          emp.status = 'offline';
          emp.currentActivity = 'Signal stale (offline)';
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this.notifyListeners();
    }
  }

  private persistRealLocation(userId: string, loc: LiveEmployeeLocation) {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(REAL_LOCATIONS_STORAGE_KEY);
      const data: Record<string, Partial<LiveEmployeeLocation>> = raw ? JSON.parse(raw) : {};
      data[userId] = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        heading: loc.heading,
        speed: loc.speed,
        batteryLevel: loc.batteryLevel,
        currentActivity: loc.currentActivity,
        updatedAt: loc.updatedAt,
        lastSeenAt: loc.lastSeenAt,
        isOnline: loc.isOnline,
        isSharingLocation: loc.isSharingLocation,
        status: loc.status
      };
      localStorage.setItem(REAL_LOCATIONS_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Could not persist location fix:', e);
    }
  }

  /**
   * Called by Field Worker device to broadcast real GPS coordinates
   */
  async updateEmployeeLocation(
    userId: string,
    coords: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      speed?: number;
      heading?: number;
      batteryLevel?: number;
      activity?: string;
      employeeCode?: string;
      name?: string;
      role?: string;
    }
  ): Promise<boolean> {
    const payload: LocationUpdatePayload = {
      userId,
      employeeCode: coords.employeeCode,
      name: coords.name,
      role: coords.role,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      speed: coords.speed,
      heading: coords.heading,
      batteryLevel: coords.batteryLevel,
      activity: coords.activity,
      timestamp: new Date().toISOString()
    };

    return pusherService.broadcastLocation(payload);
  }

  /**
   * Called to send heartbeat to backend
   */
  async sendHeartbeat(data: {
    userId: string;
    employeeCode?: string;
    name?: string;
    email?: string;
    role?: string;
    isSharingLocation: boolean;
  }): Promise<boolean> {
    return pusherService.sendHeartbeat(data);
  }

  /**
   * Called when stopping location sharing or logging out
   */
  async sendOffline(userId: string, email?: string, employeeCode?: string): Promise<boolean> {
    return pusherService.sendOffline(userId, email, employeeCode);
  }

  getLocations(): LiveEmployeeLocation[] {
    return Array.from(this.employeeLocations.values());
  }

  getEmployeeLocation(userId: string): LiveEmployeeLocation | undefined {
    const canonical = this.resolveCanonicalId(userId);
    return this.employeeLocations.get(canonical);
  }

  subscribe(callback: (locations: LiveEmployeeLocation[]) => void): () => void {
    this.listeners.add(callback);
    callback(this.getLocations());
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners() {
    const list = this.getLocations();
    const onlineCount = list.filter((l) => l.isOnline).length;
    console.log(`[Presence] online employees: ${onlineCount}`);
    this.listeners.forEach((listener) => {
      try {
        listener(list);
      } catch (e) {
        console.error('Error in location subscriber:', e);
      }
    });
  }

  destroy() {
    if (this.unsubscribeLocationPusher) {
      this.unsubscribeLocationPusher();
      this.unsubscribeLocationPusher = null;
    }
    if (this.unsubscribePresencePusher) {
      this.unsubscribePresencePusher();
      this.unsubscribePresencePusher = null;
    }
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
    this.listeners.clear();
  }
}

export const liveLocationService = new LiveLocationService();
