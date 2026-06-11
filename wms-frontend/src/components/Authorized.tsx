import React from 'react';
import { useCan, type Role } from '../router/permissions';

interface AuthorizedProps {
  roles?: Role[];
  action?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Gates UI by the current user's role. Pass either an explicit `roles` list or an
 * `action` capability key (see actionPermissions in router/permissions.ts).
 * NOTE: this only hides UI — the backend @Roles guard is the real enforcement.
 */
const Authorized: React.FC<AuthorizedProps> = ({ roles, action, fallback = null, children }) => {
  const ok = useCan(roles ?? action);
  return <>{ok ? children : fallback}</>;
};

export default Authorized;
