import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import env from '#start/env'
import User from '#models/user'
import Job from '#models/job'
import jobStatusBus from '#services/job_status_bus'
import { proposed, suggestCompilations, waitingCount } from '#services/suggestions'
import type { LiveIdea } from '#services/worker_client'

const idea = (key: string, more: Partial<LiveIdea> = {}): LiveIdea => ({
  key,
  title: 'La malédiction du calme',
  brief: 'Fais une vidéo en deux parties : tous les moments où quelqu’un dit que la soirée est calme, puis quand tout part en vrille.',
  seconds: 65,
  pitch: '« Calme » revient 25 fois avant que l’hôpital soit débordé.',
  tags: ['running gag', 'gta rp'],
  kind: 'funny',
  score: 84,
  moments: [2421, 4414, 11430],
  ...more,
})

test.group('Compilations proposed by the AI', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // Stands for the worker: answers what a test tells it to, and keeps what it was asked
  let server: Server
  let ideas: LiveIdea[] = []
  const asked: { url: string; body: any }[] = []
  group.setup(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        asked.push({ url: req.url ?? '', body: raw ? JSON.parse(raw) : null })
        res.setHeader('Content-Type', 'application/json')
        if (req.url?.endsWith('/ideas')) res.end(JSON.stringify({ ideas, note: 'Un running gag et une histoire.', cost: 0.006, cached: false }))
        else if (req.url?.endsWith('/plan')) res.end(JSON.stringify({ title: 'Calme', sections: [], note: '' }))
        else if (req.url?.endsWith('/search')) res.end(JSON.stringify({ hits: [], total: 0, transcript: true, cached: false, cost: 0.002 }))
        else if (req.url?.endsWith('/sound')) res.end(JSON.stringify({ kind: 'funny', music: null, intro: 'news', why: 'Flash info.', teaser: 3, cost: 0.0004 }))
        else res.writeHead(404).end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
  group.teardown(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const engine = (on: boolean) => env.set('WORKER_URL', on ? `http://127.0.0.1:${(server.address() as AddressInfo).port}` : 'http://127.0.0.1:9')
  group.each.setup(() => {
    asked.length = 0
    ideas = []
    engine(true)
    return () => engine(false)
  })

  async function setup(status = 'DONE') {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status,
      userId: user.id,
      vodDurationSeconds: 24560,
      vodTitle: 'Maurice fait passer son examen',
      streamer: 'Falkarst',
      timeline: { duration: 24560, energy: [0.2, 0.8], candidates: [{ t: 2421, state: 'kept', score: 0.8, name: 'Trop calme' }] },
    })
    return { user, job }
  }

  test('ideas become videos that wait to be built: never one already proposed, never more than there is room for', ({ assert }) => {
    const made = proposed(
      [
        idea('aaaaaaaaaaaa'),
        idea('bbbbbbbbbbbb', { title: 'Déjà proposée' }),
        idea('cccccccccccc', { title: 'La Brigade du Tigre', kind: 'epic', seconds: 5000, tags: ['tigre', '', 'une étiquette vraiment trop longue pour une carte'], score: 131 }),
        idea('aaaaaaaaaaaa', { title: 'La même deux fois' }),
        idea('dddddddddddd', { title: '' }),
        idea('eeeeeeeeeeee', { title: 'Pas de place' }),
      ],
      new Set(['bbbbbbbbbbbb']),
      2,
      'slam',
      '2026-11-15T10:00:00.000Z'
    )
    assert.deepEqual(made.map((c) => c.name), ['La malédiction du calme', 'La Brigade du Tigre'])
    const [calm, tiger] = made
    // The request the AI wrote is the video's description; nothing is built: one empty part, no answer
    assert.equal(calm.brief, idea('x').brief)
    assert.equal(calm.target, 65)
    assert.deepEqual(calm.sections.map((s) => s.items), [[]])
    assert.notProperty(calm, 'answer')
    assert.deepEqual(calm.suggestion, { key: 'aaaaaaaaaaaa', pitch: idea('x').pitch, tags: ['running gag', 'gta rp'], kind: 'funny', score: 84, moments: [2421, 4414, 11430] })
    // Opens with the intro the streamer prefers, like any new compilation
    assert.deepEqual(calm.intro, { style: 'slam' })
    assert.match(calm.id, /^[a-z0-9]{10}$/)
    assert.notEqual(calm.id, tiger.id)
    // What makes no sense is brought back to what does
    assert.equal(tiger.target, 45)
    assert.equal(tiger.suggestion!.score, 100)
    assert.notProperty(tiger.suggestion!, 'kind')
    assert.deepEqual(tiger.suggestion!.tags, ['tigre', 'une étiquette vraiment t'])
    assert.equal(waitingCount(made), 2)
    assert.lengthOf(proposed([idea('ffffffffffff')], new Set(), 0), 0)
  })

  test('the AI looks through a live when asked: what it proposes waits, is counted, and is never proposed twice', async ({ client, assert }) => {
    const { user, job } = await setup()
    ideas = [idea('aaaaaaaaaaaa'), idea('cccccccccccc', { title: 'La Brigade du Tigre', score: 71 })]
    const first = await client.post(`/api/jobs/${job.id}/suggestions`).loginAs(user)
    first.assertStatus(200)
    const body = first.body() as any
    assert.deepEqual(body.compilations.map((c: any) => c.name), ['La malédiction du calme', 'La Brigade du Tigre'])
    assert.equal(body.found, 2)
    assert.equal(body.note, 'Un running gag et une histoire.')
    assert.equal(body.cost, 0.006)
    // The engine got the live as a search gets it: who, what, where to listen, the moments the analysis rated
    assert.equal(asked[0].url, `/jobs/${job.id}/ideas`)
    assert.equal(asked[0].body.duration, 24560)
    assert.equal(asked[0].body.meta.streamer, 'Falkarst')
    assert.equal(asked[0].body.url, 'https://twitch.tv/videos/123')
    assert.lengthOf(asked[0].body.moments, 1)

    // Counted wherever the live is listed
    assert.equal(((await client.get(`/api/jobs/${job.id}`).loginAs(user)).body() as any).suggested, 2)
    assert.equal(((await client.get('/api/jobs').loginAs(user)).body() as any).data[0].suggested, 2)
    assert.deepInclude((await client.get(`/api/jobs/${job.id}/suggestions`).loginAs(user)).body() as any, { suggested: 2, looking: false })
    // The library shows what the AI saw, not which moments
    const library = ((await client.get('/api/compilations').loginAs(user)).body() as any).lives[0]
    assert.isString(library.looked_at)
    assert.isFalse(library.looking)
    const cards = library.compilations
    assert.deepEqual(cards[0].suggestion, { pitch: idea('x').pitch, tags: ['running gag', 'gta rp'], kind: 'funny', score: 84, moments: 3 })
    assert.isTrue(cards[0].waiting)
    assert.equal(cards[0].target, 65)
    assert.isTrue(cards[0].described)
    assert.equal(cards[0].passages, 0)

    // Asked again with one more idea: only that one is new
    ideas = [...ideas, idea('dddddddddddd', { title: 'Un enterrement en dix minutes' })]
    const again = (await client.post(`/api/jobs/${job.id}/suggestions`).loginAs(user)).body() as any
    assert.deepEqual(again.compilations.map((c: any) => c.name), ['Un enterrement en dix minutes'])
    assert.equal(again.found, 3)

    // An idea the streamer deleted is not proposed again
    const gone = body.compilations[1].id
    ;(await client.delete(`/api/jobs/${job.id}/compilations/${gone}`).loginAs(user)).assertStatus(200)
    const third = (await client.post(`/api/jobs/${job.id}/suggestions`).loginAs(user)).body() as any
    assert.deepEqual(third.compilations, [])
    const kept = await Job.findOrFail(job.id)
    assert.deepEqual(kept.suggestions!.keys, ['aaaaaaaaaaaa', 'cccccccccccc', 'dddddddddddd'])
    assert.equal(kept.suggestions!.note, 'Un running gag et une histoire.')
    assert.equal(waitingCount(kept.compilations), 2)
  })

  test('a proposed video stays the AI’s idea once built, and a copy of it is the streamer’s own', async ({ client, assert }) => {
    const { user, job } = await setup()
    ideas = [idea('aaaaaaaaaaaa')]
    const made = ((await client.post(`/api/jobs/${job.id}/suggestions`).loginAs(user)).body() as any).compilations[0]
    const url = `/api/jobs/${job.id}/compilations/${made.id}`

    // Built (the app saves what the AI planned): the idea stays with it, whatever the app sends about it
    const item = { id: 'aaaaaaaaaa', start: 2421, end: 2424, text: 'c’est calme', why: '', sources: ['ai'] }
    const built = await client
      .put(url)
      .loginAs(user)
      .json({ ...made, suggestion: { key: 'x', pitch: 'forged', tags: [], score: 1, moments: [] }, answer: 'Deux parties.', sections: [{ ...made.sections[0], title: 'Calme', items: [item] }] })
    built.assertStatus(200)
    const saved = (built.body() as any).compilation
    assert.equal(saved.suggestion.pitch, idea('x').pitch)
    assert.equal(saved.answer, 'Deux parties.')
    // ...and it no longer waits
    const card = ((await client.get('/api/compilations').loginAs(user)).body() as any).lives[0].compilations[0]
    assert.isFalse(card.waiting)
    assert.equal(card.suggestion.score, 84)
    assert.equal(((await client.get(`/api/jobs/${job.id}`).loginAs(user)).body() as any).suggested, 0)

    const copy = ((await client.post(`${url}/duplicate`).loginAs(user).json({ name: 'Calme, copie' })).body() as any).compilation
    assert.notProperty(copy, 'suggestion')
    assert.equal(copy.brief, made.brief)
  })

  test('a proposed video is built from the moments the AI had spotted for it', async ({ client, assert }) => {
    const { user, job } = await setup()
    ;(await client.post(`/api/jobs/${job.id}/plan`).loginAs(user).json({ brief: 'les moments calmes', target: 65, leads: [2421, 'x', -4, 11430.5] })).assertStatus(200)
    assert.deepEqual(asked[0].body.leads, [2421, 11430.5])
    // A video the streamer described has none; a change asked on a video neither
    ;(await client.post(`/api/jobs/${job.id}/plan`).loginAs(user).json({ brief: 'les moments calmes', target: 65 })).assertStatus(200)
    ;(await client.post(`/api/jobs/${job.id}/plan`).loginAs(user).json({ brief: 'les moments calmes', request: 'ajoute', current: [], leads: [2421] })).assertStatus(200)
    assert.notProperty(asked[1].body, 'leads')
    assert.notProperty(asked[2].body, 'leads')
  })

  test('a question asked again on purpose is told to the engine as such', async ({ client, assert }) => {
    const { user, job } = await setup()
    const search = `/api/jobs/${job.id}/search`
    const plan = `/api/jobs/${job.id}/plan`
    ;(await client.post(search).loginAs(user).json({ query: 'calme', mode: 'ai' })).assertStatus(200)
    ;(await client.post(search).loginAs(user).json({ query: 'calme', mode: 'ai', fresh: true })).assertStatus(200)
    ;(await client.post(plan).loginAs(user).json({ brief: 'les moments calmes', target: 65, fresh: true })).assertStatus(200)
    // Anything but a plain yes is not one; a change asked on a video is always asked anew, nothing to force
    ;(await client.post(search).loginAs(user).json({ query: 'calme', mode: 'ai', fresh: 'yes' })).assertStatus(200)
    ;(await client.post(plan).loginAs(user).json({ brief: 'les moments calmes', request: 'ajoute', current: [], fresh: true })).assertStatus(200)
    assert.deepEqual(
      asked.map((call) => call.body.fresh ?? null),
      [null, true, true, null, null]
    )
  })

  test('the AI is told which intros it gave the last videos, never those the streamer picked', async ({ client, assert }) => {
    const { user, job } = await setup()
    const item = { id: 'aaaaaaaaaa', start: 10, end: 14, text: 'c’est calme', why: '', sources: ['ai'] }
    const video = (id: string, intro: Record<string, unknown> | null, at: string, items = [item]) => ({
      id,
      name: id,
      sections: [{ id: `${id}s`.slice(0, 10), title: '', query: '', items }],
      template: null,
      titles: true,
      hook: '',
      target: null,
      ...(intro ? { intro } : {}),
      created_at: at,
      updated_at: at,
    })
    job.compilations = [
      video('aiolder111', { style: 'neon', by: 'ai' }, '2026-11-10T10:00:00.000Z'),
      // Picked by the streamer, however often: their taste, nothing to stay away from
      video('byhand1111', { style: 'slam' }, '2026-11-14T10:00:00.000Z'),
      video('byhand2222', { style: 'slam' }, '2026-11-15T09:00:00.000Z'),
      video('ainewer111', { style: 'arcade', by: 'ai' }, '2026-11-15T10:00:00.000Z'),
      // An idea nobody opened has no video yet; the video being decided doesn't count against itself
      video('waiting111', { style: 'glitch', by: 'ai' }, '2026-11-15T11:00:00.000Z', []),
      video('deciding11', { style: 'rush', by: 'ai' }, '2026-11-15T12:00:00.000Z'),
    ] as any
    await job.save()
    // ...and what another live of theirs holds counts too
    const other = await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/456', status: 'DONE', userId: user.id, vodDurationSeconds: 3600 })
    other.compilations = [video('otherlive1', { style: 'bands', by: 'ai' }, '2026-11-12T10:00:00.000Z')] as any
    await other.save()

    const said = Array.from({ length: 34 }, (_, n) => `  phrase ${n + 1}  `)
    const chosen = await client.post(`/api/jobs/${job.id}/sound`).loginAs(user).json({ title: 'Calme', parts: [], seconds: 60, passages: 8, said, lengths: [4.2, 'long', 900, ...Array.from({ length: 31 }, () => 5)], compilation: 'deciding11' })
    chosen.assertStatus(200)
    assert.equal((chosen.body() as any).intro, 'news')
    // The passages the AI is told, in the video's order (thirty at most): it names the one the video could open on by its place among them
    assert.deepEqual(asked[0].body.video.said.slice(0, 2), ['phrase 1', 'phrase 2'])
    assert.lengthOf(asked[0].body.video.said, 30)
    // ...and how long each one lasts
    assert.deepEqual(asked[0].body.video.lengths.slice(0, 4), [4.2, 0, 120, 5])
    assert.lengthOf(asked[0].body.video.lengths, 30)
    assert.equal((chosen.body() as any).teaser, 3)
    assert.deepEqual(asked[0].body.recent_intros, ['arcade', 'bands', 'neon'])

    // Saved by the app, an intro keeps who chose it; picked again by hand, it no longer says the AI did
    const url = `/api/jobs/${job.id}/compilations/deciding11`
    const kept = await client.put(url).loginAs(user).json({ ...video('deciding11', { style: 'news', by: 'ai' }, ''), name: 'Calme' })
    assert.deepEqual((kept.body() as any).compilation.intro, { style: 'news', by: 'ai' })
    const picked = await client.put(url).loginAs(user).json({ ...video('deciding11', { style: 'slam', by: 'someone' }, ''), name: 'Calme' })
    assert.deepEqual((picked.body() as any).compilation.intro, { style: 'slam' })
  })

  test('the end of an analysis has the AI look through the live, once', async ({ assert }) => {
    const { job } = await setup('CLIPPING')
    ideas = [idea('aaaaaaaaaaaa')]
    await jobStatusBus.handle({ job_id: job.id, status: 'CLIPPING', progress: '…' })
    assert.lengthOf(asked, 0)
    await jobStatusBus.handle({ job_id: job.id, status: 'DONE', progress: 'Analysis complete!' })
    // In the background: the analysis is done whether or not the look succeeds. Joining it here to see what it did
    await suggestCompilations(job.id)
    assert.lengthOf(asked, 1)
    const after = await Job.findOrFail(job.id)
    assert.equal(after.status, 'DONE')
    assert.deepEqual((after.compilations ?? []).map((c) => c.name), ['La malédiction du calme'])
    // Said done again (a clip added later): not a new analysis
    await jobStatusBus.handle({ job_id: job.id, status: 'DONE' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.lengthOf(asked, 1)
  })

  test('nothing is proposed without the engine, for a live still being analysed, or for someone else’s', async ({ client, assert }) => {
    const { user, job } = await setup()
    engine(false)
    const away = await client.post(`/api/jobs/${job.id}/suggestions`).loginAs(user)
    away.assertStatus(503)
    assert.deepEqual(away.body(), { error: 'unreachable' })
    // The end of an analysis with no engine: the analysis is done all the same
    const running = await setup('CLIPPING')
    await jobStatusBus.handle({ job_id: running.job.id, status: 'DONE' })
    await suggestCompilations(running.job.id).catch(() => {})
    assert.equal((await Job.findOrFail(running.job.id)).status, 'DONE')
    assert.isNull((await Job.findOrFail(running.job.id)).compilations)

    engine(true)
    const busy = await setup('ANALYZING_CLIPS')
    ;(await client.post(`/api/jobs/${busy.job.id}/suggestions`).loginAs(busy.user)).assertStatus(409)
    ;(await client.post(`/api/jobs/${job.id}/suggestions`).loginAs(busy.user)).assertStatus(404)
    ;(await client.get(`/api/jobs/${job.id}/suggestions`).loginAs(busy.user)).assertStatus(404)
    assert.lengthOf(asked, 0)
  })
})
