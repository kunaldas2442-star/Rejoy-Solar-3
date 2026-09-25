import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { UserProfile, UserRole } from '../types/solar';
import { storageService } from '../services/storage';
import { liveLocationService } from '../services/liveLocationService';
import {
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  logoutUser,
  sendPasswordReset,
  subscribeToAuthState,
  isFirebaseConfigured,
  getFirebaseErrorMessage
} from '../services/firebase';
import { firestoreService } from '../services/firestoreService';

export interface RoleDefinition {
  role: UserRole;
  department: string;
  description: string;
  badgeColor: string;
  isFieldWorkerDefault?: boolean;
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    role: 'Admin',
    department: 'Administration',
    description: 'Master system authority, user management, financial approvals & administrative control',
    badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'Sales Manager',
    department: 'Sales',
    description: 'Pipeline analytics, commercial quoting, revenue targets & lead assignments',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'Sales Executive',
    department: 'Sales',
    description: 'Lead generation, customer site visits, proposal follow-ups & CRM conversion',
    badgeColor: 'bg-teal-100 text-teal-800 border-teal-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'Project Manager',
    department: 'Operations',
    description: '14-stage EPC milestones, stage approvals, resource scheduling & contractor oversight',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'Site Survey Engineer',
    department: 'Engineering',
    description: 'Site feasibility audits, roof structure load, solar radiance, azimuth & shadow analysis',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Site Inspector',
    department: 'Engineering',
    description: 'Installation quality audits, safety compliance checks, punchlists & milestone sign-offs',
    badgeColor: 'bg-orange-100 text-orange-800 border-orange-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Civil Team',
    department: 'Civil',
    description: 'RCC pedestal casting, chemical anchoring, roof penetrations & civil structural safety',
    badgeColor: 'bg-stone-100 text-stone-800 border-stone-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Structure Team',
    department: 'Structure',
    description: 'Module mounting structures (MMS), column fabrication, tilt torque & wind shear alignment',
    badgeColor: 'bg-orange-100 text-orange-800 border-orange-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Installation Team',
    department: 'Installation',
    description: 'Solar PV module clamping, string cabling, inter-module jumpering & array leveling',
    badgeColor: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Electrical Team',
    department: 'Electrical',
    description: 'On-grid inverters, HT/LT ACDB-DCDB panels, chemical earthing pits & lightning arresters',
    badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Accountant',
    department: 'Finance',
    description: 'Milestone billing, GST sales invoices, expense vouchers & Tally Prime ODBC integration',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'HR Manager',
    department: 'HR',
    description: 'Staff onboarding, GPS attendance logs, leave approvals, salary slips & payroll cycles',
    badgeColor: 'bg-pink-100 text-pink-800 border-pink-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'Service Manager',
    department: 'Service',
    description: 'O&M warranty tickets, inverter breakdown dispatch, preventive schedules & AMC contracts',
    badgeColor: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    isFieldWorkerDefault: false
  },
  {
    role: 'Technician',
    department: 'Service',
    description: 'On-site troubleshooting, string VOC/ISC testing, module washing & spare replacement',
    badgeColor: 'bg-sky-100 text-sky-800 border-sky-300',
    isFieldWorkerDefault: true
  },
  {
    role: 'Customer',
    department: 'Customer',
    description: 'Client portal: live solar generation, project milestones, invoices & warranty certificates',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    isFieldWorkerDefault: false
  }
];

// Helper to determine the dashboard path for any given role
export const getRoleDefaultPath = (role: UserRole): string => {
  switch (role) {
    case 'Admin':
      return '/admin/dashboard';
    case 'Sales Manager':
    case 'Sales Executive':
      return '/sales/dashboard';
    case 'Project Manager':
      return '/projects/dashboard';
    case 'Site Survey Engineer':
    case 'Site Inspector':
    case 'Civil Team':
    case 'Structure Team':
    case 'Installation Team':
    case 'Electrical Team':
      return '/field/dashboard';
    case 'Service Manager':
    case 'Technician':
      return '/service/dashboard';
    case 'Accountant':
      return '/finance/dashboard';
    case 'HR Manager':
      return '/hr/dashboard';
    case 'Customer':
      return '/customer/dashboard';
    default:
      return '/dashboard';
  }
};

