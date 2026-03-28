import { test } from '@japa/runner'
import User from '#models/user'
import Job from '#models/job'
import { randomUUID } from 'node:crypto'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Jobs | Unauthenticated', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('should reject unauthenticated POST /analyze', async ({ client }) => {
    const response = await client.post('/api/analyze').json({ url: 'https://twitch.tv/videos/123' })
    response.assertStatus(401)
  })

  test('should reject unauthenticated GET /jobs', async ({ client }) => {
    const response = await client.get('/api/jobs')
    response.assertStatus(401)
  })

  test('should reject unauthenticated GET /jobs/:id', async ({ client }) => {
    const response = await client.get(`/api/jobs/${randomUUID()}`)
    response.assertStatus(401)
  })

  test('should reject unauthenticated DELETE /jobs/:id', async ({ client }) => {
    const response = await client.delete(`/api/jobs/${randomUUID()}`)
    response.assertStatus(401)
  })

  test('should reject unauthenticated POST /jobs/:id/retry', async ({ client }) => {
    const response = await client.post(`/api/jobs/${randomUUID()}/retry`)
    response.assertStatus(401)
  })
})

test.group('Jobs | Data model', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('should create job with all fields', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Test',
      email: 'test@cuttie.com',
      password: 'password123',
    })

    const jobId = randomUUID()
    const job = await Job.create({
      id: jobId,
      url: 'https://twitch.tv/videos/123',
      status: 'PENDING',
      userId: user.id,
    })

    assert.equal(job.id, jobId)
    assert.equal(job.status, 'PENDING')
    assert.equal(job.userId, user.id)
  })

  test('should update job status', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Test',
      email: 'test@cuttie.com',
      password: 'password123',
    })

    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'PENDING',
      userId: user.id,
    })

    job.status = 'DONE'
    await job.save()

    const refreshed = await Job.findOrFail(job.id)
    assert.equal(refreshed.status, 'DONE')
  })

  test('should store and retrieve hot_points JSON', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Test',
      email: 'test@cuttie.com',
      password: 'password123',
    })

    const hotPoints = [
      { clip_filename: 'clip_01.mp4', rank: 1, score: 0.85 },
      { clip_filename: 'clip_02.mp4', rank: 2, score: 0.72 },
    ]

    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'DONE',
      userId: user.id,
      hotPoints,
    })

    const refreshed = await Job.findOrFail(job.id)
    assert.isArray(refreshed.hotPoints)
    assert.equal(refreshed.hotPoints!.length, 2)
    assert.equal(refreshed.hotPoints![0].clip_filename, 'clip_01.mp4')
  })

  test('should filter jobs by user ownership', async ({ assert }) => {
    const user1 = await User.create({ fullName: 'U1', email: 'u1@cuttie.com', password: 'password123' })
    const user2 = await User.create({ fullName: 'U2', email: 'u2@cuttie.com', password: 'password123' })

    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/1', status: 'DONE', userId: user1.id })
    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/2', status: 'DONE', userId: user1.id })
    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/3', status: 'DONE', userId: user2.id })

    const user1Jobs = await Job.query().where('user_id', user1.id)
    const user2Jobs = await Job.query().where('user_id', user2.id)

    assert.equal(user1Jobs.length, 2)
    assert.equal(user2Jobs.length, 1)
  })

  test('should query by status', async ({ assert }) => {
    const user = await User.create({ fullName: 'Test', email: 'test@cuttie.com', password: 'password123' })

    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/1', status: 'DONE', userId: user.id })
    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/2', status: 'ERROR', userId: user.id })
    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/3', status: 'PENDING', userId: user.id })

    const done = await Job.query().where('user_id', user.id).where('status', 'DONE')
    const error = await Job.query().where('user_id', user.id).where('status', 'ERROR')
    const pending = await Job.query().where('user_id', user.id).whereNotIn('status', ['DONE', 'ERROR'])

    assert.equal(done.length, 1)
    assert.equal(error.length, 1)
    assert.equal(pending.length, 1)
  })

  test('should search by vod_title with LIKE', async ({ assert }) => {
    const user = await User.create({ fullName: 'Test', email: 'test@cuttie.com', password: 'password123' })

    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/1', status: 'DONE', userId: user.id, vodTitle: 'Monster Hunter Wilds gameplay' })
    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/2', status: 'DONE', userId: user.id, vodTitle: 'Crimson Desert review' })

    const results = await Job.query()
      .where('user_id', user.id)
      .whereLike('vod_title', '%monster%')

    assert.equal(results.length, 1)
    assert.include(results[0].vodTitle!, 'Monster')
  })
})
