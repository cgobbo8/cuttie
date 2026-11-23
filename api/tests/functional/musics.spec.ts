import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import { DATA_DIR } from '#services/data_paths'
import { readSettings, writeSettings } from '#services/user_settings'

const OWN = path.join(DATA_DIR, 'musics')
const track = (id: string, more: Record<string, unknown> = {}) => ({
  id, name: 'Ma boucle', author: '', source: 'added by the streamer', file: 'ma-boucle.wav', genre: 'trap', kinds: ['skill'],
  bpm: 140, seconds: 95, start: 4.2, lufs: -9.5, about: 'Hard trap. Suits action.', description: 'Trap nerveuse. Pour les kills.', ...more,
})

/** A real (and silent) WAV of a tenth of a second: what an upload is recognised as a sound by */
function wav(): Buffer {
  const samples = 800
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(8000, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(samples, 40)
  return Buffer.concat([header, Buffer.alloc(samples, 128)])
}

test.group('Musics of the streamer', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    rmSync(OWN, { recursive: true, force: true })
    const settings = readSettings()
    delete settings.brand_kit
    writeSettings(settings)
  })
  group.teardown(() => rmSync(OWN, { recursive: true, force: true }))

  const makeUser = () => User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })

  test('a track added needs the engine to be measured and heard; without it nothing is left behind', async ({ client, assert }) => {
    const user = await makeUser()
    mkdirSync(OWN, { recursive: true })
    const file = path.join(OWN, 'to-add.wav')
    writeFileSync(file, wav())
    const added = await client.post('/api/musics').loginAs(user).file('file', file).field('language', 'fr')
    added.assertStatus(503)
    // Neither the file as it was sent nor a track that can't be played
    assert.deepEqual(readdirSync(OWN), ['to-add.wav'])
    const listed = (await client.get('/api/musics').loginAs(user)).body() as any
    assert.isFalse(listed.musics.some((m: any) => m.own))

    // Not a sound, or nothing at all: refused before anything is written
    writeFileSync(path.join(OWN, 'notes.pdf'), '%PDF')
    ;(await client.post('/api/musics').loginAs(user).file('file', path.join(OWN, 'notes.pdf'))).assertStatus(400)
    ;(await client.post('/api/musics').loginAs(user)).assertStatus(400)
    ;(await client.post('/api/musics')).assertStatus(401)
  })

  test("the streamer's own tracks are listed after those that ship, can be corrected, and removed", async ({ client, assert }) => {
    const user = await makeUser()
    mkdirSync(OWN, { recursive: true })
    writeFileSync(path.join(OWN, 'catalogue.json'), JSON.stringify({ tracks: [track('u1234abcd'), track('broken', { lufs: 'loud' })] }))
    writeFileSync(path.join(OWN, 'u1234abcd.mp3'), 'ID3 a song of mine')

    const listed = ((await client.get('/api/musics').loginAs(user)).body() as any).musics
    const mine = listed.at(-1)
    // What it is, as they described it; never where its file is. A track whose measures are missing is not one
    assert.deepInclude(mine, { id: 'u1234abcd', name: 'Ma boucle', own: true, available: true, description: 'Trap nerveuse. Pour les kills.', start: 4.2, lufs: -9.5 })
    assert.notProperty(mine, 'file')
    assert.isFalse(listed.some((m: any) => m.id === 'broken'))
    assert.isFalse(listed[0].own)
    ;(await client.get('/api/musics/u1234abcd').loginAs(user)).assertStatus(200)

    // Corrected: its name, the kinds of video it suits (known ones, three at most), what is said of it, which the AI then reads
    const fixed = (await client.put('/api/musics/u1234abcd').loginAs(user).json({ name: '  Ma trap  ', kinds: ['funny', 'epic', 'skill', 'chill', 'hype'], description: ' Pour les fails, en fait. ' })).body() as any
    assert.deepInclude(fixed.music, { name: 'Ma trap', kinds: ['funny', 'skill', 'chill'], description: 'Pour les fails, en fait.', about: 'Pour les fails, en fait.' })
    assert.equal(JSON.parse(readFileSync(path.join(OWN, 'catalogue.json'), 'utf-8')).tracks[0].name, 'Ma trap')
    // It builds up to its strong moment (a video with an intro then starts it earlier), or no longer does
    const builds = (await client.put('/api/musics/u1234abcd').loginAs(user).json({ build: true })).body() as any
    assert.isTrue(builds.music.build)
    assert.isTrue(JSON.parse(readFileSync(path.join(OWN, 'catalogue.json'), 'utf-8')).tracks[0].build)
    assert.isTrue(((await client.get('/api/musics').loginAs(user)).body() as any).musics.at(-1).build)
    assert.notProperty(((await client.put('/api/musics/u1234abcd').loginAs(user).json({ build: false })).body() as any).music, 'build')
    // Where that moment is: a time in the track, or nothing is changed
    for (const start of [-1, 95, '35', null]) {
      ;(await client.put('/api/musics/u1234abcd').loginAs(user).json({ start })).assertStatus(400)
    }
    // ...which the engine brings to the nearest attack: without it, the moment stays where it was
    ;(await client.put('/api/musics/u1234abcd').loginAs(user).json({ start: 35 })).assertStatus(503)
    assert.equal(JSON.parse(readFileSync(path.join(OWN, 'catalogue.json'), 'utf-8')).tracks[0].start, 4.2)
    // A track that ships is not theirs to change or remove
    ;(await client.put('/api/musics/phonk').loginAs(user).json({ name: 'Mine' })).assertStatus(404)
    ;(await client.delete('/api/musics/phonk').loginAs(user)).assertStatus(404)

    // A favourite of theirs, then removed: gone from the list, from the disk and from their favourites
    const kit = (await client.put('/api/brand-kit').loginAs(user).json({ musics: { skill: 'u1234abcd', chill: 'lofi' } })).body() as any
    assert.deepEqual(kit.musics, { skill: 'u1234abcd', chill: 'lofi' })
    ;(await client.delete('/api/musics/u1234abcd').loginAs(user)).assertStatus(200)
    assert.isFalse(existsSync(path.join(OWN, 'u1234abcd.mp3')))
    assert.isFalse(((await client.get('/api/musics').loginAs(user)).body() as any).musics.some((m: any) => m.own))
    assert.deepEqual(((await client.get('/api/brand-kit').loginAs(user)).body() as any).musics, { chill: 'lofi' })
    ;(await client.delete('/api/musics/u1234abcd').loginAs(user)).assertStatus(404)
  })
})
