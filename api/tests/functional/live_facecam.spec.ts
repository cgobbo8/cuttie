import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { clipDir } from '#services/data_paths'
import { getBrandKit, saveBrandKit } from '#services/brand_kit'
import { readSettings, writeSettings } from '#services/user_settings'

const USUAL = { x: 1518, y: 0, w: 402, h: 446, ref_w: 1920, ref_h: 1080 }

async function setup(detected: object | null, people: Record<string, [number, number][]>) {
  const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
  const job = await Job.create({
    id: randomUUID(),
    url: 'https://twitch.tv/videos/123',
    status: 'DONE',
    userId: user.id,
    hotPoints: [{ clip_filename: 'a.mp4' }, { clip_filename: 'b.mp4' }],
  })
  // What the worker writes at the end of an analysis
  mkdirSync(clipDir(job.id), { recursive: true })
  writeFileSync(
    path.join(clipDir(job.id), 'facecam.json'),
    JSON.stringify({ version: 2, rect: detected, frame_w: 1920, frame_h: 1080, people })
  )
  return { user, job }
}

test.group('Webcam on each live', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    const settings = readSettings()
    delete settings.brand_kit
    writeSettings(settings)
    saveBrandKit({ facecam: USUAL })
  })
  const cleanup: string[] = []
  group.teardown(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  test('uses the usual position, and drops the cam from clips where nobody is in it', async ({ client, assert }) => {
    const { user, job } = await setup(
      { x: 1516, y: 0, w: 404, h: 446 },
      { 'a.mp4': [[1720, 270], [500, 600]], 'b.mp4': [[500, 600]] }
    )
    cleanup.push(clipDir(job.id))

    const a = (await client.get(`/api/clips/${job.id}/a.mp4/edit-env`).loginAs(user)).body() as any
    assert.deepEqual(a.facecam, { x: 1518, y: 0, w: 402, h: 446 })
    assert.deepInclude(a.cam, { source: 'brand', moved: false, visible: true })

    const b = (await client.get(`/api/clips/${job.id}/b.mp4/edit-env`).loginAs(user)).body() as any
    assert.isNull(b.facecam)
    assert.deepInclude(b.cam, { source: 'brand', visible: false })
    assert.deepEqual(b.cam.rect, { x: 1518, y: 0, w: 402, h: 446 })
  })

  test('judges the cam on the part of the clip that gets exported', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    // The AI's cut is the end of the clip, where the stream put the webcam full screen
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'DONE',
      userId: user.id,
      hotPoints: [{ clip_filename: 'a.mp4', llm: { cut_start: 50, cut_end: 75 } }],
    })
    cleanup.push(clipDir(job.id))
    // Checked every 4 s: the streamer in the cam for 40 s, then a face in the middle of the frame
    const frames = Array.from({ length: 20 }, (_, i) => i * 4)
    mkdirSync(clipDir(job.id), { recursive: true })
    writeFileSync(
      path.join(clipDir(job.id), 'facecam.json'),
      JSON.stringify({
        version: 3,
        rect: { x: 1516, y: 0, w: 404, h: 446 },
        frame_w: 1920,
        frame_h: 1080,
        people: { 'a.mp4': frames.map((t) => (t < 40 ? [1720, 270, t] : [900, 500, t])) },
        frames: { 'a.mp4': frames },
      })
    )

    const cut = (await client.get(`/api/clips/${job.id}/a.mp4/edit-env`).loginAs(user)).body() as any
    assert.isNull(cut.facecam)
    assert.deepInclude(cut.cam, { source: 'brand', visible: false })

    // The streamer keeps the start instead: the cam is back
    ;(await client.patch(`/api/jobs/${job.id}/selection`).loginAs(user).json({ clip_filename: 'a.mp4', trim: [5, 30] })).assertStatus(200)
    const trimmed = (await client.get(`/api/clips/${job.id}/a.mp4/edit-env`).loginAs(user)).body() as any
    assert.deepEqual(trimmed.facecam, { x: 1518, y: 0, w: 402, h: 446 })
    assert.isTrue(trimmed.cam.visible)
  })

  test('follows the cam when it moved on this live', async ({ client, assert }) => {
    const moved = { x: 0, y: 640, w: 400, h: 440 }
    const { user, job } = await setup(moved, { 'a.mp4': [[200, 860]] })
    cleanup.push(clipDir(job.id))

    const a = (await client.get(`/api/clips/${job.id}/a.mp4/edit-env`).loginAs(user)).body() as any
    assert.deepEqual(a.facecam, moved)
    assert.deepInclude(a.cam, { source: 'detected', moved: true, visible: true })
  })

  test('saves a framing for this live, and optionally as the usual one', async ({ client, assert }) => {
    const { user, job } = await setup(null, {})
    cleanup.push(clipDir(job.id))
    const rect = { x: 10, y: 600, w: 420, h: 460, ref_w: 1920, ref_h: 1080 }

    const saved = await client.put(`/api/jobs/${job.id}/facecam`).loginAs(user).json({ facecam: rect })
    saved.assertStatus(200)
    assert.deepEqual((await Job.findOrFail(job.id)).facecam, rect)
    assert.deepEqual((await getBrandKit()).facecam, USUAL)

    const env = (await client.get(`/api/clips/${job.id}/a.mp4/edit-env`).loginAs(user)).body() as any
    assert.deepInclude(env.cam, { source: 'live', moved: false })
    assert.deepEqual(env.cam.rect, { x: 10, y: 600, w: 420, h: 460 })

    await client.put(`/api/jobs/${job.id}/facecam`).loginAs(user).json({ facecam: rect, remember: true })
    assert.deepEqual((await getBrandKit()).facecam, rect)

    // Back to automatic
    await client.put(`/api/jobs/${job.id}/facecam`).loginAs(user).json({ facecam: null })
    assert.isNull((await Job.findOrFail(job.id)).facecam)
  })

  test('rejects bad rectangles and other people', async ({ client }) => {
    const { user, job } = await setup(null, {})
    cleanup.push(clipDir(job.id))
    const url = `/api/jobs/${job.id}/facecam`
    ;(await client.put(url).loginAs(user).json({ facecam: { x: 1800, y: 0, w: 400, h: 400 } })).assertStatus(400)
    ;(await client.put(url).loginAs(user).json({ facecam: 'top-right' })).assertStatus(400)
    const other = await User.create({ fullName: 'Other', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    ;(await client.put(url).loginAs(other).json({ facecam: null })).assertStatus(404)
  })
})
