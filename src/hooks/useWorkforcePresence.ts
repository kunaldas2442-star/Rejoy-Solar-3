import { useEffect, useRef } from 'react';
import { UserProfile } from '../types/solar';
import { liveLocationService } from '../services/liveLocationService';

const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 20 seconds interval

export function useWorkforcePresence(currentUser: UserProfile | null, isAuthenticated: boolean) {
  const currentUserRef = useRef<UserProfile | null>(currentUser);
  currentUserRef.current = currentUser;

  useEffect(() => {
    if (!isAuthenticated || !currentUser) {
      return;
    }

    // Customer accounts do not participate in workforce presence
    if (currentUser.role === 'Customer') {
      return;
    }

    const userId = currentUser.id;
    const employeeCode = currentUser.employeeId || currentUser.id;
    const name = currentUser.name;
    const email = currentUser.email;
    const role = currentUser.role;

    const triggerHeartbeat = async () => {
      const user = currentUserRef.current;
      if (!user) return;
      const activeUserId = user.id;
      const activeCode = user.employeeId || user.id;
      const activeName = user.name;
      const activeEmail = user.email;
      const activeRole = user.role;

      try {
        console.log('[Presence] heartbeat sent', { userId: activeUserId });
        const success = await liveLocationService.sendHeartbeat({
          userId: activeUserId,
          employeeCode: activeCode,
          name: activeName,
          email: activeEmail,
          role: activeRole,
          isSharingLocation: liveLocationService.isLocationSharingActive()
        });
        if (success) {
          console.log('[Presence] heartbeat response 200', { userId: activeUserId });
        }
      } catch (err) {
        console.warn('[Workforce Presence] Automatic heartbeat failed:', err);
      }
    };

    // 1. Immediately broadcast heartbeat upon login
    triggerHeartbeat();

    // 2. Schedule recurring heartbeat every 20 seconds
    const intervalTimer = setInterval(triggerHeartbeat, HEARTBEAT_INTERVAL_MS);

    // 3. Handle browser close/tab navigation using beforeunload & pagehide
    const handleUnload = () => {
      liveLocationService.sendOffline(userId, email, employeeCode);
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      clearInterval(intervalTimer);
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      // NOTE: Do NOT send offline in React effect cleanup, as component re-renders or navigation
      // must not prematurely knock the user offline. Explicit offline is handled by logout or beforeunload.
    };
  }, [isAuthenticated, currentUser?.id, currentUser?.role]);
}
