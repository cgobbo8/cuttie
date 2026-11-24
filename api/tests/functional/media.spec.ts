import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { clipDir, DATA_DIR } from '#services/data_paths'
import { MAX_MEDIA_SECONDS, frameRate, keepArgs, keepMediaWords, mediaAsPiece, mediaItems, mediaName, saveMediaItems } from '#services/media_library'
import { movedTo, piecesToRestore, type Compilation } from '#services/compilations'
import { chatInClip } from '#services/edit_env_resolver'
import { assistantTool } from '#services/assistant'

const DIR = path.join(DATA_DIR, 'media')

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** A real little video made by ffmpeg: a test pattern, with a tone unless `silent` */
function video(file: string, { seconds = 2, size = '640x360', rate = 30, silent = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true })
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${rate}:duration=${seconds}`,
    ...(silent ? [] : ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`]),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    ...(silent ? [] : ['-c:a', 'aac', '-shortest']),
    file,
  ])
}

test.group('The media library', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => rmSync(DIR, { recursive: true, force: true }))
  const cleanup: string[] = [DIR, path.join(DATA_DIR, 'media-sent')]
  group.teardown(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  const makeUser = () => User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
  async function live(user: User) {
    const job = await Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/123', status: 'DONE', userId: user.id, vodDurationSeconds: 3600, hotPoints: [] })
    cleanup.push(clipDir(job.id))
    mkdirSync(clipDir(job.id), { recursive: true })
    return job
  }
  const sent = (name: string) => path.join(DATA_DIR, 'media-sent', name)

  test('reads a rate, names a video from its file, and gives a silent video a sound track', ({ assert }) => {
    assert.deepEqual([frameRate('30/1'), frameRate('30000/1001'), frameRate('120/1'), frameRate('15/1'), frameRate('0/0'), frameRate(undefined)], [30, 29.97, 60, 24, 30, 30])
    assert.deepEqual([mediaName('outro_finale-2026.mov'), mediaName('IMG.4412.MP4'), mediaName('')], ['Outro finale 2026', 'IMG 4412', 'Vidéo'])
    const withSound = keepArgs('in.mov', 'out.mp4', { fps: 30, sound: true })
    assert.notInclude(withSound, 'anullsrc=r=48000:cl=stereo')
    assert.include(withSound.join(' '), '-map 0:v:0 -map 0:a:0')
    const silent = keepArgs('in.mov', 'out.mp4', { fps: 60, sound: false })
    assert.include(silent.join(' '), '-map 0:v:0 -map 1:a:0')
    assert.include(silent, '-shortest')
    // Never bigger than 1920 on its long side, at a constant rate
    assert.include(silent.join(' '), "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=60")
  })

  test('a video is imported, brought to what the montage plays, listed, renamed, played and removed', async ({ client, assert }) => {
    if (!hasFfmpeg()) return
    const user = await makeUser()
    // A phone's video: upright, bigger than needed, no sound
    video(sent('mon_outro.mov'), { seconds: 2, size: '1080x2400', rate: 25, silent: true })
    const added = await client.post('/api/media').loginAs(user).file('file', sent('mon_outro.mov'))
    added.assertStatus(201)
    const media = (added.body() as any).media
    assert.match(media.id, /^m[a-f0-9]{8}$/)
    assert.equal(media.name, 'Mon outro')
    assert.closeTo(media.seconds, 2, 0.15)
    // Shrunk to 1920 on its long side, still upright
    assert.deepEqual([media.width, media.height], [864, 1920])
    // (nobody could listen: the engine is not running in the tests)
    assert.isNull(media.spoken)
    // Its file, with a sound track, and its picture: nothing else left behind
    assert.deepEqual(readdirSync(DIR).sort(), ['library.json', `${media.id}.jpg`, `${media.id}.mp4`])
    const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', path.join(DIR, `${media.id}.mp4`)]).toString()).streams
    assert.deepEqual(streams.map((s: any) => s.codec_name).sort(), ['aac', 'h264'])

    const listed = (await client.get('/api/media').loginAs(user)).body() as any
    assert.deepEqual(listed.media.map((m: any) => m.id), [media.id])
    assert.equal(listed.longest, MAX_MEDIA_SECONDS)

    const renamed = await client.put(`/api/media/${media.id}`).loginAs(user).json({ name: '  Outro de fin  ' })
    assert.equal((renamed.body() as any).media.name, 'Outro de fin')
    ;(await client.put(`/api/media/${media.id}`).loginAs(user).json({ name: ' ' })).assertStatus(400)
    ;(await client.put('/api/media/m00000000').loginAs(user).json({ name: 'x' })).assertStatus(404)

    // Played from anywhere in it, and shown by its picture
    const part = await client.get(`/api/media/${media.id}/file`).loginAs(user).header('range', 'bytes=0-99')
    part.assertStatus(206)
    assert.equal(part.header('content-type'), 'video/mp4')
    ;(await client.get(`/api/media/${media.id}/thumb`).loginAs(user)).assertStatus(200)
    // Not without being signed in, and no path out of the folder
    ;(await client.get(`/api/media/${media.id}/file`)).assertStatus(401)
    ;(await client.get('/api/media/..%2Flibrary.json/file').loginAs(user)).assertStatus(404)

    ;(await client.delete(`/api/media/${media.id}`).loginAs(user)).assertStatus(200)
    assert.deepEqual(readdirSync(DIR), ['library.json'])
    ;(await client.delete(`/api/media/${media.id}`).loginAs(user)).assertStatus(404)
  })

  test('what is not a video, or lasts longer than a passage can, is refused and leaves nothing', async ({ client, assert }) => {
    if (!hasFfmpeg()) return
    const user = await makeUser()
    mkdirSync(path.dirname(sent('x')), { recursive: true })
    writeFileSync(sent('notes.mp4'), 'not a video at all')
    const refused = await client.post('/api/media').loginAs(user).file('file', sent('notes.mp4'))
    refused.assertStatus(422)
    assert.equal((refused.body() as any).error, 'not_video')
    writeFileSync(sent('notes.pdf'), '%PDF')
    ;(await client.post('/api/media').loginAs(user).file('file', sent('notes.pdf'))).assertStatus(422)
    ;(await client.post('/api/media').loginAs(user)).assertStatus(400)

    video(sent('long.mp4'), { seconds: MAX_MEDIA_SECONDS + 8, size: '160x90', rate: 5, silent: true })
    const long = await client.post('/api/media').loginAs(user).file('file', sent('long.mp4'))
    long.assertStatus(422)
    assert.deepInclude(long.body() as any, { error: 'too_long', seconds: MAX_MEDIA_SECONDS + 8, longest: MAX_MEDIA_SECONDS })
    assert.deepEqual(mediaItems(), [])
    assert.deepEqual(existsSync(DIR) ? readdirSync(DIR).filter((name) => name !== 'library.json') : [], [])
  })

  test('a passage made of a video of the library plays that video: nothing is cut from the live, no webcam, no chat', async ({ client, assert }) => {
    if (!hasFfmpeg()) return
    const user = await makeUser()
    const job = await live(user)
    video(sent('meme.mp4'), { seconds: 3, size: '640x360' })
    const media = ((await client.post('/api/media').loginAs(user).file('file', sent('meme.mp4'))).body() as any).media
    // Somebody listened to it since: two words
    keepMediaWords(media.id, [{ word: 'Bien', start: 0.4, end: 0.7 }, { word: 'joué', start: 0.7, end: 1.1 }])

    const url = `/api/jobs/${job.id}/compilations`
    const compilation = ((await client.post(url).loginAs(user).json({ name: 'Avec mon mème' })).body() as any).compilation
    const section = compilation.sections[0].id
    const saved = await client
      .put(`${url}/${compilation.id}`)
      .loginAs(user)
      .json({
        ...compilation,
        sections: [
          {
            id: section,
            title: '',
            query: '',
            items: [
              // Its times are the video's own: never past its end, whatever the live's length
              { id: 'mediapiece', start: 0.5, end: 9, text: '', why: 'Meme', sources: [], media: media.id },
              // One that starts after its end is not a passage; a media that never was is not one either
              { id: 'pastend123', start: 4, end: 6, text: '', why: '', sources: [], media: media.id },
              { id: 'nomedia123', start: 0, end: 2, text: '', why: '', sources: [], media: 'nope' },
            ],
          },
        ],
      })
    saved.assertStatus(200)
    const items = (saved.body() as any).compilation.sections[0].items
    assert.lengthOf(items, 1)
    assert.deepInclude(items[0], { id: 'mediapiece', media: media.id, start: 0.5, end: media.seconds, ready: false })

    // Its clip: the library's file under the piece's name (the engine, which is not running, is not asked)
    const cut = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'mediapiece', start: 0.5, end: media.seconds, media: media.id }] })
    cut.assertStatus(200)
    assert.deepEqual(cut.body(), { pieces: [{ id: 'mediapiece', ready: true, file: 'piece_mediapiece.mp4', file_start: 0, file_end: media.seconds }], failed: [] })
    const dir = clipDir(job.id)
    assert.equal(statSync(path.join(dir, 'piece_mediapiece.mp4')).size, statSync(path.join(DIR, `${media.id}.mp4`)).size)
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'piece_mediapiece_meta.json'), 'utf-8')), { vod_start: 0, vod_end: media.seconds, settled: true, media: media.id })
    assert.lengthOf(JSON.parse(readFileSync(path.join(dir, 'piece_mediapiece_words.json'), 'utf-8')), 2)

    // A passage cut out of it plays the same file; a video that left the library can't be put there
    const half = await client.post(`/api/jobs/${job.id}/pieces`).loginAs(user).json({ pieces: [{ id: 'secondhalf', start: 1.5, end: 2.5, like: 'mediapiece', media: media.id }, { id: 'gonemedia1', start: 0, end: 2, media: 'mffffffff' }] })
    half.assertStatus(200)
    assert.deepInclude((half.body() as any).pieces[0], { id: 'secondhalf', ready: true, file_start: 0 })
    assert.deepEqual((half.body() as any).failed, ['gonemedia1'])

    // The live's chat ran at those seconds of the live, not over this video; and the live's webcam is not in it
    writeFileSync(path.join(dir, 'chat.json'), JSON.stringify([{ author: 'viewer', text: 'salut', timestamp: 1 }]))
    assert.deepEqual(chatInClip(job.id, 'piece_mediapiece.mp4', [{ author: 'viewer', text: 'salut', timestamp: 1 }]), [])
    const env = await client.get(`/api/clips/${job.id}/piece_mediapiece.mp4/edit-env`).loginAs(user)
    env.assertStatus(200)
    assert.deepInclude(env.body() as any, { clip_width: 640, clip_height: 360, facecam: null, chat_messages: [] })
    assert.deepEqual((env.body() as any).cam, { rect: null, source: null, moved: false, visible: false })
    assert.deepEqual((env.body() as any).words.map((w: any) => w.word), ['Bien', 'joué'])

    // The AI's cut is asked of the engine for it as for a clip (not running here), never for a piece of the live
    ;(await client.post(`/api/clips/${job.id}/piece_mediapiece.mp4/suggest-cut`).loginAs(user).json({ current: [[0.5, 3]] })).assertStatus(503)
    writeFileSync(path.join(dir, 'piece_livepiece1.mp4'), '')
    writeFileSync(path.join(dir, 'piece_livepiece1_meta.json'), JSON.stringify({ vod_start: 100, vod_end: 110, settled: true }))
    ;(await client.post(`/api/clips/${job.id}/piece_livepiece1.mp4/suggest-cut`).loginAs(user).json({})).assertStatus(404)

    // Clips freed then taken back: this one is not cut from the live again (it comes back from the library)
    const kept = { sections: [{ items: [{ id: 'mediapiece' }, { id: 'livepiece1' }] }] } as unknown as Compilation
    assert.deepEqual(piecesToRestore(job.id, [kept]), [{ filename: 'piece_livepiece1.mp4', start: 100, end: 110 }])

    // The assistant is told of the library, and of this passage as what it is: no hour of a live, its name and how long it plays
    assert.deepEqual(await assistantTool(user.id, 'media', {}), { videos: [{ id: media.id, name: 'Meme', seconds: media.seconds, upright: false, spoken: true }] })
    const told = (await assistantTool(user.id, 'video', { job: job.id, id: compilation.id })) as any
    assert.deepEqual(told.parts[0].passages, [{ id: 'mediapiece', imported: 'Meme', seconds: Math.round((media.seconds - 0.5) * 10) / 10, text: '' }])

    // Removed from the library: the passage keeps its file
    ;(await client.delete(`/api/media/${media.id}`).loginAs(user)).assertStatus(200)
    assert.isTrue(existsSync(path.join(dir, 'piece_mediapiece.mp4')))
    assert.isFalse(mediaAsPiece(job.id, media.id, 'anotherone'))
  })

  test('a video handed to another of its lives takes its imported videos along', ({ assert }) => {
    saveMediaItems([])
    const other = randomUUID()
    const item = (id: string, more: Record<string, unknown> = {}) => ({ id, start: 0, end: 2, text: '', why: '', sources: [], ...more })
    const c = { id: 'abcdefghij', name: 'x', lives: [other], sections: [{ id: 's1', title: '', query: '', items: [item('own1234567'), item('media12345', { media: 'm0000000a' }), item('theirs1234', { job: other })] }] } as unknown as Compilation
    const moved = movedTo(c, other)!
    assert.deepEqual(moved.sections[0].items.map((i) => [i.id, i.job, i.media]), [['media12345', undefined, 'm0000000a'], ['theirs1234', undefined, undefined]])
    // Nothing but imported videos would be left: it goes with the project
    const alone = { ...c, sections: [{ id: 's1', title: '', query: '', items: [item('own1234567'), item('media12345', { media: 'm0000000a' })] }] } as unknown as Compilation
    assert.isNull(movedTo(alone, other))
  })
})
