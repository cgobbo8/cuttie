import { useMemo } from "react";
import { useAuth } from "./AuthContext";
import type { UserQuota } from "./api";

function permissionMatches(granted: string, required: string): boolean {
  if (granted === "*") return true;
  if (granted === required) return true;
  if (granted.endsWith(":*")) {
    const prefix = granted.slice(0, -1); // 'editor:*' → 'editor:'
    return required.startsWith(prefix);
  }
  return false;
}

/**
 * Check if the current user has a permission (with wildcard support).
 *
 * ```tsx
 * const canUseAi = useAccess("ai:write");
 * ```
 */
export function useAccess(permission: string): boolean {
  const { user } = useAuth();
  return useMemo(() => {
    if (!user?.permissions) return false;
    return user.permissions.some((p) => permissionMatches(p, permission));
  }, [user?.permissions, permission]);
}

export interface QuotaInfo {
  allowed: boolean;
  limit: number;
  key: string;
  period: UserQuota["period"];
}

/**
 * Get quota info for the current user.
 * Returns null if no quota is configured (= unlimited).
 *
 * ```tsx
 * const jobsQuota = useQuota("jobs");
 * // jobsQuota?.limit === 5, jobsQuota?.allowed === true
 * ```
 *
 * Note: `allowed` here only reflects the quota config, not current usage.
 * The backend is the source of truth for actual usage checks.
 */
export function useQuota(key: string): QuotaInfo | null {
  const { user } = useAuth();
  return useMemo(() => {
    if (!user?.quotas) return null;
    const quota = user.quotas.find((q) => q.key === key);
    if (!quota) return null;
    return {
      allowed: true,
      limit: quota.limit,
      key: quota.key,
      period: quota.period,
    };
  }, [user?.quotas, key]);
}
