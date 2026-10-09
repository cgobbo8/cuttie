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

test.group('Brand kit | custom templates', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    const settings = readSettings()
    delete settings.brand_kit
    writeSettings(settings)
  })

  const look = {
    camSize: 'l',
    camShape: 'circle',
    camBorder: 'accent',
    background: 'brand',
    subtitlePosition: 'top',
    subtitleSize: 'm',
    widgetPosition: 'none',
    hook: 'on',
  }

  test('saves the templates made in the simple editor', async ({ client, assert }) => {
    const user = await makeUser()
    const template = { id: 'custom-3f2a9c1e', name: '  Mon modèle  ', base: 'signature', look, extra: 'dropped' }
    const response = await client.put('/api/brand-kit').loginAs(user).json({ templates: [template] })
    response.assertStatus(200)
    assert.deepEqual(response.body().templates, [{ id: 'custom-3f2a9c1e', name: 'Mon modèle', base: 'signature', look }])
    assert.deepEqual((await client.get('/api/brand-kit').loginAs(user)).body().templates[0].look, look)
  })

  test('rejects unknown bases and values', async ({ client }) => {
    const user = await makeUser()
    const bad = [
      [{ id: 'custom-3f2a9c1e', name: 'A', base: 'tiktok', look }],
      [{ id: 'custom-3f2a9c1e', name: 'A', base: 'signature', look: { ...look, camSize: 'xl' } }],
      [{ id: '../x', name: 'A', base: 'signature', look }],
      [{ id: 'custom-3f2a9c1e', name: '', base: 'signature', look }],
    ]
    for (const templates of bad) {
      ;(await client.put('/api/brand-kit').loginAs(user).json({ templates })).assertStatus(400)
    }
  })
})

