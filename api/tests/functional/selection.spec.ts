import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import User from '#models/user'
import Job from '#models/job'

async function setup() {
  const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
  const job = await Job.create({
    id: randomUUID(),
    url: 'https://twitch.tv/videos/123',
    status: 'DONE',
    userId: user.id,
    hotPoints: [
      { clip_filename: 'a.mp4', clip_start: 100, clip_end: 160 },
      { clip_filename: 'b.mp4', clip_start: 300, clip_end: 350 },
    ],
  })
  return { user, job }
}

test.group('Jobs | selection', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('keeps, passes and trims clips', async ({ client, assert }) => {
    const { user, job } = await setup()
    const url = `/api/jobs/${job.id}/selection`

    ;(await client.patch(url).loginAs(user).json({ clip_filename: 'a.mp4', state: 'kept' })).assertStatus(200)
    ;(await client.patch(url).loginAs(user).json({ clip_filename: 'b.mp4', state: 'passed' })).assertStatus(200)
    const response = await client.patch(url).loginAs(user).json({ clip_filename: 'a.mp4', trim: [2.04, 41.96] })
    response.assertStatus(200)
    assert.deepEqual((response.body() as any).selection, {
      'a.mp4': { state: 'kept', trim: [2, 42] },
      'b.mp4': { state: 'passed' },
    })

    // Shown with the job
    const shown = await client.get(`/api/jobs/${job.id}`).loginAs(user)
    assert.deepEqual((shown.body() as any).selection['b.mp4'], { state: 'passed' })

    // Clearing everything removes the entry
    await client.patch(url).loginAs(user).json({ clip_filename: 'b.mp4', state: null })
    assert.notProperty((await Job.findOrFail(job.id)).selection, 'b.mp4')
  })

  test('rejects unknown clips and bad values', async ({ client }) => {
    const { user, job } = await setup()
    const url = `/api/jobs/${job.id}/selection`
    ;(await client.patch(url).loginAs(user).json({ clip_filename: '../c.mp4', state: 'kept' })).assertStatus(400)
    ;(await client.patch(url).loginAs(user).json({ clip_filename: 'a.mp4', state: 'maybe' })).assertStatus(400)
    ;(await client.patch(url).loginAs(user).json({ clip_filename: 'a.mp4', trim: [10, 10.5] })).assertStatus(400)
  })

  test("can't touch someone else's job", async ({ client }) => {
    const { job } = await setup()
    const other = await User.create({ fullName: 'Other', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    const response = await client.patch(`/api/jobs/${job.id}/selection`).loginAs(other).json({ clip_filename: 'a.mp4', state: 'kept' })
    response.assertStatus(404)
  })
})
