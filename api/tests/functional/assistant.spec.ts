import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import env from '#start/env'
import User from '#models/user'
import Job from '#models/job'
import { assistantDir, assistantTool } from '#services/assistant'
import { readSettings, writeSettings } from '#services/user_settings'

const SECRET = 'a-secret-for-tests'
const now = '2026-11-23T10:00:00.000Z'
const passage = (id: string, start: number, end: number, text: string) => ({ id, start, end, text, max_start: start - 5, max_end: end + 5 })
const video = (id: string, name: string, more: Record<string, unknown> = {}) => ({
  id,
  name,
  sections: [{ id: `${id}s`.slice(0, 10), title: 'Le plan', query: '', items: [passage(`${id.slice(0, 9)}a`, 100, 104, 'On y va'), passage(`${id.slice(0, 9)}b`, 200, 206, 'Cours !')] }],
  template: null,
  titles: true,
  hook: 'Le braquage tourne mal',
  target: 60,
  created_at: now,
  updated_at: now,
  ...more,
})
const idea = (id: string, name: string) => ({
  id,
  name,
  sections: [{ id: `${id}s`.slice(0, 10), title: '', query: '', items: [] }],
  template: null,
  titles: true,
  hook: '',
  target: 45,
  brief: 'Toutes les fois où…',
  suggestion: { key: id, pitch: 'Dit 25 fois', tags: ['gag'], score: 84, moments: [10, 20, 30] },
  created_at: now,
  updated_at: now,
})

