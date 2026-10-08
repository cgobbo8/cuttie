import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import User from '#models/user'
import Job from '#models/job'
import jobStatusBus from '#services/job_status_bus'

test.group('Jobs | live analysis timeline', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('merges the timeline and candidate updates pushed by the worker', async ({ assert }) => {
    const user = await User.create({ fullName: 'S', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const job = await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/1', status: 'ANALYZING_CHAT', userId: user.id })

    await jobStatusBus.handle({ job_id: job.id, status: '', type: 'timeline', timeline: { duration: 3600, energy: [0.1, 0.9], chat: [3, 0], candidates: [] } })
    await jobStatusBus.handle({ job_id: job.id, status: '', type: 'timeline', timeline: { candidates: [{ t: 100, state: 'pending' }, { t: 2000, state: 'pending' }] } })
    await jobStatusBus.handle({ job_id: job.id, status: '', type: 'candidate', candidate: { t: 2000, state: 'rated', score: 0.71, name: 'Fail moto' } })

    const timeline = (await Job.findOrFail(job.id)).timeline!
    assert.equal(timeline.duration, 3600)
    assert.deepEqual(timeline.energy, [0.1, 0.9])
    assert.deepEqual(timeline.candidates, [
      { t: 100, state: 'pending' },
      { t: 2000, state: 'rated', score: 0.71, name: 'Fail moto' },
    ])
    // The status is untouched by timeline events
    assert.equal((await Job.findOrFail(job.id)).status, 'ANALYZING_CHAT')
  })
})
