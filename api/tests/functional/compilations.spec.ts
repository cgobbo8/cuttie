import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Job from '#models/job'
import { clipDir } from '#services/data_paths'

test.group('Compilations', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const cleanup: string[] = []
  group.teardown(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  async function setup() {
    const user = await User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
    const job = await Job.create({
      id: randomUUID(),
      url: 'https://twitch.tv/videos/123',
      status: 'DONE',
      userId: user.id,
      vodDurationSeconds: 3600,
      hotPoints: [{ clip_filename: 'a.mp4', clip_start: 100, clip_end: 160 }],
    })
    const dir = clipDir(job.id)
    cleanup.push(dir)
    mkdirSync(path.join(dir, 'thumbs'), { recursive: true })
    return { user, job, dir }
  }

  /** A piece's clip on disk, covering `start`-`end` of the live */
  function piece(dir: string, id: string, start: number, end: number, settled = true) {
    writeFileSync(path.join(dir, `piece_${id}.mp4`), '')
    // "settled": cut since clips are made to start on their first picture
    writeFileSync(path.join(dir, `piece_${id}_meta.json`), JSON.stringify({ vod_start: start, vod_end: end, ...(settled ? { settled: true } : {}) }))
    writeFileSync(path.join(dir, `piece_${id}_words.json`), '[]')
  }

  const item = (id: string, start: number, end: number, more: Record<string, unknown> = {}) => ({ id, start, end, text: 'c’est calme', why: '', sources: ['voice'], ...more })

  test('starts empty, is created with a first section, and lists with its clips', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    const url = `/api/jobs/${job.id}/compilations`

    assert.deepEqual((await client.get(url).loginAs(user)).body(), { compilations: [] })

    const created = await client.post(url).loginAs(user).json({ name: 'Calme' })
    created.assertStatus(201)
    const compilation = (created.body() as any).compilation
    assert.match(compilation.id, /^[a-z0-9]{10}$/)
    assert.equal(compilation.name, 'Calme')
    assert.lengthOf(compilation.sections, 1)
    assert.deepEqual(compilation.sections[0].items, [])
    assert.isTrue(compilation.titles)

    // Its moments: one with its clip already cut, one still to cut
    piece(dir, 'aaaaaaaaaa', 92, 110)
    const saved = await client
      .put(`${url}/${compilation.id}`)
      .loginAs(user)
      .json({
        ...compilation,
        target: 90,
        sections: [{ id: compilation.sections[0].id, title: 'C’est calme', query: 'calme', items: [item('aaaaaaaaaa', 100.004, 103), item('bbbbbbbbbb', 200, 203.5)] }],
      })
    saved.assertStatus(200)
    const [first, second] = (saved.body() as any).compilation.sections[0].items
    assert.deepInclude(first, { id: 'aaaaaaaaaa', start: 100, end: 103, ready: true, file: 'piece_aaaaaaaaaa.mp4', file_start: 92, file_end: 110 })
    assert.deepInclude(second, { id: 'bbbbbbbbbb', ready: false, file: 'piece_bbbbbbbbbb.mp4', file_start: null })
    assert.equal((saved.body() as any).compilation.target, 90)

    // Stored without the clips' state, shown with it
    await job.refresh()
    assert.notProperty(job.compilations![0].sections[0].items[0], 'ready')
    const listed = (await client.get(url).loginAs(user)).body() as any
    assert.isTrue(listed.compilations[0].sections[0].items[0].ready)
  })

  test('keeps only what makes sense', async ({ client, assert }) => {
    const { user, job } = await setup()
    const url = `/api/jobs/${job.id}/compilations`
    const { compilation } = (await client.post(url).loginAs(user).json({})).body() as any
    assert.equal(compilation.name, 'Compilation')

    const saved = await client
      .put(`${url}/${compilation.id}`)
      .loginAs(user)
      .json({
        name: '  ' + 'x'.repeat(200),
        template: 'signature',
        titles: false,
        hook: 'Le calme avant la tempête',
        target: 100000,
        brief: '  d’abord le calme, puis ça pète ',
        asks: [{ ask: 'ajoute les autres calme', note: 'Trois ajoutés.', added: 3, removed: 0 }, { ask: '  ' }, 'nonsense', { ask: 'retire le dernier', removed: 'x' }],
        sections: [
          {
            id: 'sectionone',
            title: 'Un',
            query: 'calme',
            items: [
              item('goodoneabc', 10, 13, { sources: ['voice', 'hack'], text: 'y'.repeat(900), template: 'plein', fit: [10.354, 12.5], score: 0.876 }),
              item('goodoneabc', 20, 23), // same id twice
              item('../../etc', 30, 33),
              item('tooshortab', 40, 40.1),
              item('toolongabc', 50, 900),
              item('pastendabc', 5000, 5003),
              item('overendabc', 3598, 3605, { template: '../../etc', fit: [3600, 3598], score: 7 }),
            ],
          },
          { id: 'sectionone', title: 'Same id', items: [] },
          { id: 'nolist1234', title: 'No items' },
          { id: 'sectiontwo', title: 'Deux', items: [] },
        ],
      })
    saved.assertStatus(200)
    const stored = (saved.body() as any).compilation
    assert.lengthOf(stored.name, 80)
    assert.deepInclude(stored, { template: 'signature', titles: false, hook: 'Le calme avant la tempête', target: null })
    assert.deepEqual(stored.sections.map((s: any) => s.id), ['sectionone', 'sectiontwo'])
    // What was described to the AI and each change asked since stay with the video (the next change starts from them)
    assert.equal(stored.brief, 'd’abord le calme, puis ça pète')
    assert.deepEqual(stored.asks, [{ ask: 'ajoute les autres calme', note: 'Trois ajoutés.', added: 3 }, { ask: 'retire le dernier', note: '' }])
    const items = stored.sections[0].items
    assert.deepEqual(items.map((i: any) => i.id), ['goodoneabc', 'overendabc'])
    assert.deepEqual(items[0].sources, ['voice'])
    assert.lengthOf(items[0].text, 300)
    // A passage may be shown in its own template; a key that isn't one is dropped (the video's template then)
    assert.equal(items[0].template, 'plein')
    assert.notProperty(items[1], 'template')
    // The lines it is made of (still to be set on their words) and the AI's score stay with it; nonsense is dropped
    assert.deepEqual(items[0].fit, [10.35, 12.5])
    assert.equal(items[0].score, 0.88)
    assert.notProperty(items[1], 'fit')
    assert.notProperty(items[1], 'score')
    // The live ends at 3600 s
    assert.equal(items[1].end, 3600)

    ;(await client.put(`${url}/${compilation.id}`).loginAs(user).json({ name: 'x' })).assertStatus(400)
    ;(await client.put(`${url}/nope`).loginAs(user).json({ sections: [] })).assertStatus(404)
  })

  test('keeps the transitions between passages, and forgets them when they go', async ({ client, assert }) => {
    const { user, job } = await setup()
    const url = `/api/jobs/${job.id}/compilations`
    const { compilation } = (await client.post(url).loginAs(user).json({ name: 'Calme' })).body() as any
    const transitionsOf = (body: any) => [body.compilation.transition ?? null, ...body.compilation.sections[0].items.map((i: any) => i.transition ?? null)]
    const sections = (items: unknown[]) => [{ id: compilation.sections[0].id, title: '', query: '', items }]

    const saved = await client
      .put(`${url}/${compilation.id}`)
      .loginAs(user)
      .json({
        ...compilation,
        transition: 'zoom',
        // One comes in its own way, one with a plain cut, one with a transition nobody knows
        sections: sections([item('aaaaaaaaaa', 100, 104), item('bbbbbbbbbb', 200, 204, { transition: 'flash' }), item('cccccccccc', 300, 304, { transition: 'cut' }), item('dddddddddd', 400, 404, { transition: 'wobble' })]),
      })
    saved.assertStatus(200)
    assert.deepEqual(transitionsOf(saved.body()), ['zoom', null, 'flash', 'cut', null])

    // Back to plain cuts: the video's transition is gone, not kept from the save before
    const plain = await client
      .put(`${url}/${compilation.id}`)
      .loginAs(user)
      .json({ ...compilation, sections: sections([item('aaaaaaaaaa', 100, 104), item('bbbbbbbbbb', 200, 204)]) })
    assert.deepEqual(transitionsOf(plain.body()), [null, null, null])
    ;(await client.put(`${url}/${compilation.id}`).loginAs(user).json({ ...compilation, transition: 'cut', sections: sections([]) })).assertStatus(200)
    const listed = (await client.get(url).loginAs(user)).body() as any
    assert.notProperty(listed.compilations[0], 'transition')
  })

  test('deleting a compilation deletes its clips, taking a moment out deletes its clip later', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    const url = `/api/jobs/${job.id}/compilations`
    const { compilation } = (await client.post(url).loginAs(user).json({ name: 'Calme' })).body() as any
    const section = compilation.sections[0]
    for (const id of ['keepitkeep', 'takenoutab', 'previewold', 'previewnew']) piece(dir, id, 0, 20)
    writeFileSync(path.join(dir, 'thumbs', 'piece_takenoutab_480_15.jpg'), '')
    writeFileSync(path.join(dir, 'a.mp4'), '')
    const hourAgo = new Date(Date.now() - 2 * 3600_000)
    for (const id of ['takenoutab', 'previewold']) utimesSync(path.join(dir, `piece_${id}.mp4`), hourAgo, hourAgo)

    const body = (items: unknown[]) => ({ ...compilation, sections: [{ ...section, items }] })
    await client.put(`${url}/${compilation.id}`).loginAs(user).json(body([item('keepitkeep', 5, 8), item('takenoutab', 9, 12)]))
    assert.isTrue(existsSync(path.join(dir, 'piece_takenoutab.mp4')))

    // One moment taken out: its clip (cut 2 h ago) goes with its sidecars and frames; a preview just cut stays
    await client.put(`${url}/${compilation.id}`).loginAs(user).json(body([item('keepitkeep', 5, 8)]))
    assert.isFalse(existsSync(path.join(dir, 'piece_takenoutab.mp4')))
    assert.isFalse(existsSync(path.join(dir, 'piece_takenoutab_meta.json')))
    assert.isFalse(existsSync(path.join(dir, 'thumbs', 'piece_takenoutab_480_15.jpg')))
    assert.isFalse(existsSync(path.join(dir, 'piece_previewold.mp4')))
    assert.isTrue(existsSync(path.join(dir, 'piece_previewnew.mp4')))
    assert.isTrue(existsSync(path.join(dir, 'piece_keepitkeep.mp4')))

    ;(await client.delete(`${url}/${compilation.id}`).loginAs(user)).assertStatus(200)
    assert.isFalse(existsSync(path.join(dir, 'piece_keepitkeep.mp4')))
    assert.isFalse(existsSync(path.join(dir, 'piece_keepitkeep_words.json')))
    // The analysis' clips are not a compilation's
    assert.isTrue(existsSync(path.join(dir, 'a.mp4')))
    assert.deepEqual((await client.get(url).loginAs(user)).body(), { compilations: [] })
    ;(await client.delete(`${url}/${compilation.id}`).loginAs(user)).assertStatus(404)
  })

  test('lists every live with its compilations, says which are exported, and duplicates one with clips of its own', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    const url = `/api/jobs/${job.id}/compilations`
    piece(dir, 'aaaaaaaaaa', 99, 105)
    const made = (await client.post(url).loginAs(user).json({ name: 'Calme', brief: 'les moments calmes', sections: [{ id: 'sssssssss1', title: 'Un', items: [item('aaaaaaaaaa', 100, 103), item('bbbbbbbbbb', 200, 204)] }] })).body() as any
    const id = made.compilation.id

    // A live with no compilation is listed too (one can be started from it); somebody else's is not
    const other = await User.create({ fullName: 'Autre', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    assert.deepEqual((await client.get('/api/compilations').loginAs(other)).body(), { lives: [] })
    let lives = ((await client.get('/api/compilations').loginAs(user)).body() as any).lives
    assert.lengthOf(lives, 1)
    assert.equal(lives[0].job_id, job.id)
    assert.equal(lives[0].vod_id, '123')
    assert.deepInclude(lives[0].compilations[0], { id, name: 'Calme', length: 7, passages: 2, parts: 1, described: true, cover: 'piece_aaaaaaaaaa.mp4', exported_at: null, render_id: null })

    // Exported: its last finished export
    const now = new Date().toISOString()
    await db.table('renders').insert({ id: 'r1', job_id: job.id, clip_filename: `comp_${id}.mp4`, status: 'done', progress: 100, created_at: now, updated_at: now })
    lives = ((await client.get(`/api/compilations?job_id=${job.id}`).loginAs(user)).body() as any).lives
    assert.deepInclude(lives[0].compilations[0], { exported_at: now, render_id: 'r1' })

    // A copy: other ids all the way down, the clips that exist copied with their sidecars
    const copied = await client.post(`${url}/${id}/duplicate`).loginAs(user).json({ name: 'Calme (copie)' })
    copied.assertStatus(201)
    const copy = (copied.body() as any).compilation
    assert.notEqual(copy.id, id)
    assert.equal(copy.name, 'Calme (copie)')
    assert.equal(copy.brief, 'les moments calmes')
    const [first, second] = copy.sections[0].items
    assert.notEqual(copy.sections[0].id, 'sssssssss1')
    assert.notInclude(['aaaaaaaaaa', 'bbbbbbbbbb'], first.id)
    assert.deepInclude(first, { start: 100, end: 103, ready: true, file: `piece_${first.id}.mp4` })
    assert.isTrue(existsSync(path.join(dir, `piece_${first.id}_words.json`)))
    assert.isFalse(second.ready)
    // Deleting the copy leaves the original's clips alone
    await client.delete(`${url}/${copy.id}`).loginAs(user)
    assert.isTrue(existsSync(path.join(dir, 'piece_aaaaaaaaaa.mp4')))
    assert.isFalse(existsSync(path.join(dir, `piece_${first.id}.mp4`)))
    ;(await client.post(`${url}/nope/duplicate`).loginAs(user)).assertStatus(404)
  })

  test('a compilation takes passages from several lives of the same streamer', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    // Another live of theirs, and one of somebody else
    const second = await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/456', status: 'DONE', userId: user.id, vodDurationSeconds: 1800 })
    const theirs = clipDir(second.id)
    cleanup.push(theirs)
    mkdirSync(theirs, { recursive: true })
    const stranger = await User.create({ fullName: 'Autre', email: `x-${randomUUID()}@cuttie.app`, password: 'password123' })
    const foreign = await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/789', status: 'DONE', userId: stranger.id, vodDurationSeconds: 1800 })
    const url = `/api/jobs/${job.id}/compilations`
    piece(dir, 'ownownowna', 99, 105)
    piece(theirs, 'theirstheb', 40, 50)
    piece(theirs, 'theirsoldc', 60, 70)

    const sections = [
      {
        id: 'sssssssss1',
        title: 'Un',
        items: [
          item('ownownowna', 100, 103),
          // In the second live: its own times (up to its own length), its own clip
          item('theirstheb', 42, 45, { job: second.id }),
          item('theirsoldc', 1790, 1900, { job: second.id }),
          // A live that isn't one of the compilation's, or isn't theirs: dropped
          item('foreignabc', 10, 13, { job: foreign.id }),
          item('nolivelist', 10, 13, { job: randomUUID() }),
        ],
      },
    ]
    const made = await client.post(url).loginAs(user).json({ name: 'Deux lives', lives: [second.id, foreign.id, job.id, 'nonsense'], sections })
    made.assertStatus(201)
    const compilation = (made.body() as any).compilation
    assert.deepEqual(compilation.lives, [second.id])
    const items = compilation.sections[0].items
    assert.deepEqual(items.map((i: any) => [i.id, i.job ?? null, i.end]), [['ownownowna', null, 103], ['theirstheb', second.id, 45], ['theirsoldc', second.id, 1800]])
    assert.deepEqual(items.map((i: any) => i.ready), [true, true, false])

    // The library says which lives it is made from
    const lives = ((await client.get('/api/compilations').loginAs(user)).body() as any).lives
    const card = lives.find((l: any) => l.job_id === job.id).compilations[0]
    assert.deepEqual(card.lives, [job.id, second.id])
    assert.deepInclude(card, { cover: 'piece_ownownowna.mp4', cover_job: job.id })
    assert.deepEqual(lives.find((l: any) => l.job_id === second.id).compilations, [])

    // The second live's own compilations being saved leave alone the clips this one cut there
    const hourAgo = new Date(Date.now() - 2 * 3600_000)
    for (const id of ['theirstheb', 'theirsoldc']) utimesSync(path.join(theirs, `piece_${id}.mp4`), hourAgo, hourAgo)
    const other = (await client.post(`/api/jobs/${second.id}/compilations`).loginAs(user).json({ name: 'La sienne' })).body() as any
    await client.put(`/api/jobs/${second.id}/compilations/${other.compilation.id}`).loginAs(user).json(other.compilation)
    assert.isTrue(existsSync(path.join(theirs, 'piece_theirstheb.mp4')))

    // A passage of the second live taken out: its clip goes, in that live's folder
    const kept = { ...compilation, sections: [{ ...compilation.sections[0], items: items.slice(0, 2) }] }
    await client.put(`${url}/${compilation.id}`).loginAs(user).json(kept)
    assert.isFalse(existsSync(path.join(theirs, 'piece_theirsoldc.mp4')))
    assert.isTrue(existsSync(path.join(theirs, 'piece_theirstheb.mp4')))

    // A copy has clips of its own in each live
    const copy = ((await client.post(`${url}/${compilation.id}/duplicate`).loginAs(user)).body() as any).compilation
    const [mine, far] = copy.sections[0].items
    assert.deepEqual([far.job, far.ready, copy.lives], [second.id, true, [second.id]])
    assert.isTrue(existsSync(path.join(dir, `piece_${mine.id}.mp4`)))
    assert.isTrue(existsSync(path.join(theirs, `piece_${far.id}.mp4`)))
    await client.delete(`${url}/${copy.id}`).loginAs(user)
    assert.isFalse(existsSync(path.join(theirs, `piece_${far.id}.mp4`)))

    // An export may play pieces of both lives, never of somebody else's
    const layers = [{ layer: { id: 'l', name: 'Jeu', type: 'gameplay', visible: true, locked: false, transform: { x: 0, y: 0, width: 1080, height: 1920 }, style: { opacity: 1, blur: 0, borderRadius: 0, fadeIn: 0, fadeOut: 0 } }, z: 0 }]
    const strangers = await client.post(`/api/jobs/${job.id}/montage-render`).loginAs(user).json({ key: `comp_${compilation.id}.mp4`, pieces: [{ clip: 'piece_x.mp4', job: foreign.id, from: 0, duration: 2, layers }], overlays: [] })
    strangers.assertStatus(404)
    assert.deepEqual(strangers.body(), { error: 'job not found' })
    const absent = await client.post(`/api/jobs/${job.id}/montage-render`).loginAs(user).json({ key: `comp_${compilation.id}.mp4`, pieces: [{ clip: 'piece_absentabc.mp4', job: second.id, from: 0, duration: 2, layers }], overlays: [] })
    absent.assertStatus(404)
    assert.deepEqual(absent.body(), { error: 'clip not found', clip: 'piece_absentabc.mp4' })

    // The second live's project deleted: the compilation loses what it took from it
    ;(await client.delete(`/api/jobs/${second.id}`).loginAs(user)).assertStatus(200)
    const after = ((await client.get(url).loginAs(user)).body() as any).compilations[0]
    assert.isUndefined(after.lives)
    assert.deepEqual(after.sections[0].items.map((i: any) => i.id), ['ownownowna'])
  })

  test('clips already there need no worker; the others say the engine is away', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    piece(dir, 'readypiece', 92, 110)

    const ready = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'readypiece', start: 100, end: 103 }] })
    ready.assertStatus(200)
    assert.deepEqual(ready.body(), {
      pieces: [{ id: 'readypiece', ready: true, file: 'piece_readypiece.mp4', file_start: 92, file_end: 110 }],
      failed: [],
    })

    // Moved past its clip: it has to be cut again, and no worker answers in tests
    const moved = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'readypiece', start: 80, end: 103 }] })
    moved.assertStatus(503)
    assert.deepEqual(moved.body(), { error: 'unreachable' })

    // Its words are to be found in the clip (a moment still on the transcript's rough times): the engine's work, even on a clip that is there
    const fit = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'readypiece', start: 100, end: 103, fit: [100.4, 102.6] }] })
    fit.assertStatus(503)
    // ...but a fit that makes no sense is not one
    const nonsense = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'readypiece', start: 100, end: 103, fit: [103, 100] }] })
    nonsense.assertStatus(200)
    assert.notProperty((nonsense.body() as any).pieces[0], 'tight')

    // A clip cut before clips were made to start on their first picture (its picture could freeze, its words came early): cut again
    piece(dir, 'oldpiece12', 92, 110, false)
    const old = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'oldpiece12', start: 100, end: 103 }] })
    old.assertStatus(503)

    ;(await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: '../x', start: 0, end: 5 }] })).assertStatus(400)
    ;(await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({})).assertStatus(400)
  })

  test('searching and planning need the engine, and something to look for', async ({ client, assert }) => {
    const { user, job } = await setup()
    ;(await client.post(`/api/jobs/${job.id}/search`).loginAs(user).json({ query: '  ' })).assertStatus(400)
    ;(await client.post(`/api/jobs/${job.id}/plan`).loginAs(user).json({})).assertStatus(400)
    const search = await client.post(`/api/jobs/${job.id}/search`).loginAs(user).json({ query: 'calme' })
    search.assertStatus(503)
    assert.deepEqual(search.body(), { error: 'unreachable' })
    ;(await client.post(`/api/jobs/${job.id}/plan`).loginAs(user).json({ brief: 'les moments calmes', target: 90 })).assertStatus(503)
    // A change asked on a planned video goes to the engine too
    const change = { brief: 'les moments calmes', request: 'ajoute les autres', current: [{ title: 'Calme', items: [{ start: 10, end: 12 }, { start: 'x' }] }], asks: ['un titre', 3] }
    ;(await client.post(`/api/jobs/${job.id}/plan`).loginAs(user).json(change)).assertStatus(503)
    ;(await client.get(`/api/jobs/${job.id}/search/info`).loginAs(user)).assertStatus(503)
    // What the AI is doing is only for show: no engine, nothing being searched
    const progress = await client.get(`/api/jobs/${job.id}/search/progress`).loginAs(user)
    progress.assertStatus(200)
    assert.deepEqual(progress.body(), { doing: null })
    ;(await client.post(`/api/clips/${job.id}/a.mp4/suggest-cut`).loginAs(user).json({})).assertStatus(503)
    ;(await client.post(`/api/clips/${job.id}/b.mp4/suggest-cut`).loginAs(user).json({})).assertStatus(404)
  })

  test("an export of a compilation shows its first moment, and a clip's words are read as they are", async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    const { compilation } = (await client.post(`/api/jobs/${job.id}/compilations`).loginAs(user).json({})).body() as any
    await client
      .put(`/api/jobs/${job.id}/compilations/${compilation.id}`)
      .loginAs(user)
      .json({ ...compilation, sections: [{ ...compilation.sections[0], items: [item('firstpiece', 5, 8)] }] })
    // The frame of the first moment was made before: it stands for the export while it renders
    writeFileSync(path.join(dir, 'thumbs', 'piece_firstpiece_480_15.jpg'), 'jpg')
    const thumb = await client.get(`/api/clips/${job.id}/comp_${compilation.id}.mp4/thumb`).loginAs(user)
    thumb.assertStatus(200)
    ;(await client.get(`/api/clips/${job.id}/comp_unknownid0.mp4/thumb`).loginAs(user)).assertStatus(404)

    writeFileSync(path.join(dir, 'a_words.json'), JSON.stringify([{ word: 'calme', start: 1, end: 1.4 }]))
    assert.deepEqual((await client.get(`/api/clips/${job.id}/a.mp4/words`).loginAs(user)).body(), { words: [{ word: 'calme', start: 1, end: 1.4 }] })
    // A clip that has no words yet is transcribed by the engine when they are asked for; no engine here: none, and no error
    writeFileSync(path.join(dir, 'nowords.mp4'), '')
    const none = await client.get(`/api/clips/${job.id}/nowords.mp4/words`).loginAs(user)
    none.assertStatus(200)
    assert.deepEqual(none.body(), { words: [] })
    assert.deepEqual((await client.get(`/api/clips/${job.id}/zzz.mp4/words`).loginAs(user)).body(), { words: [] })
  })

  test('the AI chooses the template of the passages whose clip is cut', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    const url = `/api/jobs/${job.id}/looks`
    const templates = [{ key: 'empile', name: 'Empilé', description: 'Webcam: above the game.', needs_cam: true }]
    // Passages and templates are needed, and a template is a key with what it shows
    ;(await client.post(url).loginAs(user).json({})).assertStatus(400)
    ;(await client.post(url).loginAs(user).json({ items: [item('aaaaaaaaaa', 100, 103)], templates: [{ key: '../etc', description: 'x' }, { key: 'empile' }] })).assertStatus(400)
    ;(await client.post(url).loginAs(user).json({ items: [item('../../etc', 100, 103), item('aaaaaaaaaa', 103, 100)], templates })).assertStatus(400)
    // Nothing to look at before the clips are cut
    const early = await client.post(url).loginAs(user).json({ items: [item('aaaaaaaaaa', 100, 103)], templates })
    early.assertStatus(409)
    assert.deepEqual(early.body(), { error: 'not_cut' })
    // Cut: the engine is asked (none answers in tests)
    piece(dir, 'aaaaaaaaaa', 92, 110)
    const asked = await client.post(url).loginAs(user).json({ items: [item('aaaaaaaaaa', 100, 103), item('bbbbbbbbbb', 200, 203)], templates, wish: 'ma cam en haut', language: 'fr' })
    asked.assertStatus(503)
    assert.deepEqual(asked.body(), { error: 'unreachable' })
  })

  test("can't touch someone else's live", async ({ client }) => {
    const { job } = await setup()
    const other = await User.create({ fullName: 'Other', email: `o-${randomUUID()}@cuttie.app`, password: 'password123' })
    ;(await client.get(`/api/jobs/${job.id}/compilations`).loginAs(other)).assertStatus(404)
    ;(await client.post(`/api/jobs/${job.id}/compilations`).loginAs(other).json({})).assertStatus(404)
    ;(await client.post(`/api/jobs/${job.id}/search`).loginAs(other).json({ query: 'calme' })).assertStatus(404)
    ;(await client.get(`/api/jobs/${job.id}/search/progress`).loginAs(other)).assertStatus(404)
    ;(await client.post(`/api/jobs/${job.id}/looks`).loginAs(other).json({ items: [], templates: [] })).assertStatus(404)
    ;(await client.post(`/api/jobs/${job.id}/pieces`).loginAs(other).json({ pieces: [] })).assertStatus(404)
    ;(await client.get(`/api/clips/${job.id}/a.mp4/words`).loginAs(other)).assertStatus(404)
    ;(await client.post(`/api/jobs/${job.id}/montage-render`).loginAs(other).json({ pieces: [] })).assertStatus(404)
  })

  test('a montage render needs pieces that exist', async ({ client, assert }) => {
    const { user, job, dir } = await setup()
    const url = `/api/jobs/${job.id}/montage-render`
    const layer = { id: 'l', name: 'Jeu', type: 'gameplay', visible: true, locked: false, transform: { x: 0, y: 0, width: 1080, height: 1920 }, style: { opacity: 1, blur: 0, borderRadius: 0, fadeIn: 0, fadeOut: 0 } }
    const pieces = [{ clip: 'a.mp4', from: 2, duration: 3, layers: [{ layer, z: 0 }] }]

    ;(await client.post(url).loginAs(user).json({ pieces: [] })).assertStatus(400)
    ;(await client.post(url).loginAs(user).json({ pieces: [{ clip: 'a.mp4', from: -1, duration: 3, layers: [] }] })).assertStatus(400)
    ;(await client.post(url).loginAs(user).json({ pieces: [{ clip: 'a.mp4', from: 0, duration: 3, layers: [{ layer: { id: 'x' }, z: 0 }] }] })).assertStatus(400)
    // A transition the renderer does not know: refused, not played as a plain cut without a word
    ;(await client.post(url).loginAs(user).json({ pieces: [{ ...pieces[0], transition: 'wobble' }], overlays: [] })).assertStatus(400)
    const missing = await client.post(url).loginAs(user).json({ pieces: [{ ...pieces[0], transition: 'slide' }], overlays: [] })
    missing.assertStatus(404)
    assert.deepEqual(missing.body(), { error: 'clip not found', clip: 'a.mp4' })

    // With its clip there, the export is queued under what it stands for
    writeFileSync(path.join(dir, 'a.mp4'), '')
    const queued = await client.post(url).loginAs(user).json({ key: 'comp_abcdef1234.mp4', name: 'Ma compilation', pieces, overlays: [] })
    queued.assertStatus(201)
    const shown = await client.get(`/api/renders/${(queued.body() as any).render_id}`).loginAs(user)
    assert.deepInclude(shown.body(), { clip_filename: 'comp_abcdef1234.mp4', clip_name: 'Ma compilation', job_id: job.id })
  })
})
