import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import User from '#models/user'

test.group('This computer', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('says so when the worker cannot measure it', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    // No worker in tests: the onboarding hides the card
    const response = await client.get('/api/machine').loginAs(user)
    response.assertStatus(502)
    assert.properties(response.body(), ['error'])
    ;(await client.get('/api/machine')).assertStatus(401)
  })
})
