import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import User from '#models/user'
import Job from '#models/job'
import { readSettings, writeSettings } from '#services/user_settings'

async function makeUser() {
  return User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
}

test.group('First launch', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  let saved: Record<string, unknown>
  group.each.setup(() => {
    saved = readSettings()
    const settings = { ...saved }
    delete settings.onboarded
    delete settings.groq_api_key
    delete settings.openrouter_api_key
    delete settings.transcription
    writeSettings(settings)
  })
  group.each.teardown(() => writeSettings(saved))

  test('a fresh install is not set up, an install with analyses is', async ({ client, assert }) => {
    const user = await makeUser()
    assert.isFalse((await client.get('/api/settings').loginAs(user)).body().onboarded)

    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/1', status: 'DONE', userId: user.id })
    assert.isTrue((await client.get('/api/settings').loginAs(user)).body().onboarded)
  })

  test('remembers the end of the first launch', async ({ client, assert }) => {
    const user = await makeUser()
    const response = await client.put('/api/settings').loginAs(user).json({ onboarded: true })
    response.assertStatus(200)
    assert.isTrue(response.body().onboarded)
    assert.isTrue(readSettings().onboarded as boolean)
    ;(await client.put('/api/settings').loginAs(user).json({ onboarded: 'yes' })).assertStatus(400)
  })

  test('picks the transcription engine (Groq when its key is set, else OpenRouter or this PC)', async ({ client, assert }) => {
    const user = await makeUser()
    assert.equal((await client.get('/api/settings').loginAs(user)).body().transcription, 'auto')
    const response = await client.put('/api/settings').loginAs(user).json({ transcription: 'local' })
    response.assertStatus(200)
    assert.equal(response.body().transcription, 'local')
    assert.equal(readSettings().transcription, 'local')
    ;(await client.put('/api/settings').loginAs(user).json({ transcription: 'whisper.cpp' })).assertStatus(400)
  })

  test('checking a key that is not saved', async ({ client, assert }) => {
    const user = await makeUser()
    const response = await client.post('/api/settings/verify').loginAs(user).json({ name: 'groq_api_key' })
    response.assertStatus(200)
    assert.deepEqual(response.body(), { ok: false, reason: 'missing' })
    ;(await client.post('/api/settings/verify').loginAs(user).json({ name: 'openai_api_key' })).assertStatus(400)
  })

  test('looking up a channel validates the login', async ({ client }) => {
    const user = await makeUser()
    ;(await client.get('/api/twitch/lookup').qs({ login: 'not a login!' }).loginAs(user)).assertStatus(400)
    ;(await client.get('/api/twitch/lookup/colors').qs({ login: '' }).loginAs(user)).assertStatus(400)
  })
})
