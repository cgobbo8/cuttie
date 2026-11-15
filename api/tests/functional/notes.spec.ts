import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import { MAX_NOTE, MAX_NOTES, notesDir, parseNoteFile, slugOf } from '#services/notes'

async function makeUser() {
  return User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
}

test.group('Notes for the AI', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => rmSync(notesDir(), { recursive: true, force: true }))
  group.each.teardown(() => rmSync(notesDir(), { recursive: true, force: true }))

  test('requires authentication', async ({ client }) => {
    ;(await client.get('/api/notes')).assertStatus(401)
    ;(await client.post('/api/notes').json({ title: 'x', body: 'y' })).assertStatus(401)
  })

  test('keeps each note as a Markdown file the worker reads, named after its title', async ({ client, assert }) => {
    const user = await makeUser()
    assert.deepEqual((await client.get('/api/notes').loginAs(user)).body(), { notes: [], max: MAX_NOTES, max_chars: MAX_NOTE })

    const created = await client
      .post('/api/notes')
      .loginAs(user)
      .json({ title: '  GTA V RP\nsur FlashFA ', games: ['Grand Theft Auto V', ' GTA, RP ', '', 'Grand Theft Auto V', 7], body: '\r\n## Qui est qui\r\n- Maurice : soignant au SAMC.\n\n', colour: 'red' })
    created.assertStatus(201)
    const note = (created.body() as any).note
    // One line of title, games once each and without a comma (it would cut a name in two), the body as written
    assert.deepInclude(note, { id: 'gta-v-rp-sur-flashfa', title: 'GTA V RP sur FlashFA', games: ['Grand Theft Auto V', 'GTA RP'], body: '## Qui est qui\n- Maurice : soignant au SAMC.' })
    assert.match(note.updated_at, /^\d{4}-\d\d-\d\dT/)
    // The file is what the worker reads: a heading of `key: value` lines, then the note
    assert.equal(
      readFileSync(path.join(notesDir(), 'gta-v-rp-sur-flashfa.md'), 'utf-8'),
      '---\ntitle: GTA V RP sur FlashFA\ngames: Grand Theft Auto V, GTA RP\n---\n## Qui est qui\n- Maurice : soignant au SAMC.\n'
    )

    // A note for every live has no games line; the same title again gets a file of its own
    const always = ((await client.post('/api/notes').loginAs(user).json({ title: 'GTA V RP sur FlashFA', body: 'Autre chose.' })).body() as any).note
    assert.deepInclude(always, { id: 'gta-v-rp-sur-flashfa-2', games: [] })
    assert.equal(readFileSync(path.join(notesDir(), 'gta-v-rp-sur-flashfa-2.md'), 'utf-8'), '---\ntitle: GTA V RP sur FlashFA\n---\nAutre chose.\n')
    assert.deepEqual(((await client.get('/api/notes').loginAs(user)).body() as any).notes.map((n: any) => n.id), ['gta-v-rp-sur-flashfa', 'gta-v-rp-sur-flashfa-2'])

    // Changed: its file keeps its name, whatever its title becomes
    const changed = await client.put('/api/notes/gta-v-rp-sur-flashfa').loginAs(user).json({ title: 'Le RP de Maurice', games: [], body: 'x'.repeat(MAX_NOTE + 500) })
    changed.assertStatus(200)
    assert.deepInclude((changed.body() as any).note, { id: 'gta-v-rp-sur-flashfa', title: 'Le RP de Maurice', games: [] })
    assert.lengthOf((changed.body() as any).note.body, MAX_NOTE)

    // A note needs a title and something to say
    for (const bad of [{ title: '', body: 'x' }, { title: 'x', body: '   ' }, { body: 'x' }, {}]) {
      ;(await client.post('/api/notes').loginAs(user).json(bad)).assertStatus(400)
      ;(await client.put('/api/notes/gta-v-rp-sur-flashfa').loginAs(user).json(bad)).assertStatus(400)
    }
    // A note that isn't there, or a name that is no note's (never a path)
    ;(await client.put('/api/notes/nope').loginAs(user).json({ title: 'x', body: 'y' })).assertStatus(404)
    ;(await client.delete('/api/notes/nope').loginAs(user)).assertStatus(404)
    ;(await client.delete('/api/notes/..%2Fsettings').loginAs(user)).assertStatus(404)

    ;(await client.delete('/api/notes/gta-v-rp-sur-flashfa').loginAs(user)).assertStatus(200)
    assert.isFalse(existsSync(path.join(notesDir(), 'gta-v-rp-sur-flashfa.md')))
    assert.lengthOf(((await client.get('/api/notes').loginAs(user)).body() as any).notes, 1)
  })

  test('reads a note written by hand in the folder, and stops at a dozen', async ({ client, assert }) => {
    const user = await makeUser()
    mkdirSync(notesDir(), { recursive: true })
    // Dropped there by someone: quotes around the title, Windows line ends, a line it does not know
    writeFileSync(path.join(notesDir(), 'qui-est-falkarst.md'), '---\r\ntitle: "Qui est Falkarst"\r\ncolour: red\r\n---\r\nStreamer français.\r\n')
    writeFileSync(path.join(notesDir(), 'sans-entete.md'), 'Juste du texte.')
    writeFileSync(path.join(notesDir(), 'Pas Une Note.md'), 'Un nom que l’app n’écrit pas.')
    writeFileSync(path.join(notesDir(), 'brouillon.txt'), 'pas une note')
    const notes = ((await client.get('/api/notes').loginAs(user)).body() as any).notes
    assert.deepEqual(
      notes.map((n: any) => [n.id, n.title, n.games, n.body]),
      [
        ['qui-est-falkarst', 'Qui est Falkarst', [], 'Streamer français.'],
        ['sans-entete', 'sans-entete', [], 'Juste du texte.'],
      ]
    )

    for (let n = notes.length; n < MAX_NOTES; n++) (await client.post('/api/notes').loginAs(user).json({ title: `Note ${n}`, body: 'x' })).assertStatus(201)
    const tooMany = await client.post('/api/notes').loginAs(user).json({ title: 'Une de trop', body: 'x' })
    tooMany.assertStatus(400)
    assert.deepEqual(tooMany.body(), { error: 'too many notes' })
  })

  test('names a file after any title', ({ assert }) => {
    assert.equal(slugOf('GTA V RP sur FlashFA'), 'gta-v-rp-sur-flashfa')
    assert.equal(slugOf('  Les noms que l’IA écrit mal !  '), 'les-noms-que-l-ia-ecrit-mal')
    assert.equal(slugOf('日本語'), 'note')
    assert.isAtMost(slugOf('a'.repeat(200)).length, 48)
    // A heading that never closes is part of the note
    assert.deepEqual(parseNoteFile('---\ntitle: X\nle reste', 'nom'), { title: 'nom', games: [], body: '---\ntitle: X\nle reste' })
  })
})
