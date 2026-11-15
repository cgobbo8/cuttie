import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import env from '#start/env'
import User from '#models/user'
import Job from '#models/job'
import jobStatusBus from '#services/job_status_bus'
import { addProposals, memoryDir, readLive, readingCost, readingNow, resetReading } from '#services/memory'
import { notesDir } from '#services/notes'

const NOTE = '---\ntitle: Qui est Falkarst\n---\nSon jeu préféré est GTA, il y joue tous les soirs.\nIl streame du mardi au samedi.\n'
const stale = { id: 'aaaaaaaaaaaa', note: 'qui', before: 'Son jeu préféré est GTA, il y joue tous les soirs.', after: 'Il jouait surtout à GTA ; depuis novembre il est passé à Crimson Desert.', why: 'Tes cinq derniers lives sont sur Crimson Desert.' }

test.group('The memory of the AI', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const clean = () => {
    rmSync(memoryDir(), { recursive: true, force: true })
    rmSync(notesDir(), { recursive: true, force: true })
    resetReading()
  }
  group.each.setup(clean)
  group.each.teardown(clean)

  // Stands for the worker: reads a live as the real one would (writes what it noted where the app reads it), and keeps what it was asked
  let server: Server
  let proposals: unknown[] = []
  let refuses = 0
  // How long it takes to read a live, ms
  let slow = 0
  const asked: { url: string; body: any }[] = []
  group.setup(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', async () => {
        const body = raw ? JSON.parse(raw) : null
        asked.push({ url: req.url ?? '', body })
        if (slow) await new Promise((resolve) => setTimeout(resolve, slow))
        res.setHeader('Content-Type', 'application/json')
        const read = /^\/jobs\/([^/]+)\/memory$/.exec(req.url ?? '')
        if (!read) return res.writeHead(404).end('{}')
        if (refuses) return res.writeHead(refuses).end('{}')
        if (body.meta.title === 'Rien à lire') return res.writeHead(409).end('{}')
        const file = path.join(memoryDir(), 'lives', `${read[1]}.json`)
        const cached = existsSync(file)
        const entry = { job: read[1], title: body.meta.title, game: body.meta.game ?? '', date: body.meta.date ?? '', duration: body.duration, summary: `Résumé de « ${body.meta.title} ».`, events: ['[1:12:40] Dispute avec Cody'], people: [{ name: 'Cody', who: 'collègue de Maurice' }], said: ['Marre des gardes de nuit'], games: ['Grand Theft Auto V'], source: 'transcript', read_at: new Date().toISOString(), cost: 0.008 }
        const sections = { who: '- Streamer français', games: '- GTA V RP sur FlashFA', people: '- Cody : collègue de Maurice', stories: `- Dernier live lu : ${body.meta.title}`, tastes: '' }
        if (!cached) {
          mkdirSync(path.dirname(file), { recursive: true })
          writeFileSync(file, JSON.stringify(entry))
          const kept = existsSync(path.join(memoryDir(), 'memory.json')) ? JSON.parse(readFileSync(path.join(memoryDir(), 'memory.json'), 'utf-8')) : {}
          writeFileSync(path.join(memoryDir(), 'memory.json'), JSON.stringify({ ...kept, sections, updated_at: '2026-11-15T10:00:00Z' }))
        }
        res.end(JSON.stringify({ entry, sections, proposals: cached ? [] : proposals, cost: cached ? 0 : 0.009, cached }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
  group.teardown(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const engine = (on: boolean) => env.set('WORKER_URL', on ? `http://127.0.0.1:${(server.address() as AddressInfo).port}` : 'http://127.0.0.1:9')
  group.each.setup(() => {
    asked.length = 0
    proposals = []
    refuses = 0
    slow = 0
    engine(true)
    return () => engine(false)
  })

  const makeUser = () => User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
  const live = (user: User, title: string, date: string, more: Partial<Job> = {}) =>
    Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/123', status: 'DONE', userId: user.id, vodDurationSeconds: 21600, vodTitle: title, vodGame: 'Grand Theft Auto V', streamer: 'Falkarst', streamDate: date, ...more } as any)
  const writeNote = () => {
    mkdirSync(notesDir(), { recursive: true })
    writeFileSync(path.join(notesDir(), 'qui.md'), NOTE)
  }
  /** Waits for the rebuild started by POST /api/memory/read to end */
  const rebuilt = async () => {
    for (let n = 0; n < 200 && readingNow(); n++) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  test('requires authentication', async ({ client }) => {
    ;(await client.get('/api/memory')).assertStatus(401)
    ;(await client.put('/api/memory').json({ paused: true })).assertStatus(401)
    ;(await client.post('/api/memory/read')).assertStatus(401)
    ;(await client.get('/api/memory/proposals')).assertStatus(401)
  })

  test('starts empty, says which lives wait to be read and about what reading them costs', async ({ client, assert }) => {
    const user = await makeUser()
    const other = await makeUser()
    const second = await live(user, 'Le lendemain', '2026-11-10')
    const first = await live(user, 'Maurice fait passer son examen', '2026-11-09', { customTitle: 'L’examen de Blue' } as any)
    await live(user, 'Pas fini', '2026-11-11', { status: 'ANALYZING_CLIPS' } as any)
    await live(other, 'Le live d’un autre', '2026-11-08')

    const body = (await client.get('/api/memory').loginAs(user)).body() as any
    assert.deepEqual(body.sections, { who: '', games: '', people: '', stories: '', tastes: '' })
    assert.deepInclude(body, { updated_at: null, paused: false, lives: [], reading: null, last: null, proposals: [] })
    // The user's analysed lives, the oldest first: the memory is built in the order things happened
    assert.deepEqual(body.unread, [
      { id: first.id, title: 'L’examen de Blue', date: '2026-11-09', game: 'Grand Theft Auto V', duration: 21600 },
      { id: second.id, title: 'Le lendemain', date: '2026-11-10', game: 'Grand Theft Auto V', duration: 21600 },
    ])
    // Two lives of 6 h: under two cents
    assert.equal(body.cost, 0.02)
    assert.equal(readingCost([]), 0)
    assert.equal(readingCost([first]), 0.01)
  })

  test('the end of an analysis has the AI read the live into its memory, unless the streamer paused it', async ({ client, assert }) => {
    const user = await makeUser()
    writeNote()
    proposals = [stale]
    const job = await live(user, 'Maurice fait passer son examen', '2026-11-09', {
      status: 'CLIPPING',
      timeline: { candidates: [{ t: 4360, state: 'kept', score: 0.9, name: 'La dispute', what: 'Maurice et Cody se crient dessus' }] },
      vodContext: { narrative: 'Une garde agitée au SAMC.' },
    } as any)
    await jobStatusBus.handle({ job_id: job.id, status: 'DONE', progress: 'Analysis complete!' })
    // In the background: joined here to see what it did
    const done = await readLive(job.id)
    const reads = () => asked.filter((call) => call.url.endsWith('/memory'))
    assert.lengthOf(reads(), 1)
    // The worker is given who and what, the moments the analysis rated and what it understood of the live
    assert.deepEqual(reads()[0].body, {
      duration: 21600,
      meta: { streamer: 'Falkarst', game: 'Grand Theft Auto V', title: 'Maurice fait passer son examen', date: '2026-11-09' },
      moments: [{ t: 4360, state: 'kept', score: 0.9, name: 'La dispute', what: 'Maurice et Cody se crient dessus' }],
      context: { narrative: 'Une garde agitée au SAMC.' },
    })
    assert.equal(done.entry.summary, 'Résumé de « Maurice fait passer son examen ».')

    const body = (await client.get('/api/memory').loginAs(user)).body() as any
    assert.deepEqual(body.unread, [])
    assert.equal(body.cost, 0)
    assert.equal(body.sections.people, '- Cody : collègue de Maurice')
    assert.equal(body.updated_at, '2026-11-15T10:00:00Z')
    assert.deepInclude(body.lives[0], { job: job.id, title: 'Maurice fait passer son examen', date: '2026-11-09', source: 'transcript', events: ['[1:12:40] Dispute avec Cody'], people: [{ name: 'Cody', who: 'collègue de Maurice' }] })
    // The correction it proposed for the note waits for the streamer
    assert.lengthOf(body.proposals, 1)
    assert.deepInclude(body.proposals[0], { ...stale, note_title: 'Qui est Falkarst', job: job.id })

    // Paused: the next analysis is not read (the streamer can still ask for it)
    const paused = (await client.put('/api/memory').loginAs(user).json({ paused: true })).body() as any
    assert.isTrue(paused.paused)
    assert.equal(paused.sections.people, '- Cody : collègue de Maurice')
    const next = await live(user, 'Le lendemain', '2026-11-10', { status: 'CLIPPING' } as any)
    await jobStatusBus.handle({ job_id: next.id, status: 'DONE' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.lengthOf(reads(), 1)
    assert.deepEqual(((await client.get('/api/memory').loginAs(user)).body() as any).unread.map((j: any) => j.id), [next.id])

    // No engine: the analysis is done all the same
    await client.put('/api/memory').loginAs(user).json({ paused: false })
    engine(false)
    const away = await live(user, 'Sans moteur', '2026-11-11', { status: 'CLIPPING' } as any)
    await jobStatusBus.handle({ job_id: away.id, status: 'DONE' })
    await readLive(away.id).catch(() => {})
    assert.equal((await Job.findOrFail(away.id)).status, 'DONE')
  })

  test('the lives analysed before are read when the streamer asks, the oldest first, and it can be stopped', async ({ client, assert }) => {
    const user = await makeUser()
    ;(await client.post('/api/memory/read').loginAs(user)).assertStatus(409)
    const b = await live(user, 'Le lendemain', '2026-11-10')
    const a = await live(user, 'L’examen', '2026-11-09')
    await live(user, 'Rien à lire', '2026-11-11')

    slow = 40
    const started = await client.post('/api/memory/read').loginAs(user)
    started.assertStatus(202)
    assert.deepInclude((started.body() as any).reading, { total: 3, done: 0, failed: 0, stopping: false })
    // Asked again while it reads: the same rebuild, and the memory can't be thrown away under it
    ;(await client.post('/api/memory/read').loginAs(user)).assertStatus(202)
    ;(await client.delete('/api/memory').loginAs(user)).assertStatus(409)
    await rebuilt()
    assert.deepEqual(asked.filter((call) => call.url.endsWith('/memory')).map((call) => call.url), [`/jobs/${a.id}/memory`, `/jobs/${b.id}/memory`, asked.at(-1)!.url])
    const body = (await client.get('/api/memory').loginAs(user)).body() as any
    assert.isNull(body.reading)
    // A live nothing can be read from is counted, and doesn't stop the others
    assert.deepInclude(body.last, { read: 2, failed: 1, cost: 0.018 })
    assert.notProperty(body.last, 'stopped')
    assert.deepEqual(body.lives.map((e: any) => e.job), [b.id, a.id])
    assert.equal(body.sections.stories, '- Dernier live lu : Le lendemain')
    assert.lengthOf(body.unread, 1)

    // No credits left: it stops there and says why
    refuses = 402
    await live(user, 'Encore un', '2026-11-12')
    ;(await client.post('/api/memory/read').loginAs(user)).assertStatus(202)
    await rebuilt()
    assert.deepInclude(((await client.get('/api/memory').loginAs(user)).body() as any).last, { read: 0, failed: 0, stopped: 'credits' })
    // Stopped by the streamer (nothing is reading now: nothing to stop)
    assert.deepEqual((await client.delete('/api/memory/read').loginAs(user)).body(), { stopping: false })
  })

  test('the streamer corrects what the AI noted, and can throw it all away', async ({ client, assert }) => {
    const user = await makeUser()
    const job = await live(user, 'L’examen', '2026-11-09')
    await readLive(job.id)
    const saved = (await client.put('/api/memory').loginAs(user).json({ sections: { people: '- Cody : son meilleur ami\r\n- Blue : une recrue  ', intruder: 'x', who: 7 } })).body() as any
    // Only the sections sent change, as written; the rest stays
    assert.equal(saved.sections.people, '- Cody : son meilleur ami\n- Blue : une recrue')
    assert.equal(saved.sections.who, '- Streamer français')
    assert.notProperty(saved.sections, 'intruder')
    assert.notEqual(saved.updated_at, '2026-11-15T10:00:00Z')
    assert.lengthOf(((await client.put('/api/memory').loginAs(user).json({ sections: { who: 'x'.repeat(9000) } })).body() as any).sections.who, 3000)

    await client.put('/api/memory').loginAs(user).json({ paused: true })
    assert.deepEqual((await client.delete('/api/memory').loginAs(user)).body(), { cleared: true })
    const body = (await client.get('/api/memory').loginAs(user)).body() as any
    assert.deepEqual(body.sections, { who: '', games: '', people: '', stories: '', tastes: '' })
    assert.deepEqual(body.lives, [])
    // The live can be read again; that the streamer paused the memory is theirs to undo
    assert.deepEqual(body.unread.map((j: any) => j.id), [job.id])
    assert.isTrue(body.paused)
  })

  test('a correction proposed for a note is applied on its exact words, or refused for good', async ({ client, assert }) => {
    const user = await makeUser()
    writeNote()
    const second = { id: 'bbbbbbbbbbbb', note: 'qui', before: 'Il streame du mardi au samedi.', after: 'Il streame du lundi au vendredi.', why: 'Vu sur trois lives.' }
    // Kept: about a note there is, on words it holds. Not kept: an unknown note, words it doesn't hold, the same sentence twice
    const added = addProposals([stale, second, { ...stale, id: 'cccccccccccc' }, { ...stale, id: 'dddddddddddd', note: 'inconnue' }, { ...second, id: 'eeeeeeeeeeee', before: 'Il streame le dimanche.' }, 'non'], 'job-1')
    assert.deepEqual(added.map((p) => p.id), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
    assert.deepEqual(addProposals([stale], 'job-2'), [])
    assert.deepEqual(((await client.get('/api/memory/proposals').loginAs(user)).body() as any).proposals.map((p: any) => p.id), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])

    const applied = await client.post('/api/memory/proposals/aaaaaaaaaaaa/apply').loginAs(user)
    applied.assertStatus(200)
    assert.equal((applied.body() as any).note.body, 'Il jouait surtout à GTA ; depuis novembre il est passé à Crimson Desert.\nIl streame du mardi au samedi.')
    assert.include(readFileSync(path.join(notesDir(), 'qui.md'), 'utf-8'), 'title: Qui est Falkarst\n---\nIl jouait surtout à GTA')
    ;(await client.post('/api/memory/proposals/aaaaaaaaaaaa/apply').loginAs(user)).assertStatus(404)

    // Refused: gone, and the same sentence is not brought up again after the next live
    assert.deepEqual((await client.delete('/api/memory/proposals/bbbbbbbbbbbb').loginAs(user)).body(), { ignored: true })
    ;(await client.delete('/api/memory/proposals/bbbbbbbbbbbb').loginAs(user)).assertStatus(404)
    assert.deepEqual(addProposals([second], 'job-3'), [])
    assert.deepEqual(((await client.get('/api/memory/proposals').loginAs(user)).body() as any).proposals, [])

    // The streamer rewrote the note meanwhile: the correction no longer applies, and stops waiting
    const third = { id: 'ffffffffffff', note: 'qui', before: 'Il jouait surtout à GTA', after: 'Il joue à tout', why: '.' }
    assert.lengthOf(addProposals([third], 'job-4'), 1)
    writeFileSync(path.join(notesDir(), 'qui.md'), '---\ntitle: Qui est Falkarst\n---\nTout autre chose.\n')
    const late = await client.post('/api/memory/proposals/ffffffffffff/apply').loginAs(user)
    late.assertStatus(409)
    assert.deepEqual(late.body(), { error: 'note_changed' })
    assert.deepEqual(((await client.get('/api/memory/proposals').loginAs(user)).body() as any).proposals, [])
    assert.equal(readFileSync(path.join(notesDir(), 'qui.md'), 'utf-8'), '---\ntitle: Qui est Falkarst\n---\nTout autre chose.\n')
  })
})
