import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

interface ThemeRow {
  id: number
  user_id: number
  name: string
  layers: string
  is_default: number
  created_at: string
  updated_at: string
}

function serializeTheme(row: ThemeRow) {
  return {
    id: row.id,
    name: row.name,
    layers: typeof row.layers === 'string' ? JSON.parse(row.layers) : row.layers,
    is_default: !!row.is_default,
    created_at: row.created_at,
  }
}

export default class ThemesController {
  /** GET /api/themes — list current user's themes */
  async index({ response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const rows = await db.from('themes').where('user_id', user.id).orderBy('created_at', 'asc')
    return response.json(rows.map(serializeTheme))
  }

  /** POST /api/themes — create a new theme */
  async store({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const { name, layers, is_default } = request.body() as {
      name: string
      layers: unknown[]
      is_default?: boolean
    }

    if (!name?.trim() || !layers || !Array.isArray(layers)) {
      return response.badRequest({ error: 'name and layers array required' })
    }

    if (is_default) {
      await db.from('themes').where('user_id', user.id).where('is_default', true).update({ is_default: false })
    }

    const now = new Date().toISOString()
    const [id] = await db.table('themes').insert({
      user_id: user.id,
      name: name.trim(),
      layers: JSON.stringify(layers),
      is_default: is_default ? 1 : 0,
      built_in: 0,
      created_at: now,
      updated_at: now,
    })

    const row = await db.from('themes').where('id', id).first()
    return response.created(serializeTheme(row))
  }

  /** PATCH /api/themes/:id — update name, layers, or default */
  async update({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const row = await db.from('themes').where('id', params.id).where('user_id', user.id).first()
    if (!row) return response.notFound({ error: 'theme not found' })

    const body = request.body() as { name?: string; layers?: unknown[]; is_default?: boolean }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.name !== undefined) updates.name = body.name.trim()
    if (body.layers !== undefined) updates.layers = JSON.stringify(body.layers)
    if (body.is_default !== undefined) {
      if (body.is_default) {
        await db.from('themes').where('user_id', user.id).where('is_default', true).update({ is_default: false })
      }
      updates.is_default = body.is_default ? 1 : 0
    }

    await db.from('themes').where('id', params.id).update(updates)
    const updated = await db.from('themes').where('id', params.id).first()
    return response.json(serializeTheme(updated))
  }

  /** DELETE /api/themes/:id */
  async destroy({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const row = await db.from('themes').where('id', params.id).where('user_id', user.id).first()
    if (!row) return response.notFound({ error: 'theme not found' })

    await db.from('themes').where('id', params.id).delete()
    return response.json({ success: true })
  }

  /** POST /api/themes/:id/default — set as default (or unset if already default) */
  async setDefault({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const row = await db.from('themes').where('id', params.id).where('user_id', user.id).first()
    if (!row) return response.notFound({ error: 'theme not found' })

    const wasDefault = !!row.is_default

    // Clear all defaults for this user
    await db.from('themes').where('user_id', user.id).where('is_default', true).update({ is_default: false })

    // Toggle: if it wasn't default, make it default
    if (!wasDefault) {
      await db.from('themes').where('id', params.id).update({ is_default: 1 })
    }

    return response.json({ is_default: !wasDefault })
  }
}