test.group('Brand kit | element templates', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    const settings = readSettings()
    delete settings.brand_kit
    writeSettings(settings)
  })

  const frame = { radius: 44, border: 6, borderColor: 'white', shadow: false }
  const spec = {
    version: 2,
    id: 'custom-9a8b7c6d',
    name: 'Cam ronde',
    base: 'signature',
    background: { kind: 'blur', color: 'dark', dim: 0.42 },
    game: { box: { x: 40, y: 868, w: 1000, h: 600 }, frame: { ...frame, border: 0 } },
    cam: { visible: true, box: { x: 240, y: 180, w: 600, h: 600 }, frame: { ...frame, radius: 300, borderColor: 'accent' } },
    subtitles: { box: { x: 60, y: 1250, w: 860, h: 190 }, font: 'bangers', size: 104, color: 'white', highlight: 'highlight', uppercase: true, stroke: true, boxed: false, speakers: false },
    hook: { visible: false, box: { x: 40, y: 160, w: 1000, h: 230 }, style: 'outline', font: 'luckiest', size: 86 },
    widgets: [
      { id: 'w-1a2b', kind: 'logo', box: { x: 60, y: 170, w: 190, h: 190 }, timing: 'start', fields: { shape: 'round' } },
      { id: 'w-3c4d', kind: 'socials', box: { x: 250, y: 1140, w: 500, h: 320 }, timing: 'end', fields: { tiktok: 'falkarst' } },
    ],
  }

  test('saves an element template and makes it the default', async ({ client, assert }) => {
    const user = await makeUser()
    const saved = await client.put('/api/brand-kit').loginAs(user).json({ templates: [spec], default_template: spec.id })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().templates[0], spec)
    assert.equal(saved.body().default_template, spec.id)
    ;(await client.put('/api/brand-kit').loginAs(user).json({ default_template: 'reaction' })).assertStatus(200)
    ;(await client.put('/api/brand-kit').loginAs(user).json({ default_template: 'custom-nope0000' })).assertStatus(400)
  })

  test('keeps precise widget timing, animations, stacking and elements past the edges', async ({ client, assert }) => {
    const user = await makeUser()
    const rich = {
      ...spec,
      id: 'custom-1f2e3d4c',
      game: { ...spec.game, box: { x: -200, y: 700, w: 1480, h: 832 } },
      widgets: [
        { ...spec.widgets[0], timing: 'always', show: { in: 1, inFrom: 'start', out: 1, outFrom: 'end' }, enter: 'elastic', exit: 'shrink' },
        { ...spec.widgets[1], show: { in: 4.5, inFrom: 'end', out: null, outFrom: 'end' }, enter: 'drop' },
      ],
      order: ['cam', 'game', 'subtitles', 'hook', 'widget:w-3c4d', 'widget:w-1a2b'],
    }
    const saved = await client.put('/api/brand-kit').loginAs(user).json({ templates: [rich] })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().templates[0], rich)
  })

  test('keeps the timed hook line, the popping word and the words per line (Empilé)', async ({ client, assert }) => {
    const user = await makeUser()
    const stacked = {
      ...spec,
      id: 'custom-5e6f7a8b',
      base: 'empile',
      subtitles: { ...spec.subtitles, font: 'anton', pop: true, words: 3 },
      hook: { ...spec.hook, visible: true, style: 'brand', until: 3.5 },
    }
    const half = { ...stacked, id: 'custom-6f7a8b9c', hook: { ...stacked.hook, style: 'box', until: 'half' } }
    const always = { ...stacked, id: 'custom-7a8b9c0d', hook: { ...stacked.hook, until: null } }
    const saved = await client.put('/api/brand-kit').loginAs(user).json({ templates: [stacked, half, always], default_template: 'empile' })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().templates, [stacked, half, always])
    assert.equal(saved.body().default_template, 'empile')
  })

  test('keeps the chat element and the whole stream picture (Discussion RP, Cinéma)', async ({ client, assert }) => {
    const user = await makeUser()
    const talk = {
      ...spec,
      id: 'custom-8b9c0d1e',
      base: 'discussion',
      game: { ...spec.game, whole: true },
      chat: { visible: true, box: { x: 60, y: 1170, w: 760, h: 260 }, size: 38, max: 3 },
      order: ['cam', 'game', 'chat', 'subtitles', 'hook'],
    }
    const saved = await client.put('/api/brand-kit').loginAs(user).json({ templates: [talk] })
    saved.assertStatus(200)
    assert.deepEqual(saved.body().templates[0], talk)
    for (const chat of [{ ...talk.chat, max: 40 }, { ...talk.chat, visible: 'yes' }, { ...talk.chat, box: { x: 5000, y: 0, w: 10, h: 10 } }]) {
      ;(await client.put('/api/brand-kit').loginAs(user).json({ templates: [{ ...talk, chat }] })).assertStatus(400)
    }
  })

  test('rejects broken element templates', async ({ client }) => {
    const user = await makeUser()
    const broken = [
      { ...spec, subtitles: { ...spec.subtitles, font: 'comic-sans' } },
      { ...spec, widgets: [{ ...spec.widgets[0], kind: 'confetti' }] },
      { ...spec, cam: { ...spec.cam, box: { x: 1200, y: 0, w: 600, h: 600 } } },
      { ...spec, game: { ...spec.game, box: { x: 0, y: 0, w: 50000, h: 600 } } },
      { ...spec, widgets: [{ ...spec.widgets[0], show: { in: -1, inFrom: 'start', out: null, outFrom: 'end' } }] },
      { ...spec, widgets: [{ ...spec.widgets[0], enter: 'teleport' }] },
      { ...spec, order: ['game', 'game'] },
      { ...spec, order: ['game', 'widget:w-nope'] },
      { ...spec, game: { ...spec.game, frame: { ...frame, borderColor: 'javascript:alert(1)' } } },
      { ...spec, widgets: [{ ...spec.widgets[0], fields: { text: 'x'.repeat(200) } }] },
      { ...spec, hook: { ...spec.hook, style: 'neon' } },
      { ...spec, hook: { ...spec.hook, until: 'forever' } },
      { ...spec, hook: { ...spec.hook, until: -2 } },
      { ...spec, subtitles: { ...spec.subtitles, words: 40 } },
      { ...spec, subtitles: { ...spec.subtitles, pop: 'yes' } },
    ]
    for (const template of broken) {
      ;(await client.put('/api/brand-kit').loginAs(user).json({ templates: [template] })).assertStatus(400)
    }
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
