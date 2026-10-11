import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DateTime } from 'luxon'
import User from '#models/user'
import Job from '#models/job'
import { SETTINGS_PATH, STORAGE_DIR, clipDir } from '#services/data_paths'
import { stale, type ProjectSpace } from '#services/disk_space'

const MB = 1_000_000

test.group('Disk space | freeing clips', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const cleanup: string[] = []
  let settingsBefore: string | null = null
  group.setup(() => {
    settingsBefore = existsSync(SETTINGS_PATH) ? readFileSync(SETTINGS_PATH, 'utf-8') : null
  })
  group.teardown(() => {
    cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    if (settingsBefore === null) rmSync(SETTINGS_PATH, { force: true })
    else writeFileSync(SETTINGS_PATH, settingsBefore)
  })

  /** A finished project: 2 clips of 1 MB with their sidecars, a backdrop, a thumbnail, an export */
  async function project(user: User, idleDays = 0) {
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'DONE',
      userId: user.id,
      hotPoints: [
        { clip_filename: 'a.mp4', clip_start: 1000, clip_end: 1060 },
        { clip_filename: 'b.mp4', clip_start: 2000, clip_end: 2050 },
      ],
      selection: { 'a.mp4': { state: 'kept' } },
    })
    const dir = clipDir(job.id)
    const renders = path.join(STORAGE_DIR, 'renders', job.id)
    cleanup.push(dir, renders)
    mkdirSync(path.join(dir, 'thumbs'), { recursive: true })
    mkdirSync(path.join(dir, 'bg'), { recursive: true })
    mkdirSync(renders, { recursive: true })
    for (const name of ['a', 'b']) {
      writeFileSync(path.join(dir, `${name}.mp4`), Buffer.alloc(MB))
      writeFileSync(path.join(dir, `${name}_meta.json`), JSON.stringify({ vod_start: 999, vod_end: 1061 }))
      writeFileSync(path.join(dir, `${name}_words.json`), '[]')
      writeFileSync(path.join(dir, 'thumbs', `${name}_480_240.jpg`), 'jpeg')
    }
    writeFileSync(path.join(dir, 'bg', 'a_bg.mp4'), Buffer.alloc(MB / 2))
    writeFileSync(path.join(renders, 'render_a.mp4'), Buffer.alloc(MB / 4))
    await db.table('renders').insert({
      id: randomUUID(),
      job_id: job.id,
      user_id: user.id,
      clip_filename: 'a.mp4',
      status: 'done',
      output_filename: 'render_a.mp4',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (idleDays) {
      const long = DateTime.utc().minus({ days: idleDays }).toFormat('yyyy-MM-dd HH:mm:ss')
      await db.from('jobs').where('id', job.id).update({ created_at: long, updated_at: long })
      const longIso = DateTime.utc().minus({ days: idleDays }).toISO()
      await db.from('renders').where('job_id', job.id).update({ created_at: longIso, updated_at: longIso })
    }
    return { job, dir, renders }
  }

  test('freeing a project deletes its clips and backdrops, nothing else', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const { job, dir, renders } = await project(user)

    const response = await client.post(`/api/jobs/${job.id}/free`).loginAs(user)
    response.assertStatus(200)
    assert.equal(response.body().freed, 2.5 * MB)
    assert.isString(response.body().clips_freed_at)

    assert.isFalse(existsSync(path.join(dir, 'a.mp4')))
    assert.isFalse(existsSync(path.join(dir, 'bg')))
    for (const kept of ['a_meta.json', 'a_words.json', 'thumbs/a_480_240.jpg']) assert.isTrue(existsSync(path.join(dir, kept)), kept)
    assert.isTrue(existsSync(path.join(renders, 'render_a.mp4')))

    // The project says so, and keeps showing its pictures
    const list = await client.get('/api/jobs').loginAs(user)
    const summary = list.body().data.find((j: any) => j.id === job.id)
    assert.isString(summary?.clipsFreedAt)
    assert.equal(summary?.clipsBytes, 0)
    const thumb = await client.get(`/api/clips/${job.id}/a.mp4/thumb?w=1280`).loginAs(user)
    thumb.assertStatus(200)
    ;(await client.get(`/api/clips/${job.id}/c.mp4/thumb`).loginAs(user)).assertStatus(404)
  })

  test('the cleanup frees the projects idle for its days, and only those', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const old = await project(user, 40)
    const recent = await project(user, 3)

    const disk = await client.get('/api/disk').loginAs(user)
    disk.assertStatus(200)
    assert.deepEqual(disk.body().cleanable['30'], { projects: 1, bytes: 2.5 * MB })
    assert.deepEqual(disk.body().cleanable['7'], { projects: 1, bytes: 2.5 * MB })
    assert.isAtLeast(disk.body().usage.clips, 5 * MB)
    assert.isAtLeast(disk.body().usage.exports, MB / 2)

    const turnedOn = await client.put('/api/disk/cleanup').loginAs(user).json({ days: 30 })
    turnedOn.assertStatus(200)
    assert.equal(turnedOn.body().cleanup_days, 30)
    assert.isFalse(existsSync(path.join(old.dir, 'a.mp4')))
    assert.isTrue(existsSync(path.join(recent.dir, 'a.mp4')))
    assert.equal(JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')).cleanup_days, 30)
    assert.equal((await client.get('/api/disk').loginAs(user)).body().cleanup_days, 30)

    // By hand, a shorter time
    const now = await client.post('/api/disk/free').loginAs(user).json({ days: 7 })
    now.assertStatus(200)
    assert.deepEqual(now.body(), { projects: 0, bytes: 0 })
    ;(await client.put('/api/disk/cleanup').loginAs(user).json({ days: 12 })).assertStatus(400)
  })

  test('a project being analyzed or exported is not freed', ({ assert }) => {
    const base: ProjectSpace = {
      id: 'x',
      title: null,
      date: null,
      status: 'DONE',
      last_activity: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      clips: MB,
      exports: 0,
      kept: 0,
      exported: 0,
      freed_at: null,
      rendering: false,
    }
    assert.lengthOf(stale([base], 30), 1)
    assert.lengthOf(stale([base], 0), 0)
    assert.lengthOf(stale([{ ...base, status: 'ANALYZING_CLIPS' }], 30), 0)
    assert.lengthOf(stale([{ ...base, rendering: true }], 30), 0)
    assert.lengthOf(stale([{ ...base, clips: 0 }], 30), 0)
    assert.lengthOf(stale([{ ...base, last_activity: new Date().toISOString() }], 30), 0)
  })

  test('getting the clips back needs the worker; another streamer cannot', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const other = await User.create({ fullName: 'Other', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    const { job } = await project(user)
    ;(await client.post(`/api/jobs/${job.id}/free`).loginAs(other)).assertStatus(404)
    await client.post(`/api/jobs/${job.id}/free`).loginAs(user)

    // No worker in tests: the clips stay freed
    const restore = await client.post(`/api/jobs/${job.id}/restore`).loginAs(user)
    restore.assertStatus(502)
    await job.refresh()
    assert.isNotNull(job.clipsFreedAt)
  })
})
