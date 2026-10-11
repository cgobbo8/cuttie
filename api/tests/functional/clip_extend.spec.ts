import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { clipDir } from '#services/data_paths'

test.group('Clips | 30 s more', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const cleanup: string[] = []
  group.teardown(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  async function setup() {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'DONE',
      userId: user.id,
      vodDurationSeconds: 18000,
      hotPoints: [{ clip_filename: 'a.mp4', clip_start: 1000, clip_end: 1090, llm: { cut_start: 20, cut_end: 50, key_moments: [] } }],
      selection: { 'a.mp4': { state: 'kept' } },
    })
    const dir = clipDir(job.id)
    cleanup.push(dir)
    mkdirSync(path.join(dir, 'thumbs'), { recursive: true })
    writeFileSync(path.join(dir, 'a.mp4'), '')
    writeFileSync(path.join(dir, 'a_meta.json'), JSON.stringify({ vod_start: 1000, vod_end: 1090 }))
    writeFileSync(path.join(dir, 'thumbs', 'a_480_200.jpg'), '')
    return { user, job, dir }
  }

  test('with room in the clip, only the cut grows', async ({ client, assert }) => {
    const { user, job } = await setup()

    const response = await client.post(`/api/clips/${job.id}/a.mp4/extend`).loginAs(user).json({ side: 'end' })
    response.assertStatus(200)
    assert.deepEqual(response.body(), { extended: false, trim: [20, 80] })
    await job.refresh()
    assert.deepEqual(job.selection?.['a.mp4'], { state: 'kept', trim: [20, 80] })
  })

  test('when the clip has to grow and the live cannot be read, nothing changes', async ({ client, assert }) => {
    const { user, job, dir } = await setup()

    // 30 s before a cut starting at 20 s: the file has to grow, and no worker answers here
    const response = await client.post(`/api/clips/${job.id}/a.mp4/extend`).loginAs(user).json({ side: 'start' })
    response.assertStatus(502)
    await job.refresh()
    assert.deepEqual(job.selection?.['a.mp4'], { state: 'kept' })
    assert.equal((job.hotPoints as any)[0].clip_start, 1000)
    assert.isTrue(existsSync(path.join(dir, 'thumbs', 'a_480_200.jpg')))
  })

  test('refuses another side, another clip and another streamer', async ({ client }) => {
    const { user, job } = await setup()
    ;(await client.post(`/api/clips/${job.id}/a.mp4/extend`).loginAs(user).json({ side: 'middle' })).assertStatus(400)
    ;(await client.post(`/api/clips/${job.id}/b.mp4/extend`).loginAs(user).json({ side: 'end' })).assertStatus(404)
    const other = await User.create({ fullName: 'Other', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    ;(await client.post(`/api/clips/${job.id}/a.mp4/extend`).loginAs(other).json({ side: 'end' })).assertStatus(404)
  })
})
