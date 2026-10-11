import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { clipDir } from '#services/data_paths'

test.group('Jobs | chat of each clip', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const cleanup: string[] = []
  group.teardown(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  test('gives when the chat spoke in each clip, in clip seconds', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'DONE',
      userId: user.id,
      hotPoints: [{ clip_filename: 'a.mp4' }, { clip_filename: 'b.mp4' }],
    })
    const dir = clipDir(job.id)
    cleanup.push(dir)
    mkdirSync(dir, { recursive: true })
    // What the worker leaves next to the clips
    writeFileSync(
      path.join(dir, 'chat.json'),
      JSON.stringify([
        { timestamp: 95, text: 'avant', author: 'Ellyia' },
        { timestamp: 112.34, text: 'MDRRR', author: 'Ellyia' },
        { timestamp: 130, text: '<3 PansexualPride', author: 'johnnyyt19', emotes: ['<3', 'PansexualPride'] },
        { timestamp: 400, text: 'plus tard', author: 'EvaAinsworth' },
      ])
    )
    writeFileSync(path.join(dir, 'a_meta.json'), JSON.stringify({ vod_start: 100, vod_end: 160 }))

    const response = await client.get(`/api/jobs/${job.id}/chat`).loginAs(user)
    response.assertStatus(200)
    assert.deepEqual((response.body() as any).clips, {
      'a.mp4': [
        { t: 12.3, author: 'Ellyia', text: 'MDRRR' },
        { t: 30, author: 'johnnyyt19', text: '<3 PansexualPride' },
      ],
      // No _meta.json: no window to read
      'b.mp4': [],
    })

    const other = await User.create({ fullName: 'Other', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    ;(await client.get(`/api/jobs/${job.id}/chat`).loginAs(other)).assertStatus(404)
  })
})
