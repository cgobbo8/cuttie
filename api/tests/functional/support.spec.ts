import { test } from '@japa/runner'
import { ApiRequest } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { LOGS_DIR } from '#services/app_logs'
import { SETTINGS_PATH } from '#services/data_paths'
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
