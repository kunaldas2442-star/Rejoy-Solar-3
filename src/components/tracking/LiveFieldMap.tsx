import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LiveEmployeeLocation, LocationCoordinates } from '../../types/tracking';
import {
  Compass,
  Maximize2,
  Minimize2,
  Crosshair,
  Layers,
  MapPin,
  AlertCircle
} from 'lucide-react';

interface LiveFieldMapProps {
  locations: LiveEmployeeLocation[];
  selectedEmployee: LiveEmployeeLocation | null;
  onSelectEmployee: (emp: LiveEmployeeLocation) => void;
  followSelected: boolean;
  onToggleFollow: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const LiveFieldMap: React.FC<LiveFieldMapProps> = ({
  locations,
  selectedEmployee,
  onSelectEmployee,
  followSelected,
  onToggleFollow,
  isFullscreen: controlledFullscreen,
  onToggleFullscreen: controlledToggleFullscreen
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  
  // Cache of existing Leaflet markers keyed by userId: Map<string, L.Marker>
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const siteMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLineRef = useRef<L.Polyline | null>(null);
  const animationFrameIdsRef = useRef<Map<string, number>>(new Map());

  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isFullscreen = controlledFullscreen !== undefined ? controlledFullscreen : internalFullscreen;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Build custom field employee marker icon with HTML & Tailwind styling
  const createEmployeeIcon = useCallback((
    employee: LiveEmployeeLocation,
    isSelected: boolean
  ) => {
    const isMoving = employee.status === 'moving';
    const isIdle = employee.status === 'idle';
    const isOffline = !employee.isOnline || employee.status === 'offline';

    // Status beacon color
    let beaconBg = 'bg-emerald-500';
    let ringBorder = 'border-emerald-500';
    let statusEmoji = '🟢';

    if (isOffline) {
      beaconBg = 'bg-slate-500';
      ringBorder = 'border-slate-400';
      statusEmoji = '⚫';
    } else if (isMoving) {
      beaconBg = 'bg-emerald-500';
      ringBorder = 'border-emerald-500';
      statusEmoji = '🚗';
    } else if (isIdle) {
      beaconBg = 'bg-amber-500';
      ringBorder = 'border-amber-400';
      statusEmoji = '🟡';
    }

    const initials = employee.name
      ? employee.name.split(' ').map((n) => n[0]).join('').slice(0, 2)
      : 'FW';

    const avatarHtml = employee.avatar
      ? `<img src="${employee.avatar}" class="w-full h-full object-cover rounded-full" alt="" />`
      : `<div class="w-full h-full flex items-center justify-center font-bold text-slate-800 text-[11px] bg-amber-100">👷</div>`;

    const html = `
      <div class="relative group cursor-pointer -translate-x-1/2 -translate-y-1/2 select-none">
        ${
          isSelected
            ? `<div class="absolute -inset-2.5 rounded-full border-2 border-amber-500 bg-amber-500/20 animate-ping pointer-events-none"></div>`
            : ''
        }

        <!-- Outer Worker Badge -->
        <div class="relative w-10 h-10 rounded-full border-2 ${
          isSelected ? 'border-amber-500 shadow-lg scale-110' : `${ringBorder} shadow-md`
        } bg-white transition-all duration-300 flex items-center justify-center overflow-hidden">
          ${avatarHtml}
        </div>

        <!-- Live Status Beacon Dot -->
        <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${beaconBg} ${
          isMoving ? 'animate-pulse' : ''
        } flex items-center justify-center text-[8px] text-white shadow-xs">
          ${isMoving ? '🚗' : ''}
        </div>

        <!-- Employee Tooltip Label -->
        <div class="absolute top-11 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap shadow-md pointer-events-none flex items-center gap-1 border border-slate-700">
          <span>${employee.name}</span>
          ${employee.speed && employee.speed > 0 ? `<span class="text-amber-400 text-[9px] font-normal">(${Math.round(employee.speed)} km/h)</span>` : ''}
        </div>
      </div>
    `;

    return L.divIcon({
      html,
      className: 'custom-field-worker-marker',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }, []);

  // Build custom site marker icon
  const createSiteIcon = useCallback((siteName: string, customerName?: string) => {
    const html = `
      <div class="relative cursor-pointer -translate-x-1/2 -translate-y-1/2 select-none group">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white flex items-center justify-center shadow-lg border-2 border-white">
          <span class="text-sm">📍</span>
        </div>
        <div class="absolute top-9 left-1/2 -translate-x-1/2 bg-amber-950/90 text-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap shadow-md border border-amber-700 pointer-events-none flex items-center gap-1">
          <span>Site: ${customerName || siteName}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      html,
      className: 'custom-solar-site-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }, []);

  // Smooth animate marker position (Linear/Cubic interpolation between GPS updates)
  const animateMarkerMovement = useCallback((
    marker: L.Marker,
    targetLat: number,
    targetLng: number,
    userId: string
  ) => {
    // Cancel any running animation for this user
    if (animationFrameIdsRef.current.has(userId)) {
      cancelAnimationFrame(animationFrameIdsRef.current.get(userId)!);
      animationFrameIdsRef.current.delete(userId);
    }

    const current = marker.getLatLng();
    const startLat = current.lat;
    const startLng = current.lng;

    // If change is negligible, just set and return
    if (Math.abs(startLat - targetLat) < 0.000001 && Math.abs(startLng - targetLng) < 0.000001) {
      marker.setLatLng([targetLat, targetLng]);
      return;
    }

    const duration = 1000; // ms
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      const lat = startLat + (targetLat - startLat) * ease;
      const lng = startLng + (targetLng - startLng) * ease;
      marker.setLatLng([lat, lng]);

      if (progress < 1) {
        const nextFrame = requestAnimationFrame(animate);
        animationFrameIdsRef.current.set(userId, nextFrame);
      } else {
        animationFrameIdsRef.current.delete(userId);
        marker.setLatLng([targetLat, targetLng]);
      }
    };

    const initialFrame = requestAnimationFrame(animate);
    animationFrameIdsRef.current.set(userId, initialFrame);
  }, []);

  // Initialize Leaflet Map using purely OpenStreetMap (NO API Key required, NO CartoDB)
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default view centered over region
    const map = L.map(mapContainerRef.current, {
      center: [22.9868, 72.3789],
      zoom: 12,
      zoomControl: false,
      attributionControl: true
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Standard OpenStreetMap Tile Layer - 100% Free, NO API Key needed
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    // Invalidate size on container resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      // Cleanup all running marker animations
      animationFrameIdsRef.current.forEach((frameId) => cancelAnimationFrame(frameId));
      animationFrameIdsRef.current.clear();
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Render Solar EPC Project Sites markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const sitesMap = new Map<string, { name: string; customer?: string; coords: LocationCoordinates }>();

    locations.forEach((loc) => {
      if (loc.assignedSiteCoordinates && loc.assignedProjectId) {
        if (!sitesMap.has(loc.assignedProjectId)) {
          sitesMap.set(loc.assignedProjectId, {
            name: loc.assignedProjectTitle || 'Solar Site',
            customer: loc.assignedCustomerName,
            coords: loc.assignedSiteCoordinates
          });
        }
      }
    });

    // Remove any site markers no longer in sitesMap
    siteMarkersRef.current.forEach((marker, key) => {
      if (!sitesMap.has(key)) {
        map.removeLayer(marker);
        siteMarkersRef.current.delete(key);
      }
    });

    // Add or update site markers
    sitesMap.forEach((site, key) => {
      if (!siteMarkersRef.current.has(key)) {
        const marker = L.marker([site.coords.latitude, site.coords.longitude], {
          icon: createSiteIcon(site.name, site.customer)
        }).addTo(map);
        siteMarkersRef.current.set(key, marker);
      }
    });
  }, [locations, createSiteIcon]);

  // Synchronize Employee Markers with Map cache: Map<string, L.Marker>
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Collect valid employees who actually have GPS coordinates reported
    const validEmployees = locations.filter(
      (l) => l.hasLocation && typeof l.latitude === 'number' && typeof l.longitude === 'number'
    );
    const validEmployeeIds = new Set(validEmployees.map((l) => l.userId));

    // 1. Remove markers for employees who no longer have valid locations or were removed
    markersRef.current.forEach((marker, userId) => {
      if (!validEmployeeIds.has(userId)) {
        if (animationFrameIdsRef.current.has(userId)) {
          cancelAnimationFrame(animationFrameIdsRef.current.get(userId)!);
          animationFrameIdsRef.current.delete(userId);
        }
        map.removeLayer(marker);
        markersRef.current.delete(userId);
      }
    });

    // 2. For each employee with real GPS coordinates:
    validEmployees.forEach((emp) => {
      const isSelected = selectedEmployee?.userId === emp.userId;
      const targetLat = emp.latitude!;
      const targetLng = emp.longitude!;

      const popupHtml = `
        <div style="font-family: system-ui, sans-serif; min-width: 170px; padding: 2px;">
          <div style="font-weight: 700; font-size: 13px; color: #0f172a;">${emp.name}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 1px;">${emp.role} ${emp.employeeCode ? `(${emp.employeeCode})` : ''}</div>
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #e2e8f0; font-size: 11px; display: flex; flex-direction: column; gap: 3px;">
            <div><strong>Status:</strong> ${emp.isOnline ? '🟢 Online' : '⚫ Offline'} (${emp.status.toUpperCase()})</div>
            ${emp.speed !== undefined && emp.speed > 0 ? `<div><strong>Speed:</strong> ${Math.round(emp.speed)} km/h</div>` : ''}
            ${emp.batteryLevel !== undefined ? `<div><strong>Battery:</strong> ${emp.batteryLevel}%</div>` : ''}
            ${emp.distanceToSiteKm !== undefined ? `<div><strong>Distance to Site:</strong> ${emp.distanceToSiteKm} km</div>` : ''}
            <div style="color: #94a3b8; font-size: 10px; margin-top: 2px;">Updated: ${new Date(emp.updatedAt).toLocaleTimeString()}</div>
          </div>
        </div>
      `;

      if (markersRef.current.has(emp.userId)) {
        // Marker already exists: update icon, popup and smoothly animate coordinates
        const marker = markersRef.current.get(emp.userId)!;
        marker.setIcon(createEmployeeIcon(emp, isSelected));
        marker.setPopupContent(popupHtml);
        animateMarkerMovement(marker, targetLat, targetLng, emp.userId);
      } else {
        // Marker doesn't exist: create new marker
        const marker = L.marker([targetLat, targetLng], {
          icon: createEmployeeIcon(emp, isSelected)
        }).addTo(map);

        marker.bindPopup(popupHtml, { offset: [0, -10] });

        marker.on('click', () => {
          onSelectEmployee(emp);
          marker.openPopup();
        });

        markersRef.current.set(emp.userId, marker);
      }
    });

    // 3. Trajectory route line to assigned site for selected worker
    if (
      selectedEmployee &&
      selectedEmployee.hasLocation &&
      typeof selectedEmployee.latitude === 'number' &&
      typeof selectedEmployee.longitude === 'number' &&
      selectedEmployee.assignedSiteCoordinates
    ) {
      const latlngs: [number, number][] = [
        [selectedEmployee.latitude, selectedEmployee.longitude],
        [selectedEmployee.assignedSiteCoordinates.latitude, selectedEmployee.assignedSiteCoordinates.longitude]
      ];

      if (routeLineRef.current) {
        routeLineRef.current.setLatLngs(latlngs);
      } else {
        routeLineRef.current = L.polyline(latlngs, {
          color: '#f59e0b',
          weight: 3,
          dashArray: '6, 8',
          opacity: 0.85
        }).addTo(map);
      }
    } else if (routeLineRef.current) {
      map.removeLayer(routeLineRef.current);
      routeLineRef.current = null;
    }

    // 4. Follow mode: keep map centered on selected worker as they move
    if (
      followSelected &&
      selectedEmployee &&
      selectedEmployee.hasLocation &&
      typeof selectedEmployee.latitude === 'number' &&
      typeof selectedEmployee.longitude === 'number'
    ) {
      map.panTo([selectedEmployee.latitude, selectedEmployee.longitude], {
        animate: true,
        duration: 0.8
      });
    }
  }, [locations, selectedEmployee, followSelected, createEmployeeIcon, animateMarkerMovement, onSelectEmployee]);

  // Center on Selected Employee
  const handleCenterOnSelected = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedEmployee) return;

    if (!selectedEmployee.hasLocation || selectedEmployee.latitude === undefined || selectedEmployee.longitude === undefined) {
      showToast(`${selectedEmployee.name} has not broadcasted device GPS location yet.`);
      return;
    }

    if (selectedEmployee.assignedSiteCoordinates) {
      const bounds = L.latLngBounds([
        [selectedEmployee.latitude, selectedEmployee.longitude],
        [selectedEmployee.assignedSiteCoordinates.latitude, selectedEmployee.assignedSiteCoordinates.longitude]
      ]);
      map.fitBounds(bounds, {
        padding: [60, 60],
        maxZoom: 16,
        animate: true
      });
    } else {
      map.setView([selectedEmployee.latitude, selectedEmployee.longitude], 15, {
        animate: true
      });
    }
  }, [selectedEmployee]);

  // Fit All Employees on map
  const handleFitAll = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const validLocs = locations.filter(
      (l) => l.hasLocation && typeof l.latitude === 'number' && typeof l.longitude === 'number'
    );

    if (validLocs.length === 0) {
      showToast('No field employees currently have valid locations.');
      return;
    }

    if (validLocs.length === 1) {
      map.setView([validLocs[0].latitude!, validLocs[0].longitude!], 15, { animate: true });
      return;
    }

    const points: [number, number][] = validLocs.map((l) => [l.latitude!, l.longitude!] as [number, number]);

    // Also include site points if present
    validLocs.forEach((l) => {
      if (l.assignedSiteCoordinates) {
        points.push([l.assignedSiteCoordinates.latitude, l.assignedSiteCoordinates.longitude]);
      }
    });

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, {
      padding: [50, 50],
      maxZoom: 15,
      animate: true
    });
  }, [locations]);

  const handleToggleFullscreenInternal = useCallback(() => {
    if (controlledToggleFullscreen) {
      controlledToggleFullscreen();
    } else {
      setInternalFullscreen((prev) => !prev);
    }
  }, [controlledToggleFullscreen]);

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden border border-slate-200 shadow-2xs bg-slate-100 flex-1 flex flex-col ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none' : 'h-full min-h-[460px]'
      }`}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/95 backdrop-blur-md text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xl border border-slate-700 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Leaflet Map DOM Container */}
      <div ref={mapContainerRef} className="w-full h-full min-h-[460px] z-0 flex-1" />

      {/* Floating Map Controls Toolbar */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2">
        {/* Fit All Button */}
        <button
          onClick={handleFitAll}
          title="Fit All Active Field Workers"
          className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-white shadow-sm transition-all text-xs font-bold flex items-center gap-1.5"
        >
          <Crosshair className="w-4 h-4 text-amber-500" />
          <span>Fit All</span>
        </button>

        {/* Center on Selected Worker */}
        {selectedEmployee && (
          <button
            onClick={handleCenterOnSelected}
            title="Center on selected worker"
            className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-white shadow-sm transition-all text-xs font-bold flex items-center gap-1.5"
          >
            <MapPin className="w-4 h-4 text-emerald-500" />
            <span>Locate</span>
          </button>
        )}

        {/* Follow Selected Worker Toggle */}
        <button
          onClick={onToggleFollow}
          title={followSelected ? 'Disable auto-follow' : 'Keep map centered on selected worker'}
          className={`px-3 py-2 rounded-xl border shadow-sm transition-all text-xs font-bold flex items-center gap-1.5 ${
            followSelected
              ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-400/40'
              : 'bg-white/95 backdrop-blur-sm border-slate-200 text-slate-700 hover:bg-white'
          }`}
        >
          <Compass className={`w-4 h-4 ${followSelected ? 'animate-spin' : 'text-slate-500'}`} />
          <span>Follow</span>
        </button>

        {/* Fullscreen Toggle Button */}
        <button
          onClick={handleToggleFullscreenInternal}
          title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-white shadow-sm transition-all text-xs font-bold flex items-center gap-1.5"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          <span>{isFullscreen ? 'Exit Full' : 'Full Screen'}</span>
        </button>
      </div>

      {/* Floating Active Count Indicator & OSM Attribution */}
      <div className="absolute bottom-3 left-3 z-[400] flex items-center gap-2 text-[11px] font-medium text-slate-600 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-bold text-slate-800">
          {locations.filter((l) => l.isOnline && l.hasLocation && typeof l.latitude === 'number' && typeof l.longitude === 'number').length} active on map
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-500">Leaflet & OpenStreetMap (Free, No API Key)</span>
      </div>
    </div>
  );
};
