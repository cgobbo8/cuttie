/**
 * Single local user of the desktop app. Every request coming from this machine
 * is signed in as this user (see auth_middleware), so there is no login screen.
 */

import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import User from '#models/user'

const LOCAL_EMAIL = 'local@cuttie.app'
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

let cached: User | null = null

export function autoLoginEnabled(): boolean {
  return env.get('CUTTIE_AUTO_LOGIN') ?? true
}

function displayName(): string {
  try {
    const name = os.userInfo().username
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Streamer'
  } catch {
    return 'Streamer'
  }
}

export async function ensureLocalUser(): Promise<User> {
  if (cached) return cached

  const user = await User.firstOrCreate(
    { email: LOCAL_EMAIL },
    { email: LOCAL_EMAIL, fullName: displayName(), password: randomBytes(24).toString('hex') }
  )
  await db
    .insertQuery()
    .table('user_permissions')
    .insert({ user_id: user.id, permission: '*', created_at: new Date().toISOString() })
    .onConflict(['user_id', 'permission'])
    .ignore()

  cached = user
  return user
}

/**
 * True for browser requests made by the app itself on this machine: loopback
 * client, loopback Host header (blocks DNS rebinding) and no cross-site fetch
 * (blocks other websites from driving the local API).
 */
export function isLocalAppRequest(ctx: HttpContext): boolean {
  if (!LOOPBACK_IPS.has(ctx.request.ip())) return false

  const host = (ctx.request.header('host') ?? '').replace(/:\d+$/, '').toLowerCase()
  if (!LOOPBACK_HOSTS.has(host)) return false

  const fetchSite = ctx.request.header('sec-fetch-site')
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}

/** Sign the request in as the local user when allowed. Returns true on success. */
export async function tryLocalAutoLogin(ctx: HttpContext): Promise<boolean> {
  if (!autoLoginEnabled() || !isLocalAppRequest(ctx)) return false
  const user = await ensureLocalUser()
  await ctx.auth.use('web').login(user)
  return true
}
