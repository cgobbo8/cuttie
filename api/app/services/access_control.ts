import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'

/**
 * Permission format: `domain:action`
 * Wildcards: `*` (all), `domain:*` (all actions in domain)
 *
 * Quota format: key like `jobs`, `renders`, `storage_mb`
 * Periods: `daily`, `monthly`, `yearly`, `lifetime`
 */

function permissionMatches(granted: string, required: string): boolean {
  if (granted === '*') return true
  if (granted === required) return true
  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -1) // 'editor:*' → 'editor:'
    return required.startsWith(prefix)
  }
  return false
}

export interface QuotaCheck {
  allowed: boolean
  current: number
  limit: number
  remaining: number
}

const accessControl = {
  /**
   * Check if user has a boolean permission (supports wildcards).
   */
  async can(user: User, permission: string): Promise<boolean> {
    const rows = await db
      .from('user_permissions')
      .where('user_id', user.id)
      .select('permission')

    return rows.some((row) => permissionMatches(row.permission, permission))
  },

  /**
   * Check a quota by counting actual rows in the relevant table.
   * Returns { allowed, current, limit, remaining }.
   *
   * The quota `key` maps to a table + optional time filter:
   * - `jobs` → count of user's jobs
   * - `renders` → count of user's renders
   *
   * The period is stored in user_quotas and determines the time window.
   */
  async checkQuota(user: User, key: string): Promise<QuotaCheck> {
    const quota = await db
      .from('user_quotas')
      .where('user_id', user.id)
      .where('key', key)
      .first()

    // No quota configured → unlimited
    if (!quota) {
      return { allowed: true, current: 0, limit: -1, remaining: -1 }
    }

    const current = await countUsage(user.id, key, quota.period as string)

    return {
      allowed: current < quota.limit,
      current,
      limit: quota.limit,
      remaining: Math.max(0, quota.limit - current),
    }
  },
}

/**
 * Count actual usage from DB tables based on the quota key and period.
 */
async function countUsage(userId: number, key: string, period: string): Promise<number> {
  const tableMap: Record<string, { table: string; dateCol: string }> = {
    jobs: { table: 'jobs', dateCol: 'created_at' },
    renders: { table: 'renders', dateCol: 'created_at' },
  }

  const mapping = tableMap[key]
  if (!mapping) return 0

  let query = db
    .from(mapping.table)
    .where('user_id', userId)

  const periodStart = getPeriodStart(period)
  if (periodStart) {
    query = query.where(mapping.dateCol, '>=', periodStart)
  }

  const [{ count }] = await query.count('* as count')
  return Number(count)
}

function getPeriodStart(period: string): string | null {
  const now = new Date()
  switch (period) {
    case 'daily': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return d.toISOString()
    }
    case 'monthly': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return d.toISOString()
    }
    case 'yearly': {
      const d = new Date(now.getFullYear(), 0, 1)
      return d.toISOString()
    }
    case 'lifetime':
      return null
    default:
      return null
  }
}

export default accessControl
