import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import User from '#models/user'
import Job from '#models/job'
import { WATCH_SECONDS, watchArgs, watchStream } from '#services/live_watch'

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Everything a stream gives until it ends */
function whole(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    stream.on('data', (part: Buffer) => parts.push(part))
    stream.on('end', () => resolve(Buffer.concat(parts)))
    stream.on('error', reject)
  })
}

test.group('A live watched to pick a passage by hand', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  const dir = mkdtempSync(path.join(tmpdir(), 'cuttie-watch-'))
  group.teardown(() => rmSync(dir, { recursive: true, force: true }))

  const makeUser = () => User.create({ fullName: 'Streamer', email: `s-${randomUUID()}@cuttie.app`, password: 'password123' })
  const live = (user: User) => Job.create({ id: randomUUID(), url: 'https://twitch.tv/videos/123', status: 'DONE', userId: user.id, vodDurationSeconds: 3600, hotPoints: [] })

  test('ffmpeg goes to the time before opening the live, hands pictures and sound on as they are, in pieces a player takes as they come', ({ assert }) => {
    const args = watchArgs('https://example.test/live.m3u8', 12000.25)
    const said = args.join(' ')
    // (asked before the input: it goes straight to the segment that holds that time)
    assert.isBelow(args.indexOf('-ss'), args.indexOf('-i'))
    assert.include(said, '-ss 12000.25 -i https://example.test/live.m3u8')
    assert.include(said, `-t ${WATCH_SECONDS}`)
    assert.include(said, '-c copy')
    assert.include(said, '-map 0:v:0 -map 0:a:0?')
    assert.include(said, 'frag_keyframe+empty_moov')
    // (the header waits for the first sound: a player fed piece by piece refuses one that does not say how it is coded)
    assert.include(said, 'delay_moov')
    assert.deepEqual(args.slice(-3), ['-f', 'mp4', 'pipe:1'])
    assert.include(watchArgs('x', -4).join(' '), '-ss 0 -i x')
  })

  test('a stream is a video that plays from its first picture, and going elsewhere stops the one before', async ({ assert }) => {
    if (!hasFfmpeg()) return
    const source = path.join(dir, 'live.mp4')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source])

    const first = watchStream(7, source, 0)
    const second = watchStream(7, source, 2)
    // (the first was asked for by a player that has gone elsewhere: it ends at once, cut short)
    const [cut, kept] = await Promise.all([whole(first.stream), whole(second.stream)])
    assert.isBelow(cut.length, kept.length)

    const out = path.join(dir, 'watched.mp4')
    writeFileSync(out, kept)
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out]).toString())
    const kinds = probe.streams.map((one: { codec_type: string }) => one.codec_type).sort()
    assert.deepEqual(kinds, ['audio', 'video'])
    // From 2 s of a 6 s video: 4 s, starting at zero
    assert.closeTo(Number(probe.format.duration), 4, 0.3)
    assert.closeTo(Number(probe.format.start_time), 0, 0.1)
    second.stop()
  }).timeout(30_000)

  test('only the streamer goes through their own live, and without the engine it says so', async ({ client, assert }) => {
    const user = await makeUser()
    const other = await makeUser()
    const job = await live(user)

    ;(await client.get(`/api/jobs/${job.id}/watch/at?t=12000`)).assertStatus(401)
    ;(await client.get(`/api/jobs/${job.id}/watch?t=12000`)).assertStatus(401)
    ;(await client.get(`/api/jobs/${job.id}/watch/at?t=12000`).loginAs(other)).assertStatus(404)
    ;(await client.get(`/api/jobs/${job.id}/watch?t=12000`).loginAs(other)).assertStatus(404)

    // No worker answers in tests: where the live plays from cannot be known
    const at = await client.get(`/api/jobs/${job.id}/watch/at?t=12000`).loginAs(user)
    at.assertStatus(503)
    assert.deepEqual(at.body(), { error: 'unreachable' })
    ;(await client.get(`/api/jobs/${job.id}/watch?t=12000`).loginAs(user)).assertStatus(503)
  })
})
