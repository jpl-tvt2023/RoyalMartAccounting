import { useAuth } from '../context/AuthContext';
import { ADMIN_ONLY, ROLES } from '../utils/roles';

// What the signed-in user may do. The API is the real gate; this only shapes
// the UI (which buttons and links to show).
export function useRBAC() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canAccess = (...allowed) => !!user && allowed.some((r) => roles.includes(r));
  const isAdmin = roles.some((r) => ADMIN_ONLY.includes(r));
  // A Viewer reads only; every other role may change things.
  const canEdit = roles.some((r) => r !== ROLES.VIEWER);
  return { canAccess, roles, isAdmin, canEdit };
}