// Demo/Seed Accounts Specification
export interface DemoAccount {
  role: UserRole;
  email: string;
  password: string;
  name: string;
  department: string;
  designation: string;
  isFieldWorker: boolean;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'Admin',
    email: 'admin@rejoysolar.com',
    password: 'Admin@12345',
    name: 'Vikram Patel',
    department: 'Administration',
    designation: 'Managing Director & Lead Admin',
    isFieldWorker: false
  },
  {
    role: 'Sales Manager',
    email: 'salesmanager@rejoysolar.com',
    password: 'Sales@12345',
    name: 'Priya Verma',
    department: 'Sales',
    designation: 'Sales Manager - Commercial & Industrial',
    isFieldWorker: false
  },
  {
    role: 'Sales Executive',
    email: 'sales@rejoysolar.com',
    password: 'Sales@12345',
    name: 'Rahul Mehta',
    department: 'Sales',
    designation: 'Solar Sales Executive',
    isFieldWorker: false
  },
  {
    role: 'Project Manager',
    email: 'projectmanager@rejoysolar.com',
    password: 'Project@12345',
    name: 'Amit Sharma',
    department: 'Operations',
    designation: 'Senior Project Manager',
    isFieldWorker: false
  },
  {
    role: 'Site Survey Engineer',
    email: 'survey@rejoysolar.com',
    password: 'Survey@12345',
    name: 'Rajesh Kumar',
    department: 'Engineering',
    designation: 'Lead Site Survey Engineer',
    isFieldWorker: true
  },
  {
    role: 'Site Inspector',
    email: 'inspector@rejoysolar.com',
    password: 'Inspector@12345',
    name: 'Hardik Shah',
    department: 'Engineering',
    designation: 'Senior Site Inspector & Quality Auditor',
    isFieldWorker: true
  },
  {
    role: 'Civil Team',
    email: 'civil@rejoysolar.com',
    password: 'Civil@12345',
    name: 'Suresh Patel',
    department: 'Civil',
    designation: 'Civil Foundations Lead',
    isFieldWorker: true
  },
  {
    role: 'Structure Team',
    email: 'structure@rejoysolar.com',
    password: 'Structure@12345',
    name: 'Dinesh Yadav',
    department: 'Structure',
    designation: 'Structure Fabrication Lead',
    isFieldWorker: true
  },
  {
    role: 'Installation Team',
    email: 'installation@rejoysolar.com',
    password: 'Install@12345',
    name: 'Manoj Tiwari',
    department: 'Installation',
    designation: 'Solar Module Installation Lead',
    isFieldWorker: true
  },
  {
    role: 'Electrical Team',
    email: 'electrical@rejoysolar.com',
    password: 'Electrical@12345',
    name: 'Ankit Joshi',
    department: 'Electrical',
    designation: 'Senior Electrical Engineer (LT/HT)',
    isFieldWorker: true
  },
  {
    role: 'Accountant',
    email: 'accountant@rejoysolar.com',
    password: 'Accounts@12345',
    name: 'Sneha Kulkarni',
    department: 'Finance',
    designation: 'Chief Accountant & Tally Specialist',
    isFieldWorker: false
  },
  {
    role: 'HR Manager',
    email: 'hr@rejoysolar.com',
    password: 'HR@12345',
    name: 'Neha Gupta',
    department: 'HR',
    designation: 'HR & Operations Manager',
    isFieldWorker: false
  },
  {
    role: 'Service Manager',
    email: 'service@rejoysolar.com',
    password: 'Service@12345',
    name: 'Rohit Verma',
    department: 'Service',
    designation: 'Service Manager',
    isFieldWorker: false
  },
  {
    role: 'Technician',
    email: 'technician@rejoysolar.com',
    password: 'Tech@12345',
    name: 'Ketan Solanki',
    department: 'Service',
    designation: 'Field Service Technician',
    isFieldWorker: true
  },
  {
    role: 'Customer',
    email: 'customer@rejoysolar.com',
    password: 'Customer@12345',
    name: 'ABC Industries Ltd.',
    department: 'Customer',
    designation: 'Industrial EPC Client',
    isFieldWorker: false
  }
];

