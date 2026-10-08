import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import User from '#models/user'
import { brandFacecamFor, DEFAULT_BRAND_KIT } from '#services/brand_kit'
import { readSettings, writeSettings } from '#services/user_settings'

async function makeUser() {
  return User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
}

test.group('Brand kit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    const settings = readSettings()
    delete settings.brand_kit
    writeSettings(settings)
  })

  test('requires authentication', async ({ client }) => {
    const response = await client.get('/api/brand-kit')
    response.assertStatus(401)
  })

  test('returns defaults without blue', async ({ client, assert }) => {
    const response = await client.get('/api/brand-kit').loginAs(await makeUser())
    response.assertStatus(200)
    assert.deepEqual(response.body().colors, DEFAULT_BRAND_KIT.colors)
    assert.deepEqual(response.body().widget, { enabled: true, timing: 'start' })
    assert.equal(response.body().subtitles.style, 'bold')
  })

  test('saves colors, widget and subtitle style', async ({ client, assert }) => {
    const user = await makeUser()
    const response = await client
      .put('/api/brand-kit')
      .loginAs(user)
      .json({ colors: { accent: '#42bf85', highlight: '#F7C502' }, widget: { timing: 'end' }, subtitles: { style: 'karaoke' } })
    response.assertStatus(200)

    const kit = (await client.get('/api/brand-kit').loginAs(user)).body()
    assert.equal(kit.colors.accent, '#42BF85')
    assert.equal(kit.colors.highlight, '#F7C502')
    assert.equal(kit.colors.dark, DEFAULT_BRAND_KIT.colors.dark)
    assert.deepEqual(kit.widget, { enabled: true, timing: 'end' })
    assert.equal(kit.subtitles.style, 'karaoke')
  })

  test('rejects invalid values', async ({ client }) => {
    const user = await makeUser()
    ;(await client.put('/api/brand-kit').loginAs(user).json({ colors: { accent: 'green' } })).assertStatus(400)
    ;(await client.put('/api/brand-kit').loginAs(user).json({ widget: { timing: 'sometimes' } })).assertStatus(400)
    ;(await client.put('/api/brand-kit').loginAs(user).json({ subtitles: { style: 'comic' } })).assertStatus(400)
    ;(await client.put('/api/brand-kit').loginAs(user).json({ facecam: { x: 1, y: 2, w: 0, h: 3 } })).assertStatus(400)
    ;(await client.put('/api/brand-kit').loginAs(user).json({ twitch_login: 'not a login!' })).assertStatus(400)
  })

  test('stores the webcam with the stream size it was measured on', async ({ client, assert }) => {
    const user = await makeUser()
    const response = await client
      .put('/api/brand-kit')
      .loginAs(user)
      .json({ facecam: { x: 1518.4, y: 0, w: 402, h: 446 } })
    response.assertStatus(200)
    assert.deepEqual(response.body().facecam, { x: 1518, y: 0, w: 402, h: 446, ref_w: 1920, ref_h: 1080 })
  })

  test('changing channel forgets the detected palette', async ({ client, assert }) => {
    const user = await makeUser()
    writeSettings({ ...readSettings(), brand_kit: { palette: ['#42BF85'], palette_source: 'https://x/logo.png' } })
    const response = await client.put('/api/brand-kit').loginAs(user).json({ twitch_login: '@Falkarst' })
    response.assertStatus(200)
    assert.equal(response.body().twitch_login, 'falkarst')
    assert.deepEqual(response.body().palette, [])
    assert.isNull(response.body().palette_source)
  })

  test('migrates the v1 primary color, but not the old violet default', async ({ client, assert }) => {
    const user = await makeUser()
    writeSettings({ ...readSettings(), brand_kit: { colors: { primary: '#8b7bff', secondary: '#4fbf73' } } })
    assert.equal((await client.get('/api/brand-kit').loginAs(user)).body().colors.accent, DEFAULT_BRAND_KIT.colors.accent)

    writeSettings({ ...readSettings(), brand_kit: { colors: { primary: '#ff6b3d' } } })
    assert.equal((await client.get('/api/brand-kit').loginAs(user)).body().colors.accent, '#ff6b3d')
  })
})

test.group('Brand kit | webcam scaling', () => {
  test('scales the confirmed webcam to the clip size', ({ assert }) => {
    const kit = { ...DEFAULT_BRAND_KIT, facecam: { x: 1518, y: 0, w: 402, h: 446, ref_w: 1920, ref_h: 1080 } }
    assert.deepEqual(brandFacecamFor(kit, 1280, 720), { x: 1012, y: 0, w: 268, h: 297 })
    assert.isFalse(brandFacecamFor({ ...DEFAULT_BRAND_KIT, facecam: false }, 1920, 1080))
    assert.isNull(brandFacecamFor(DEFAULT_BRAND_KIT, 1920, 1080))
  })
})

test.group('Twitch + clip media', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('rejects a malformed VOD id for storyboards', async ({ client }) => {
    const response = await client.get('/api/twitch/vods/abc/storyboard').loginAs(await makeUser())
    response.assertStatus(400)
  })

  test("doesn't serve thumbnails of someone else's clips", async ({ client }) => {
    const response = await client.get(`/api/clips/${randomUUID()}/clip.mp4/thumb`).loginAs(await makeUser())
    response.assertStatus(404)
  })
})