test.group('The assistant', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const clean = () => {
    rmSync(assistantDir(), { recursive: true, force: true })
    // No channel: its lives on Twitch are never asked for from a test
    const settings = readSettings()
    delete settings.brand_kit
    writeSettings(settings)
  }
  group.each.setup(clean)
  group.each.teardown(clean)

  // Stands for the worker: answers a request of the conversation as a test tells it to, and keeps what it was asked
  let server: Server
  let answers: (body: any) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown }
  const asked: { method: string; url: string; body: any }[] = []
  group.setup(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', async () => {
        const body = raw ? JSON.parse(raw) : null
        asked.push({ method: req.method ?? '', url: req.url ?? '', body })
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/assistant/turn') {
          const answer = await answers(body)
          return res.writeHead(answer.status ?? 200).end(JSON.stringify(answer.body))
        }
        if (req.url?.startsWith('/assistant/progress')) return res.end(JSON.stringify({ steps: ['Lit le live'], running: true, sub: { tool: 'read' } }))
        if (req.url?.startsWith('/assistant/thread')) return res.end(JSON.stringify({ success: true }))
        if (req.url === '/jobs') return res.end('{}')
        res.writeHead(404).end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
  // (whatever a test left waiting is let go: the worker's stand-in never keeps the run from ending)
  let release: () => void = () => {}
  group.each.teardown(() => release())
  group.teardown(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const engine = (on: boolean) => env.set('WORKER_URL', on ? `http://127.0.0.1:${(server.address() as AddressInfo).port}` : 'http://127.0.0.1:9')
  group.each.setup(() => {
    asked.length = 0
    answers = () => ({ body: { status: 'done', reply: [{ type: 'text', text: 'Voilà.' }], steps: [], cost: 0.001 } })
    engine(true)
    env.set('CUTTIE_INTERNAL_SECRET', SECRET)
    return () => engine(false)
  })

  const makeUser = () => User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
  // (no streamer on these lives: with no channel set up, the app would take the latest live's and ask Twitch for its lives)
  const live = (user: User, title: string, date: string, more: Record<string, unknown> = {}) =>
    Job.create({ id: randomUUID(), url: `https://www.twitch.tv/videos/${Math.floor(Math.random() * 1e9)}`, status: 'DONE', userId: user.id, vodDurationSeconds: 15000, vodTitle: title, vodGame: 'Grand Theft Auto VI', streamDate: date, ...more } as any)
  /** What the worker would ask of the app while it answers */
  const tool = async (name: string, args: Record<string, unknown> = {}, secret = SECRET) => {
    const res = await fetch(`http://${env.get('HOST')}:${env.get('PORT')}/api/internal/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cuttie-Secret': secret }, body: JSON.stringify({ tool: name, args }) })
    return { status: res.status, body: (await res.json()) as any }
  }

  test('requires authentication, and the secret for what the worker asks', async ({ client, assert }) => {
    ;(await client.get('/api/assistant')).assertStatus(401)
    ;(await client.post('/api/assistant/turn').json({ text: 'Salut' })).assertStatus(401)
    ;(await client.get('/api/assistant/progress')).assertStatus(401)
    ;(await client.delete('/api/assistant')).assertStatus(401)
    assert.equal((await tool('lives', {}, 'wrong')).status, 401)
  })

  test('answers what the streamer says, knowing where they are, and keeps the conversation', async ({ client, assert }) => {
    const user = await makeUser()
    const other = await makeUser()
    const job = await live(user, 'Le yacht', '2026-11-20', { compilations: [video('vvvvvvvvvv', 'La mission du yacht', { source: 'sequence' })], hotPoints: [{ clip_filename: 'tigre.mp4', clip_name: 'Le Tigre', clip_start: 100, clip_end: 160, final_score: 0.81, llm: { seen: 'Un tigre blanc dans la fête.', tags: ['tigre'], cut_start: 5, cut_end: 40 } }] })
    const theirs = await live(other, 'Pas le sien', '2026-11-21')

    ;(await client.post('/api/assistant/turn').loginAs(user).json({})).assertStatus(400)
    answers = () => ({
      body: {
        status: 'done',
        reply: [
          { type: 'text', text: 'Deux choses à voir.' },
          { type: 'widget', kind: 'videos', items: [{ job: job.id, id: 'vvvvvvvvvv' }, { job: job.id, id: 'nope' }, { job: theirs.id, id: 'x' }] },
          { type: 'widget', kind: 'clips', items: [{ job: job.id, filename: 'tigre.mp4' }] },
          { type: 'widget', kind: 'lives', items: [{ job: job.id }, { vod: '123', title: 'Pas analysé', date: '2026-11-22' }] },
          { type: 'widget', kind: 'passages', items: [{ job: job.id, id: 'p1', start: 30, end: 36.5, text: 'À l’aide !' }, { job: theirs.id, start: 1, end: 2 }] },
          { type: 'widget', kind: 'videos', items: [{ job: theirs.id, id: 'x' }] },
        ],
        steps: ['Cherche « à l’aide »', 'Lit le passage'],
        cost: 0.0042,
      },
    })
    const first = await client.post('/api/assistant/turn').loginAs(user).json({ text: '  Trouve les moments où je dis à l’aide  ', context: { page: 'choose', job: job.id, clip: { filename: 'tigre.mp4', name: 'Le Tigre' } }, language: 'en' })
    first.assertStatus(200)
    const body = first.body() as any

    // The worker is given the conversation, what was said, where the streamer is (the live's title read here) and their language
    const sent = asked.find((call) => call.url === '/assistant/turn')!.body
    assert.match(sent.thread, /^[A-Za-z0-9_-]{1,64}$/)
    assert.deepInclude(sent, { text: 'Trouve les moments où je dis à l’aide', language: 'en' })
    assert.deepEqual(sent.context, { page: 'choose', job: job.id, clip: { filename: 'tigre.mp4', name: 'Le Tigre' }, title: 'Le yacht' })

    // What the streamer said is kept with where they were
    assert.deepInclude(body.said, { role: 'user', text: 'Trouve les moments où je dis à l’aide', where: ['Le yacht', 'Le Tigre'] })
    // The answer: its words, and each card with what the panel draws (only the streamer's own things)
    const reply = body.message.reply
    assert.deepEqual(reply[0], { type: 'text', text: 'Deux choses à voir.' })
    assert.deepEqual(reply.map((block: any) => block.kind ?? block.type), ['text', 'videos', 'clips', 'lives', 'passages'])
    assert.lengthOf(reply[1].items, 1)
    assert.deepInclude(reply[1].items[0], { id: 'vvvvvvvvvv', job: job.id, name: 'La mission du yacht', source: 'sequence', seconds: 10, passages: 2, state: 'draft' })
    assert.deepInclude(reply[2].items[0], { job: job.id, filename: 'tigre.mp4', name: 'Le Tigre', score: 81, length: 35, seen: 'Un tigre blanc dans la fête.' })
    assert.deepEqual(reply[3].items, [{ job: job.id, analysed: true, title: 'Le yacht', date: '2026-11-20', game: 'Grand Theft Auto VI' }, { analysed: false, title: 'Pas analysé', date: '2026-11-22', vod: '123' }])
    assert.lengthOf(reply[4].items, 1)
    assert.deepInclude(reply[4].items[0], { job: job.id, id: 'p1', start: 30, end: 36.5, text: 'À l’aide !' })
    assert.deepInclude(body.message, { role: 'assistant', steps: ['Cherche « à l’aide »', 'Lit le passage'], cost: 0.0042, action: null })
    assert.deepEqual(body.changed, [])

    // The conversation is there when the page is loaded again, and goes on under the same name
    const kept = (await client.get('/api/assistant').loginAs(user)).body() as any
    assert.deepEqual(kept.messages.map((m: any) => m.role), ['user', 'assistant'])
    assert.isFalse(kept.busy)
    await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Merci', context: { page: 'home', job: theirs.id } })
    const again = asked.filter((call) => call.url === '/assistant/turn')[1].body
    assert.equal(again.thread, sent.thread)
    // (a live that is not theirs is not passed on)
    assert.deepEqual(again.context, { page: 'home' })
    // Nobody else reads it
    assert.deepEqual(((await client.get('/api/assistant').loginAs(other)).body() as any).messages, [])
  })

  test('hands an action to the page, then goes on with its answer', async ({ client, assert }) => {
    const user = await makeUser()
    const job = await live(user, 'Le yacht', '2026-11-20')
    const cut = { call: 'call-1', name: 'cut_clip', args: { job: job.id, clip: 'tigre.mp4', target: 45 }, needs: 'app' }
    answers = (body) =>
      body.resume
        ? { body: { status: 'done', reply: [{ type: 'text', text: 'Le clip fait 44 secondes.' }], steps: ['Découpe le clip', 'Regarde le résultat'], cost: 0.012 } }
        : { body: { status: 'action', reply: [], action: cut, steps: ['Découpe le clip'], cost: 0.004 } }

    const asking = (await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Découpe-moi ce clip', context: { job: job.id } })).body() as any
    assert.deepEqual(asking.message.action, cut)
    assert.deepEqual(asking.message.reply, [])

    // An answer to something nobody waits for
    ;(await client.post('/api/assistant/turn').loginAs(user).json({ resume: { call: 'other', result: {} } })).assertStatus(409)
    // The page did it: the same message goes on, with the whole request's steps and cost
    const done = (await client.post('/api/assistant/turn').loginAs(user).json({ resume: { call: 'call-1', result: { ok: true, seconds: 44 } }, context: { job: job.id } })).body() as any
    assert.deepEqual(asked.filter((call) => call.url === '/assistant/turn')[1].body.resume, { call: 'call-1', result: { ok: true, seconds: 44 } })
    assert.equal(done.message.id, asking.message.id)
    assert.notProperty(done, 'said')
    assert.deepInclude(done.message, { action: null, cost: 0.012, steps: ['Découpe le clip', 'Regarde le résultat'] })
    assert.deepEqual(done.message.reply, [{ type: 'text', text: 'Le clip fait 44 secondes.' }])
    assert.lengthOf(((await client.get('/api/assistant').loginAs(user)).body() as any).messages, 2)
    // Answered once
    ;(await client.post('/api/assistant/turn').loginAs(user).json({ resume: { call: 'call-1', result: {} } })).assertStatus(409)
  })

  test('something new said while it waits drops what it waited for', async ({ client, assert }) => {
    const user = await makeUser()
    answers = (body) =>
      body.text === 'Analyse mon dernier live'
        ? { body: { status: 'action', reply: [], action: { call: 'ask-1', name: 'ask_approval', args: { what: 'analyse_live', detail: 'Le yacht', cost: 0.3 }, needs: 'approval' }, steps: [], cost: 0.001 } }
        : { body: { status: 'done', reply: [{ type: 'text', text: 'D’accord.' }], steps: [], cost: 0.001 } }
    const waiting = (await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Analyse mon dernier live' })).body() as any
    assert.deepInclude(waiting.message.action, { name: 'ask_approval', needs: 'approval' })
    await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Non, laisse' })
    const messages = ((await client.get('/api/assistant').loginAs(user)).body() as any).messages
    assert.lengthOf(messages, 4)
    assert.isNull(messages[1].action)
    ;(await client.post('/api/assistant/turn').loginAs(user).json({ resume: { call: 'ask-1', result: { approved: true } } })).assertStatus(409)
  })

  test('gives the assistant the lives, clips and videos of whoever is asking, and does what it may', async ({ client, assert }) => {
    const user = await makeUser()
    const other = await makeUser()
    const job = await live(user, 'Le yacht', '2026-11-20', {
      compilations: [video('vvvvvvvvvv', 'La mission du yacht', { source: 'sequence', universe: 'gta', effects: 'light', intro: { style: 'sunset' } }), idea('iiiiiiiiii', 'La malédiction du calme')],
      hotPoints: [
        { clip_filename: 'banque.mp4', clip_name: 'La Banque', clip_start: 3300, clip_end: 3360, timestamp_seconds: 3330, final_score: 0.66, llm: { summary: 'Un goéland à la banque' } },
        { clip_filename: 'tigre.mp4', clip_name: 'Le Tigre', clip_start: 100, clip_end: 160, timestamp_seconds: 120, final_score: 0.81, llm: { seen: 'Un tigre blanc dans la fête.', tags: ['tigre'], cut_start: 5, cut_end: 40 } },
      ],
      selection: { 'banque.mp4': { state: 'kept', trim: [5, 40] } },
      timeline: { candidates: [{ t: 120, score: 0.8, name: 'Le tigre' }] },
    })
    await live(user, 'En cours', '2026-11-22', { status: 'ANALYZING_AUDIO' })
    const theirs = await live(other, 'Pas le sien', '2026-11-21', { compilations: [video('oooooooooo', 'À un autre')] })

    const got: Record<string, any> = {}
    answers = async () => {
      // What the worker asks while it answers: about the streamer it is answering, never someone else
      got.lives = await tool('lives')
      got.meta = await tool('live_meta', { job: job.id })
      got.clips = await tool('clips', { job: job.id })
      got.videos = await tool('videos', { job: job.id })
      got.all = await tool('videos')
      got.video = await tool('video', { job: job.id, id: 'vvvvvvvvvv' })
      got.idea = await tool('video', { job: job.id, id: 'iiiiiiiiii' })
      got.foreign = await tool('videos', { job: theirs.id })
      got.keep = await tool('keep_clip', { job: job.id, clip: 'tigre.mp4', state: 'kept' })
      got.unkeep = await tool('keep_clip', { job: job.id, clip: 'banque.mp4', state: 'none' })
      got.missing = await tool('keep_clip', { job: job.id, clip: 'nope.mp4', state: 'kept' })
      got.ideas = await tool('ideas', { job: job.id, note: 'Deux idées.', ideas: [{ key: 'iiiiiiiiii', title: 'Déjà là', brief: 'x', score: 90 }, { key: 'tigres', title: 'Les tigres', brief: 'Tous les moments avec le tigre.', seconds: 50, pitch: 'Le tigre revient 6 fois.', tags: ['tigre'], score: 77, moments: [120, 900, 4000] }] })
      got.unknown = await tool('nope', { job: job.id })
      return { body: { status: 'done', reply: [], steps: [], cost: 0 } }
    }
    const body = (await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Fais le tour' })).body() as any

    // Their lives, the newest first, analysed or not
    assert.deepEqual(got.lives.body.lives.map((one: any) => [one.title, one.analysed, one.status]), [['En cours', false, 'ANALYZING_AUDIO'], ['Le yacht', true, 'DONE']])
    assert.deepInclude(got.lives.body.lives[1], { job: job.id, game: 'Grand Theft Auto VI', seconds: 15000, clips: 2, ideas: 1 })
    assert.deepInclude(got.meta.body, { duration: 15000, game: 'Grand Theft Auto VI', title: 'Le yacht', date: '2026-11-20' })
    assert.lengthOf(got.meta.body.moments, 1)
    // The clips of the analysis, the best first, with what was decided of each
    assert.deepEqual(got.clips.body.clips.map((c: any) => [c.filename, c.score, c.at, c.length, c.state]), [['tigre.mp4', 81, 120, 35, null], ['banque.mp4', 66, 3330, 35, 'kept']])
    assert.deepInclude(got.clips.body.clips[0], { name: 'Le Tigre', seen: 'Un tigre blanc dans la fête.', tags: ['tigre'] })
    assert.equal(got.clips.body.clips[1].seen, 'Un goéland à la banque')
    // The videos: one in the making, one idea nobody built
    assert.deepEqual(got.videos.body.videos.map((v: any) => [v.id, v.source, v.state, v.passages]), [['vvvvvvvvvv', 'sequence', 'draft', 2], ['iiiiiiiiii', 'compilation', 'idea', 0]])
    assert.deepInclude(got.videos.body.videos[1], { score: 84, pitch: 'Dit 25 fois', seconds: 45 })
    assert.deepEqual(got.all.body.videos.map((v: any) => v.id), ['vvvvvvvvvv', 'iiiiiiiiii'])
    // One video: its parts, passage by passage, and how it is dressed
    assert.deepEqual(got.video.body.parts, [{ title: 'Le plan', passages: [{ id: 'vvvvvvvvva', start: 100, end: 104, text: 'On y va' }, { id: 'vvvvvvvvvb', start: 200, end: 206, text: 'Cours !' }] }])
    assert.deepInclude(got.video.body.look, { universe: 'gta', effects: 'light', transition: 'cut', opening: 'intro', intro: 'sunset', music: null, titles: true, on_screen_title: 'Le braquage tourne mal' })
    assert.deepInclude(got.idea.body.idea, { pitch: 'Dit 25 fois', moments: [10, 20, 30], brief: 'Toutes les fois où…', target: 45 })
    // Someone else's live does not exist for it
    assert.deepEqual(got.foreign.body, { error: 'no such live' })
    assert.deepEqual(got.unknown.body, { error: 'unknown tool: nope' })

    // A clip kept, another no longer: the cut the streamer made stays
    assert.deepEqual(got.keep.body, { ok: true, clip: 'tigre.mp4', state: 'kept' })
    assert.deepEqual(got.missing.body, { error: 'no such clip in this live' })
    await job.refresh()
    assert.deepEqual(job.selection, { 'banque.mp4': { trim: [5, 40] }, 'tigre.mp4': { state: 'kept' } } as any)
    // Ideas it found: the new one waits to be built like those of the analysis, the known one is not proposed twice
    assert.equal(got.ideas.body.created, 1)
    assert.deepEqual(got.ideas.body.videos.map((v: any) => v.key), ['iiiiiiiiii', 'tigres'])
    const made = job.compilations!.find((c) => c.suggestion?.key === 'tigres')!
    assert.deepInclude(made, { name: 'Les tigres', brief: 'Tous les moments avec le tigre.', target: 50, universe: 'gta' })
    assert.equal(got.ideas.body.videos[1].id, made.id)
    assert.deepInclude(job.suggestions, { note: 'Deux idées.' })
    // The page learns which lives changed under it
    assert.deepEqual(body.changed, [job.id])
  })

  test('tells the assistant what was set by hand on a passage: its effects, the music under it', async ({ assert }) => {
    const user = await makeUser()
    const byHand: any = video('hhhhhhhhhh', 'À la main', { effects: 'custom', chat: 'on' })
    byHand.sections[0].items[0] = {
      ...byHand.sections[0].items[0],
      moves: [
        { id: 'move0001', kind: 'cam', at: 101.5, for: 1.7, sharp: true, amount: 1.3 },
        { id: 'move0002', kind: 'flash', at: 103, for: 0.35 },
      ],
      musicLevel: 0.4,
    }
    // (a video whose effects follow a level again: what a passage had of its own is not what plays)
    const byLevel: any = video('llllllllll', 'Par niveau', { effects: 'light' })
    byLevel.sections[0].items[0] = { ...byLevel.sections[0].items[0], moves: [{ id: 'move0003', kind: 'zoom', at: 101, for: 1.3 }] }
    const job = await live(user, 'Le yacht', '2026-11-20', { compilations: [byHand, byLevel] })

    const told = (await assistantTool(user.id, 'video', { job: job.id, id: 'hhhhhhhhhh' })) as any
    // Each effect by its id, dated from its passage's start as `edit_effects` wants it
    assert.deepEqual(told.parts[0].passages, [
      {
        id: 'hhhhhhhhha',
        start: 100,
        end: 104,
        text: 'On y va',
        effects: [
          { id: 'move0001', kind: 'cam', at: 1.5, seconds: 1.7, sharp: true },
          { id: 'move0002', kind: 'flash', at: 3, seconds: 0.35 },
        ],
        music_percent: 40,
      },
      { id: 'hhhhhhhhhb', start: 200, end: 206, text: 'Cours !' },
    ])
    assert.deepInclude(told.look, { effects: 'custom', chat: 'on' })

    const level = (await assistantTool(user.id, 'video', { job: job.id, id: 'llllllllll' })) as any
    assert.deepEqual(level.parts[0].passages[0], { id: 'llllllllla', start: 100, end: 104, text: 'On y va' })
    assert.deepInclude(level.look, { effects: 'light', chat: 'template' })
  })

  test('starts the analysis of a live once asked to, never twice', async ({ client, assert }) => {
    const user = await makeUser()
    const done = await live(user, 'Déjà fait', '2026-11-20', { url: 'https://www.twitch.tv/videos/2600000001' })
    const failed = await live(user, 'Raté', '2026-11-19', { url: 'https://www.twitch.tv/videos/2600000002', status: 'ERROR' })
    const got: Record<string, any> = {}
    answers = async () => {
      got.new = await tool('start_analysis', { url: 'https://www.twitch.tv/videos/2600000003' })
      got.known = await tool('start_analysis', { vod: '2600000001' })
      got.again = await tool('start_analysis', { vod: '2600000002' })
      got.bad = await tool('start_analysis', { url: 'https://example.com/video' })
      return { body: { status: 'done', reply: [], steps: [], cost: 0 } }
    }
    const body = (await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Analyse mon dernier live' })).body() as any
    assert.isTrue(got.new.body.ok)
    const started = await Job.findOrFail(got.new.body.job)
    assert.deepInclude(started.serialize(), { url: 'https://www.twitch.tv/videos/2600000003', status: 'PENDING', userId: user.id })
    assert.deepInclude(asked.find((call) => call.url === '/jobs')!.body, { job_id: started.id, url: 'https://www.twitch.tv/videos/2600000003' })
    assert.deepEqual(got.known.body, { error: 'this live is already analysed', job: done.id })
    // An analysis that failed can be started again
    assert.isTrue(got.again.body.ok)
    assert.notEqual(got.again.body.job, failed.id)
    assert.match(got.bad.body.error, /not a Twitch live/)
    assert.sameMembers(body.changed, [got.new.body.job, got.again.body.job])
  })

  test('says why it could not answer, and keeps what was asked', async ({ client, assert }) => {
    const user = await makeUser()
    const ask = async (text: string) => (await client.post('/api/assistant/turn').loginAs(user).json({ text })).body() as any
    answers = () => ({ status: 402, body: { detail: 'credits' } })
    assert.deepInclude((await ask('Un')).message, { failed: 'credits', action: null })
    answers = () => ({ status: 401, body: { detail: 'key' } })
    assert.equal((await ask('Deux')).message.failed, 'key')
    answers = () => ({ status: 501, body: { detail: 'the assistant needs a model that calls tools' } })
    assert.equal((await ask('Trois')).message.failed, 'dev')
    answers = () => ({ status: 502, body: { detail: 'boom' } })
    assert.equal((await ask('Quatre')).message.failed, 'failed')
    engine(false)
    assert.equal((await ask('Cinq')).message.failed, 'unreachable')
    engine(true)
    assert.lengthOf(((await client.get('/api/assistant').loginAs(user)).body() as any).messages, 10)

    // The worker still on an earlier request: nothing of this one is kept
    answers = () => ({ status: 409, body: { detail: 'busy: this conversation is already answering' } })
    const busy = await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Six' })
    busy.assertStatus(409)
    assert.deepEqual(busy.body() as unknown, { error: 'busy' })
    assert.lengthOf(((await client.get('/api/assistant').loginAs(user)).body() as any).messages, 10)
  })

  test('says what it is doing while it answers, one request at a time, and starts over when asked', async ({ client, assert }) => {
    const user = await makeUser()
    assert.deepEqual((await client.get('/api/assistant/progress').loginAs(user)).body(), { steps: [], running: false })

    const held = new Promise<void>((resolve) => (release = resolve))
    answers = async () => {
      await held
      return { body: { status: 'done', reply: [{ type: 'text', text: 'Fini.' }], steps: ['Lit le live'], cost: 0.002 } }
    }
    const first = client.post('/api/assistant/turn').loginAs(user).json({ text: 'Trouve des idées' }).then((res) => res)
    for (let n = 0; n < 200 && !asked.some((call) => call.url === '/assistant/turn'); n++) await new Promise((resolve) => setTimeout(resolve, 10))
    // While it answers: what it does, the streamer's message already kept, no second request, no new conversation
    assert.deepEqual((await client.get('/api/assistant/progress').loginAs(user)).body(), { steps: ['Lit le live'], running: true, sub: { tool: 'read' } })
    const during = (await client.get('/api/assistant').loginAs(user)).body() as any
    assert.isTrue(during.busy)
    assert.deepEqual(during.messages.map((m: any) => m.text), ['Trouve des idées'])
    ;(await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Et aussi' })).assertStatus(409)
    ;(await client.delete('/api/assistant').loginAs(user)).assertStatus(409)
    release()
    assert.equal(((await first).body() as any).message.reply[0].text, 'Fini.')

    // A new conversation: another name for the worker, which forgets the old one
    const thread = asked.find((call) => call.url === '/assistant/turn')!.body.thread
    const fresh = await client.delete('/api/assistant').loginAs(user)
    fresh.assertBody({ messages: [], busy: false })
    assert.isTrue(asked.some((call) => call.method === 'DELETE' && call.url === `/assistant/thread?thread=${thread}`))
    answers = () => ({ body: { status: 'done', reply: [], steps: [], cost: 0 } })
    await client.post('/api/assistant/turn').loginAs(user).json({ text: 'Salut' })
    assert.notEqual(asked.filter((call) => call.url === '/assistant/turn').at(-1)!.body.thread, thread)
  })
})