// Compatibility wrapper for SettingsView and existing consumers
export const PRESET_PERSONAS = ROLE_DEFINITIONS.map(r => ({
  profile: {
    id: `role-${r.role.toLowerCase().replace(/\s+/g, '-')}`,
    name: r.role,
    email: `${r.role.toLowerCase().replace(/\s+/g, '.')}@rejoysolar.com`,
    role: r.role,
    phone: '+91 98000 00000',
    department: r.department,
    designation: r.role,
    isFieldWorker: Boolean(r.isFieldWorkerDefault)
  },
  description: r.description,
  badgeColor: r.badgeColor
}));

export interface AuthContextType {
  currentUser: UserProfile | null;
  firebaseUser: User | null;
  currentRole: UserRole;
  loading: boolean;
  isAuthenticated: boolean;
  isFirebaseReady: boolean;
  login: (email: string, pass: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (
    email: string,
    pass: string,
    name: string,
    role?: UserRole,
    department?: string,
    designation?: string,
    phone?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateRole: (newRole: UserRole) => void;
  switchPersona: (profile: UserProfile) => void;
  canAccessModule: (moduleName: string) => boolean;
  hasPermission: (permissionId: string) => boolean;
  canApproveStage: () => boolean;
  canEditFinancials: () => boolean;
  canAccessHR: () => boolean;
  canManageProjectAssignments: () => boolean;
  isAdmin: boolean;
  isCustomer: boolean;
  isFieldStaff: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_PROFILE_STORAGE_KEY = 'rejoysolar_firebase_profile_';
const OFFLINE_SESSION_STORAGE_KEY = 'rejoysolar_active_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const isFirebaseReady = isFirebaseConfigured();

  // Helper to build or retrieve an application profile associated with the Firebase User
  const resolveProfileForUser = (user: User): UserProfile => {
    const storageKey = USER_PROFILE_STORAGE_KEY + user.uid;
    const employees = storageService.getEmployees();
    const cleanUserEmail = (user.email || '').trim().toLowerCase();
    const linkedEmp = employees.find(
      e => (e.authUid && e.authUid === user.uid) || (e.email && e.email.trim().toLowerCase() === cleanUserEmail)
    );
    if (linkedEmp && !linkedEmp.authUid) {
      linkedEmp.authUid = user.uid;
      try {
        storageService.saveEmployee(linkedEmp);
      } catch {
        // non-blocking
      }
    }
    const demoAccount = DEMO_ACCOUNTS.find(d => d.email.toLowerCase() === cleanUserEmail);

    const cached = localStorage.getItem(storageKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (linkedEmp) {
          if (linkedEmp.systemRole) parsed.role = linkedEmp.systemRole;
          if (linkedEmp.name) parsed.name = linkedEmp.name;
          if (linkedEmp.department) parsed.department = linkedEmp.department;
          if (linkedEmp.designation) parsed.designation = linkedEmp.designation;
          if (linkedEmp.phone) parsed.phone = linkedEmp.phone;
          parsed.isFieldWorker = linkedEmp.isFieldWorker ?? parsed.isFieldWorker ?? false;
        }
        return {
          ...parsed,
          id: linkedEmp?.id || parsed.id || user.uid,
          employeeId: linkedEmp?.employeeCode || parsed.employeeId || linkedEmp?.id || user.uid,
          email: user.email || parsed.email || ''
        };
      } catch {
        // fallback to fresh build
      }
    }

    const isBootstrappedAdmin = cleanUserEmail === 'dasest404@gmail.com';
    const defaultRole: UserRole = isBootstrappedAdmin
      ? 'Admin'
      : linkedEmp?.systemRole || linkedEmp?.assignedRole || demoAccount?.role || 'Admin';
    const isFw = Boolean(
      linkedEmp?.isFieldWorker ??
      demoAccount?.isFieldWorker ??
      [
        'Site Survey Engineer',
        'Site Inspector',
        'Civil Team',
        'Structure Team',
        'Installation Team',
        'Electrical Team',
        'Technician'
      ].includes(defaultRole)
    );

    const profile: UserProfile = {
      id: linkedEmp?.id || user.uid,
      employeeId: linkedEmp?.employeeCode || linkedEmp?.id || user.uid,
      name: isBootstrappedAdmin
        ? 'Lead Administrator'
        : linkedEmp?.name || demoAccount?.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Solar User'),
      email: user.email || '',
      role: defaultRole,
      phone: linkedEmp?.phone || user.phoneNumber || '+91 98250 11223',
      department: isBootstrappedAdmin ? 'Administration' : (linkedEmp?.department || demoAccount?.department || 'Administration'),
      designation: isBootstrappedAdmin ? 'Lead Admin & Owner' : (linkedEmp?.designation || demoAccount?.designation || (defaultRole as string)),
      isFieldWorker: isFw,
      assignedProjects: []
    };

    localStorage.setItem(storageKey, JSON.stringify(profile));
    firestoreService.saveUserProfile(profile).catch(() => {});
    return profile;
  };

  // Monitor Firebase Auth state changes
  useEffect(() => {
    if (isFirebaseReady) {
      const unsubscribe = subscribeToAuthState((user) => {
        setFirebaseUser(user);
        if (user) {
          const profile = resolveProfileForUser(user);
          setCurrentUser(profile);
        } else {
          // If no firebase user, check local session for dev/demo testing
          const savedOffline = localStorage.getItem(OFFLINE_SESSION_STORAGE_KEY);
          if (savedOffline) {
            try {
              const parsed = JSON.parse(savedOffline);
              setCurrentUser(parsed);
            } catch {
              setCurrentUser(null);
            }
          } else {
            setCurrentUser(null);
          }
        }
        setLoading(false);
      });
      return () => unsubscribe();
    } else {
      // Offline / Developer mode if Firebase keys are not yet added to .env
      const savedOffline = localStorage.getItem(OFFLINE_SESSION_STORAGE_KEY);
      if (savedOffline) {
        try {
          const parsed = JSON.parse(savedOffline);
          setCurrentUser(parsed);
        } catch {
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    }
  }, [isFirebaseReady]);

  // Active presence heartbeat is authoritatively managed by useWorkforcePresence hook in App.tsx
  // to guarantee a single lifecycle per logged-in browser without competing intervals or premature unmount cleanups.

  // Persist active user profile changes
  const saveUserProfile = (profile: UserProfile) => {
    setCurrentUser(profile);
    if (profile.id) {
      localStorage.setItem(USER_PROFILE_STORAGE_KEY + profile.id, JSON.stringify(profile));
    }
    localStorage.setItem(OFFLINE_SESSION_STORAGE_KEY, JSON.stringify(profile));
    firestoreService.saveUserProfile(profile).catch((err) => {
      console.warn('Could not sync user profile to Firestore:', err);
    });
  };

  const loginWithGoogleAuth = async (): Promise<void> => {
    setLoading(true);
    try {
      const user = await loginWithGoogle();
      setFirebaseUser(user);
      const profile = resolveProfileForUser(user);
      saveUserProfile(profile);
    } catch (err: any) {
      throw new Error(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, pass: string): Promise<void> => {
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanPass = pass.trim();

      const employees = storageService.getEmployees();
      const linkedEmp = employees.find(
        e => e.email && e.email.trim().toLowerCase() === cleanEmail
      );
      const demoAccount = DEMO_ACCOUNTS.find(d => d.email.toLowerCase() === cleanEmail);

      // Check account activation
      if (linkedEmp) {
        if (linkedEmp.loginEnabled === false) {
          throw new Error('ERP login is not enabled for this employee account. Please contact an administrator.');
        }
        if (linkedEmp.accountStatus === 'DISABLED' || linkedEmp.status === 'INACTIVE') {
          throw new Error('This user account has been disabled by an administrator.');
        }
      }

      // Try Firebase if configured
      if (isFirebaseReady) {
        try {
          const user = await loginWithEmail(email, pass);
          setFirebaseUser(user);
          const profile = resolveProfileForUser(user);
          saveUserProfile(profile);
          return;
        } catch (firebaseErr: any) {
          // If Firebase failed, check if this is a known demo account in development
          if (!demoAccount) {
            throw new Error(getFirebaseErrorMessage(firebaseErr));
          }
          // Validate demo account password
          if (demoAccount.password !== cleanPass) {
            throw new Error('Invalid email or password. Please verify your credentials.');
          }
        }
      } else {
        // Fallback in dev/mock environment: check demo accounts or employees
        if (demoAccount && demoAccount.password !== cleanPass) {
          throw new Error('Invalid email or password. Please verify your credentials.');
        }
      }

      // Construct profile for authenticated user
      const role: UserRole = linkedEmp?.systemRole || linkedEmp?.assignedRole || demoAccount?.role || (cleanEmail.includes('customer') ? 'Customer' : 'Admin');
      const isFw = Boolean(
        linkedEmp?.isFieldWorker ??
        demoAccount?.isFieldWorker ??
        [
          'Site Survey Engineer',
          'Site Inspector',
          'Civil Team',
          'Structure Team',
          'Installation Team',
          'Electrical Team',
          'Technician'
        ].includes(role)
      );

      const authenticatedProfile: UserProfile = {
        id: linkedEmp?.id || linkedEmp?.authUid || demoAccount?.email || ('usr-user-' + Date.now()),
        employeeId: linkedEmp?.employeeCode || linkedEmp?.id,
        name: linkedEmp?.name || demoAccount?.name || email.split('@')[0] || 'Solar Team Member',
        email: cleanEmail,
        role,
        phone: linkedEmp?.phone || '+91 98250 11223',
        department: linkedEmp?.department || demoAccount?.department || 'Administration',
        designation: linkedEmp?.designation || demoAccount?.designation || (role as string),
        isFieldWorker: isFw,
        assignedProjects: []
      };

      saveUserProfile(authenticatedProfile);
    } catch (err: any) {
      throw new Error(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const register = async (
    email: string,
    pass: string,
    name: string,
    role: UserRole = 'Admin',
    department?: string,
    designation?: string,
    phone: string = '+91 98250 11223'
  ): Promise<void> => {
    setLoading(true);
    try {
      const isFw = [
        'Site Survey Engineer',
        'Site Inspector',
        'Civil Team',
        'Structure Team',
        'Installation Team',
        'Electrical Team',
        'Technician'
      ].includes(role);

      if (isFirebaseReady) {
        const user = await registerWithEmail(email, pass, name);
        setFirebaseUser(user);
        const newProfile: UserProfile = {
          id: user.uid,
          name: name.trim() || (user.email ? user.email.split('@')[0] : 'Solar User'),
          email: user.email || email.trim(),
          role,
          phone,
          department: department || 'Administration',
          designation: designation || role,
          isFieldWorker: isFw,
          assignedProjects: []
        };
        saveUserProfile(newProfile);
      } else {
        const offlineProfile: UserProfile = {
          id: 'usr-local-' + Date.now(),
          name: name.trim() || email.split('@')[0],
          email: email.trim(),
          role,
          phone,
          department: department || 'Administration',
          designation: designation || role,
          isFieldWorker: isFw,
          assignedProjects: []
        };
        saveUserProfile(offlineProfile);
      }
    } catch (err: any) {
      throw new Error(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    setLoading(true);
    try {
      if (currentUser?.id) {
        liveLocationService.sendOffline(currentUser.id, currentUser.email, currentUser.employeeId).catch(() => {});
      }
      if (isFirebaseReady) {
        try {
          await logoutUser();
        } catch {
          // ignore
        }
      }
      localStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
      setFirebaseUser(null);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string): Promise<void> => {
    if (isFirebaseReady) {
      try {
        await sendPasswordReset(email);
        return;
      } catch (err: any) {
        throw new Error(getFirebaseErrorMessage(err));
      }
    }
    // Simulation in dev
    const clean = email.trim().toLowerCase();
    const match = DEMO_ACCOUNTS.find(d => d.email.toLowerCase() === clean);
    if (!match) {
      throw new Error('No user account found with that email address.');
    }
  };

  const updateRole = (newRole: UserRole) => {
    if (!currentUser) return;
    const def = ROLE_DEFINITIONS.find(r => r.role === newRole);
    const updated: UserProfile = {
      ...currentUser,
      role: newRole,
      department: def?.department || currentUser.department,
      designation: def?.role || currentUser.designation,
      isFieldWorker: Boolean(def?.isFieldWorkerDefault)
    };
    saveUserProfile(updated);
  };

  const switchPersona = (profile: UserProfile) => {
    if (!currentUser) return;
    const def = ROLE_DEFINITIONS.find(r => r.role === profile.role);
    const updated: UserProfile = {
      ...currentUser,
      role: profile.role,
      department: profile.department || def?.department || currentUser.department,
      designation: profile.designation || def?.role || currentUser.designation,
      isFieldWorker: Boolean(profile.isFieldWorker ?? def?.isFieldWorkerDefault)
    };
    saveUserProfile(updated);
  };

  const currentRole: UserRole = currentUser?.role || 'Admin';
  const isCustomer = currentRole === 'Customer';
  const isAdmin = currentRole === 'Admin';
  const isProjectManager = currentRole === 'Project Manager';
  const isFieldStaff = Boolean(
    currentUser?.isFieldWorker ||
    [
      'Site Survey Engineer',
      'Site Inspector',
      'Civil Team',
      'Structure Team',
      'Installation Team',
      'Electrical Team',
      'Technician'
    ].includes(currentRole)
  );

  const hasPermission = (permissionId: string): boolean => {
    if (isAdmin) return true;
    return storageService.hasAclPermission(currentRole, permissionId);
  };

  const canApproveStage = (): boolean => {
    return isAdmin || isProjectManager || hasPermission('projects.stage_approve');
  };

  const canEditFinancials = (): boolean => {
    return isAdmin || currentRole === 'Accountant' || hasPermission('finance.invoices') || hasPermission('finance.receipts');
  };

  const canAccessHR = (): boolean => {
    return isAdmin || currentRole === 'HR Manager' || hasPermission('hrms.manage');
  };

  const canManageProjectAssignments = (): boolean => {
    return isAdmin || hasPermission('projects.assign_team');
  };

  const canAccessModule = (moduleName: string): boolean => {
    if (isAdmin) return true;

    if (isCustomer) {
      return ['customer_portal', 'my_project', 'my_documents', 'my_payments', 'service_request'].includes(moduleName);
    }

    // Role module mapping
    switch (moduleName) {
      case 'dashboard':
        return true;
      case 'live_tracking':
      case 'field_tracking':
        return isAdmin;
      case 'crm':
      case 'crm_leads':
      case 'leads':
      case 'crm_customers':
      case 'customers':
      case 'crm_quotations':
      case 'quotations':
        return (
          hasPermission('crm.leads.view') ||
          hasPermission('crm.quotations.create') ||
          hasPermission('crm.quotations.approve') ||
          ['Sales Manager', 'Sales Executive', 'Project Manager'].includes(currentRole)
        );
      case 'sales_purchase':
      case 'sales':
      case 'purchase':
      case 'inventory':
      case 'bom':
      case 'vendors':
        return hasPermission('inventory.view') || ['Admin', 'Sales Manager', 'Project Manager', 'Accountant'].includes(currentRole);
      case 'projects':
      case 'workflow':
        return hasPermission('projects.view') || !isCustomer;
      case 'site_survey':
        return hasPermission('survey.view') || isAdmin || isProjectManager || currentRole === 'Site Survey Engineer' || currentRole.includes('Sales');
      case 'finance':
      case 'invoices':
      case 'accounting':
      case 'tally':
        return hasPermission('finance.view') || isAdmin || currentRole === 'Accountant';
      case 'hrms':
      case 'employees':
      case 'attendance':
      case 'payroll':
        return hasPermission('hrms.view') || isAdmin || currentRole === 'HR Manager';
      case 'service':
      case 'amc':
        return hasPermission('service.tickets_view') || isAdmin || isProjectManager || currentRole === 'Service Manager' || currentRole === 'Technician';
      case 'reports':
        return hasPermission('reports.view') || isAdmin || isProjectManager || currentRole === 'Sales Manager' || currentRole === 'Accountant';
      case 'users':
      case 'settings':
      case 'roles':
        return isAdmin;
      default:
        return true;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        firebaseUser,
        currentRole,
        loading,
        isAuthenticated: Boolean(currentUser),
        isFirebaseReady,
        login,
        loginWithGoogle: loginWithGoogleAuth,
        register,
        logout,
        resetPassword,
        updateRole,
        switchPersona,
        canAccessModule,
        hasPermission,
        canApproveStage,
        canEditFinancials,
        canAccessHR,
        canManageProjectAssignments,
        isAdmin,
        isCustomer,
        isFieldStaff
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
