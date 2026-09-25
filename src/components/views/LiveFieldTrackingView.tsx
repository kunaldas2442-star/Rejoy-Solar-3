import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { liveLocationService } from '../../services/liveLocationService';
import { pusherService } from '../../services/pusherService';
import {
  LiveEmployeeLocation,
  TrackingFilterOptions,
  PusherConnectionState
} from '../../types/tracking';
import { LiveFieldMap } from '../tracking/LiveFieldMap';
import { FieldEmployeeList } from '../tracking/FieldEmployeeList';
import { FieldEmployeeDetailsModal } from '../tracking/FieldEmployeeDetailsModal';
import {
  Navigation,
  ArrowLeft,
  RefreshCw,
  Maximize2,
  Minimize2,
  ShieldAlert,
  Radio
} from 'lucide-react';

export const LiveFieldTrackingView: React.FC = () => {
  const { setActiveView } = useApp();
  const { isAdmin } = useAuth();

  const [locations, setLocations] = useState<LiveEmployeeLocation[]>(() =>
    liveLocationService.getLocations()
  );
  const [selectedEmployee, setSelectedEmployee] = useState<LiveEmployeeLocation | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pusherState, setPusherState] = useState<PusherConnectionState>(() =>
    pusherService.getConnectionState()
  );
  const [lastHeartbeat, setLastHeartbeat] = useState<string>(new Date().toLocaleTimeString());

  const [filters, setFilters] = useState<TrackingFilterOptions>({
    searchQuery: '',
    status: 'ALL',
    role: 'ALL',
    assignment: 'ALL'
  });

  // Strict role check: Workforce tracking map is exclusively accessible to Admin
  if (!isAdmin) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center p-8 bg-white rounded-3xl border border-slate-200 text-center shadow-xs">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mb-4 shadow-xs">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-1">Access Restricted</h2>
        <p className="text-sm text-slate-500 max-w-md mb-6 leading-relaxed">
          The Central Live Field Workforce Tracking Console is restricted to Administrator personnel.
        </p>
        <button
          onClick={() => setActiveView('dashboard')}
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Dashboard</span>
        </button>
      </div>
    );
  }

  // Initial load & periodic reconciliation: Fetch server locations immediately and every 10 seconds
  useEffect(() => {
    liveLocationService.fetchServerLocations();
    const interval = setInterval(() => {
      liveLocationService.fetchServerLocations();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Listen to Pusher connection state changes
  useEffect(() => {
    const unsubConnection = pusherService.onConnectionChange((state) => {
      setPusherState(state);
    });
    return () => {
      unsubConnection();
    };
  }, []);

  // Subscribe to real-time location & presence stream
  useEffect(() => {
    const unsubscribeLocations = liveLocationService.subscribe((updatedLocations) => {
      setLocations(updatedLocations);
      setLastHeartbeat(new Date().toLocaleTimeString());

      // If an employee was selected, update their reference
      setSelectedEmployee((prev) => {
        if (!prev) return null;
        const match = updatedLocations.find((l) => l.userId === prev.userId);
        return match || prev;
      });
    });

    return () => {
      unsubscribeLocations();
    };
  }, []);

  const handleSelectEmployee = useCallback((emp: LiveEmployeeLocation) => {
    setSelectedEmployee(emp);
  }, []);

  const handleViewDetails = useCallback((emp: LiveEmployeeLocation) => {
    setSelectedEmployee(emp);
    setIsDetailsModalOpen(true);
  }, []);

  const handleCenterOnMap = useCallback((emp: LiveEmployeeLocation) => {
    setSelectedEmployee(emp);
    setFollowSelected(true);
  }, []);

  const handleToggleFollow = useCallback(() => {
    setFollowSelected((prev) => !prev);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleRefreshServer = async () => {
    setIsRefreshing(true);
    await liveLocationService.fetchServerLocations();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Live counters: Online reflects presence heartbeat; moving/idle reflect GPS speed
  const stats = useMemo(() => {
    const total = locations.length;
    const online = locations.filter((l) => l.isOnline).length;
    const moving = locations.filter((l) => l.isOnline && l.status === 'moving').length;
    const idle = locations.filter((l) => l.isOnline && l.status === 'idle').length;
    const offline = locations.filter((l) => !l.isOnline).length;
    return { total, online, moving, idle, offline };
  }, [locations]);

  // Pusher connection status badge configuration
  const renderConnectionBadge = () => {
    if (pusherState === 'pusher-connected' || pusherState === 'connected') {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="font-mono">🟢 LIVE</span>
          <span className="text-emerald-700 font-medium hidden sm:inline">• Pusher Connected</span>
        </div>
      );
    }
    if (pusherState === 'pusher-connecting' || pusherState === 'connecting') {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>🟡 CONNECTING</span>
          <span className="text-amber-700 font-medium hidden sm:inline">• Pusher</span>
        </div>
      );
    }
    if (pusherState === 'sse-fallback') {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 text-amber-900 border border-amber-300 text-xs font-bold shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span>🟠 SSE FALLBACK</span>
          <span className="text-amber-800 font-medium hidden sm:inline">• Server Stream</span>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-50 text-rose-800 border border-rose-300 text-xs font-bold shadow-2xs">
        <span className="w-2 h-2 rounded-full bg-rose-500" />
        <span>🔴 OFFLINE</span>
        <span className="text-rose-700 font-normal hidden sm:inline">• Realtime Unavailable</span>
      </div>
    );
  };

  return (
    <div className={`space-y-4 animate-in fade-in duration-150 ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-100 p-2 space-y-2' : ''}`}>
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                if (isFullscreen) setIsFullscreen(false);
                else setActiveView('dashboard');
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Admin Dashboard</span>
            </button>
            <span className="text-slate-300">•</span>
            {renderConnectionBadge()}
            <span className="text-slate-300">•</span>
            <span className="text-[11px] text-slate-400 font-mono">
              Channel: <strong className="text-slate-600">my-channel</strong>
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2.5">
            <Navigation className="w-6 h-6 text-amber-500" />
            <span>LIVE FIELD WORKFORCE TRACKING</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Real-time Pusher GPS dispatch & telemetry for Site Survey, Installation, Electrical, Civil & Service Engineers.
          </p>
        </div>

        {/* Live Counters Banner & Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-800 font-bold">{stats.online} Online</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs">
            <span className="text-emerald-700 font-medium">🚗</span>
            <span className="text-emerald-900 font-bold">{stats.moving} Moving</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs">
            <span className="text-amber-700 font-medium">🟡</span>
            <span className="text-amber-900 font-bold">{stats.idle} Idle</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <span className="text-slate-500 font-medium">⚫</span>
            <span className="text-slate-700 font-bold">{stats.offline} Offline</span>
          </div>

          <button
            onClick={handleRefreshServer}
            title="Refresh Server Telemetry"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 bg-white shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-500' : ''}`} />
          </button>

          <button
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen Map'}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 bg-white shadow-2xs cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Interactive Map & Employee Sidebar Workspace */}
      <div
        className={`grid grid-cols-1 lg:grid-cols-12 gap-4 ${
          isFullscreen
            ? 'h-[calc(100vh-130px)] min-h-[480px]'
            : 'h-[calc(100vh-250px)] min-h-[580px]'
        }`}
      >
        {/* Interactive Live Leaflet Map (70-75% width on desktop) */}
        <div className="lg:col-span-8 xl:col-span-8 h-full min-h-[440px] flex flex-col relative">
          <LiveFieldMap
            locations={locations}
            selectedEmployee={selectedEmployee}
            onSelectEmployee={handleSelectEmployee}
            followSelected={followSelected}
            onToggleFollow={handleToggleFollow}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
          />
        </div>

        {/* Field Workforce Filterable List (25-30% width on desktop) */}
        <div className="lg:col-span-4 xl:col-span-4 h-full min-h-[440px] flex flex-col">
          <FieldEmployeeList
            locations={locations}
            selectedEmployee={selectedEmployee}
            onSelectEmployee={handleSelectEmployee}
            onViewDetails={handleViewDetails}
            filters={filters}
            onFilterChange={setFilters}
            isMobileDrawerOpen={isMobileDrawerOpen}
            onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
          />
        </div>
      </div>

      {/* Employee Comprehensive Details Slide-out / Modal */}
      <FieldEmployeeDetailsModal
        employee={selectedEmployee}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onCenterOnMap={handleCenterOnMap}
        followSelected={followSelected}
        onToggleFollow={handleToggleFollow}
      />
    </div>
  );
};
