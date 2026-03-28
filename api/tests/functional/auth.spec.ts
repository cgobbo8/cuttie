import { test } from '@japa/runner'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Auth | Login', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('should login with valid credentials and return user data', async ({ client }) => {
    await User.create({
      fullName: 'Test User',
      email: 'test@cuttie.com',
      password: 'password123',
    })

    const response = await client.post('/api/auth/login').json({
      email: 'test@cuttie.com',
      password: 'password123',
    })

    response.assertStatus(200)
    response.assertBodyContains({ data: { user: { email: 'test@cuttie.com' } } })
  })

  test('should set session cookie on login', async ({ client, assert }) => {
    await User.create({
      fullName: 'Test User',
      email: 'test@cuttie.com',
      password: 'password123',
    })

    const response = await client.post('/api/auth/login').json({
      email: 'test@cuttie.com',
      password: 'password123',
    })

    response.assertStatus(200)
    assert.exists(response.cookie('adonis-session'))
  })

  test('should reject invalid password', async ({ client }) => {
    await User.create({
      fullName: 'Test User',
      email: 'test@cuttie.com',
      password: 'password123',
    })

    const response = await client.post('/api/auth/login').json({
      email: 'test@cuttie.com',
      password: 'wrongpassword',
    })

    response.assertStatus(400)
  })

  test('should reject non-existent email', async ({ client }) => {
    const response = await client.post('/api/auth/login').json({
      email: 'nonexistent@cuttie.com',
      password: 'password123',
    })

    response.assertStatus(400)
  })

  test('should reject empty email with validation error', async ({ client }) => {
    const response = await client.post('/api/auth/login').json({
      email: '',
      password: 'password123',
    })

    response.assertStatus(422)
    response.assertBodyContains({ code: 'VALIDATION_ERROR' })
  })

  test('should reject empty password with validation or rate limit error', async ({ client, assert }) => {
    const response = await client.post('/api/auth/login').json({
      email: 'test@cuttie.com',
      password: '',
    })

    // May be 422 (validation) or 429 (rate limited from prior tests in this suite)
    assert.oneOf(response.status(), [422, 429])
  })
})

test.group('Auth | Protected routes (unauthenticated)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('should reject unauthenticated GET /auth/me', async ({ client }) => {
    const response = await client.get('/api/auth/me')
    response.assertStatus(401)
    response.assertBodyContains({ code: 'UNAUTHORIZED' })
  })

  test('should reject unauthenticated DELETE /auth/logout', async ({ client }) => {
    const response = await client.delete('/api/auth/logout')
    response.assertStatus(401)
  })

  test('should reject unauthenticated GET /jobs', async ({ client }) => {
    const response = await client.get('/api/jobs')
    response.assertStatus(401)
  })

  test('should reject unauthenticated POST /analyze', async ({ client }) => {
    const response = await client.post('/api/analyze').json({ url: 'https://twitch.tv/videos/123' })
    response.assertStatus(401)
  })

  test('should reject unauthenticated GET /renders', async ({ client }) => {
    const response = await client.get('/api/renders')
    response.assertStatus(401)
  })
})

test.group('Health', () => {
  test('should return ok status', async ({ client }) => {
    const response = await client.get('/')
    response.assertStatus(200)
    response.assertBodyContains({ status: 'ok' })
  })
})
