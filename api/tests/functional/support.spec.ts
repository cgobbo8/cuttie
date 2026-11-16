import { test } from '@japa/runner'
import { ApiRequest } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { LOGS_DIR } from '#services/app_logs'
import { SETTINGS_PATH, TRANSCRIPTS_DIR } from '#services/data_paths'
import { unzip } from '../helpers/unzip.js'

// The .zip as bytes, not parsed
ApiRequest.addParser('application/zip', (res: any, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(chunk))
  res.on('end', () => done(null, Buffer.concat(chunks)))
})

test.group('Help from afar | journal', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  let settingsBefore: string | null = null
  group.setup(() => {
    settingsBefore = existsSync(SETTINGS_PATH) ? readFileSync(SETTINGS_PATH, 'utf-8') : null
  })
  group.teardown(() => {
    rmSync(LOGS_DIR, { recursive: true, force: true })
    if (settingsBefore === null) rmSync(SETTINGS_PATH, { force: true })
    else writeFileSync(SETTINGS_PATH, settingsBefore)
  })

  function writeJournal() {
    mkdirSync(LOGS_DIR, { recursive: true })
    const now = Date.now()
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString()
    writeFileSync(path.join(LOGS_DIR, 'cuttie.1.log'), `${at(50)} [worker] two days ago\n`)
    writeFileSync(
      path.join(LOGS_DIR, 'cuttie.log'),
      `${at(3)} [worker] three hours ago\n${at(0.2)} [worker] ERROR Job crashed with key gsk_ABCDEFGHIJKLMNOPQRSTUVWX0123\nTraceback (most recent call last):\n`
    )
  }

  test('says how much the journal weighs, and empties it', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    writeJournal()

    const size = await client.get('/api/logs').loginAs(user)
    size.assertStatus(200)
    assert.isAbove(size.body().bytes, 100)

    const emptied = await client.delete('/api/logs').loginAs(user)
    emptied.assertStatus(200)
    const body = emptied.body() as { freed: number; bytes: number }
    assert.equal(body.freed, size.body().bytes)
    assert.equal(body.bytes, 0)
    assert.isTrue(existsSync(path.join(LOGS_DIR, 'cuttie.log')))
  })

  test('exports a period as a .zip: its lines, the computer and the analyses, keys out', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/1', status: 'ERROR', error: 'Analyse interrompue', userId: user.id, vodTitle: 'Maurice' })
    writeFileSync(SETTINGS_PATH, JSON.stringify({ openrouter_api_key: 'sk-or-v1-0123456789abcdef0123456789', transcription: 'local', brand_kit: { channel: 'falkarst' } }))
    writeJournal()

    const response = await client.get('/api/logs/export?hours=24').loginAs(user)
    response.assertStatus(200)
    assert.equal(response.header('content-type'), 'application/zip')
    assert.match(response.header('content-disposition') ?? '', /attachment; filename="cuttie-journal-.+\.zip"/)

    const files = unzip(response.body() as Buffer)
    assert.sameMembers(Object.keys(files), ['journal.log', 'diagnostic.json', 'analyses.json'])
    assert.include(files['journal.log'], 'three hours ago')
    assert.include(files['journal.log'], 'Traceback (most recent call last):')
    assert.notInclude(files['journal.log'], 'two days ago')
    assert.notInclude(files['journal.log'], 'ABCDEFGHIJKLMNOP')

    const diagnostic = JSON.parse(files['diagnostic.json'])
    assert.equal(diagnostic.period_hours, 24)
    assert.equal(diagnostic.settings.openrouter_api_key, 'configured')
    assert.equal(diagnostic.settings.transcription, 'local')
    assert.deepEqual(diagnostic.settings.brand_kit, { channel: 'falkarst' })
    assert.isNull(diagnostic.worker)
    assert.isString(diagnostic.worker_error) // no worker in tests
    assert.notInclude(files['diagnostic.json'], '0123456789abcdef')

    const analyses = JSON.parse(files['analyses.json'])
    assert.equal(analyses.jobs.length, 1)
    assert.include(analyses.jobs[0], { status: 'ERROR', error: 'Analyse interrompue', title: 'Maurice' })
    // Never transcribed, no compilation
    assert.isNull(analyses.jobs[0].transcript)
    assert.deepEqual(analyses.jobs[0].compilations, [])
  })

  test('the export says how a live is cut into lines and what its compilations hold', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const halfMinute = Array(70).fill('alors').join(' ')
    const item = (id: string, start: number, end: number, more: object = {}) => ({ id, start, end, text: 'c’est calme', why: '', sources: ['ai'], ...more })
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/1',
      status: 'DONE',
      userId: user.id,
      vodTitle: 'Maurice',
      compilations: [
        {
          id: 'abcdefghij',
          name: 'Trop calme',
          template: null,
          titles: true,
          hook: '',
          target: 90,
          brief: `Une vidéo sur le calme ${'x'.repeat(400)}`,
          asks: [{ ask: 'Ça ne correspond pas, utilise un maximum de passages', note: 'Voilà.', added: 11 }],
          sections: [
            { id: 's1', title: 'Calme', query: '', items: [item('p1', 100, 143.2), item('p2', 500, 538, { fit: [500, 538] })] },
            { id: 's2', title: 'Plus calme', query: '', items: [] },
          ],
          created_at: '2026-11-16T15:27:00.000Z',
          updated_at: '2026-11-16T15:57:00.000Z',
        },
      ] as any,
    })
    // As an NVIDIA card wrote it up to 0.2.5: one line per half minute of speech, no dated word
    const folder = path.join(TRANSCRIPTS_DIR, job.id)
    mkdirSync(folder, { recursive: true })
    try {
      writeFileSync(path.join(folder, 'chunk_000.json'), JSON.stringify({ start: 0, segments: [[0, 27, halfMinute], [30, 58.5, halfMinute], [60, 62, 'bonsoir Ralen']], words: [] }))
      writeFileSync(path.join(folder, 'chunk_001.json'), '{ not json')
      writeJournal()
      const files = unzip((await client.get('/api/logs/export?hours=24').loginAs(user)).body() as Buffer)
      const [told] = JSON.parse(files['analyses.json']).jobs
      assert.deepEqual(told.transcript, { chunks: 1, lines: 3, dated_words: 0, median_seconds: 27, longest_seconds: 28.5, long_share: 0.986, relistened: false })
      assert.equal(told.compilations.length, 1)
      assert.include(told.compilations[0], { id: 'abcdefghij', name: 'Trop calme', target_seconds: 90, parts: 2, passages: 2, seconds: 81, rough_cuts: 1, other_lives: 0, proposed_by_ai: false })
      // Two passages of about 40 seconds: what a live in half-minute lines gives
      assert.deepEqual(told.compilations[0].passage_seconds, [43.2, 38])
      assert.lengthOf(told.compilations[0].brief, 300)
      assert.deepEqual(told.compilations[0].asks, [{ ask: 'Ça ne correspond pas, utilise un maximum de passages', added: 11, removed: 0, recut: 0 }])

      // Transcribed again since, in sentences
      writeFileSync(path.join(folder, 'chunk_000.json'), JSON.stringify({ start: 0, lines: 2, segments: [[0, 2, 'bon là c’est calme'], [2.5, 4, 'trop calme']], words: [{ word: 'bon', start: 0, end: 0.3 }] }))
      writeFileSync(path.join(folder, 'relistened.json'), '{}')
      const after = JSON.parse(unzip((await client.get('/api/logs/export?hours=24').loginAs(user)).body() as Buffer)['analyses.json']).jobs[0]
      assert.include(after.transcript, { lines: 2, dated_words: 1, median_seconds: 2, longest_seconds: 2, long_share: 0, relistened: true })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test('the whole journal, and an unknown period falls back to a day', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    writeJournal()
    const all = unzip((await client.get('/api/logs/export?hours=0').loginAs(user)).body() as Buffer)
    assert.include(all['journal.log'], 'two days ago')
    const odd = unzip((await client.get('/api/logs/export?hours=5').loginAs(user)).body() as Buffer)
    assert.equal(JSON.parse(odd['diagnostic.json']).period_hours, 24)
  })

  test('errors of the page go to the journal', async ({ client, assert }) => {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const response = await client
      .post('/api/client-log')
      .loginAs(user)
      .json({ kind: 'error', message: 'Cannot read properties of undefined', stack: 'TypeError\n    at MomentPlayer (MomentPlayer.tsx:12)', page: '/abc' })
    response.assertStatus(200)
    assert.deepEqual(response.body(), { logged: true })
  })

  test('only for the streamer', async ({ client }) => {
    ;(await client.get('/api/logs')).assertStatus(401)
    ;(await client.get('/api/logs/export')).assertStatus(401)
  })
})
