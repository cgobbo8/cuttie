import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { clipDir } from '#services/data_paths'
import { dropFlats, flatArgs, flatCompilation, flatParts, flatSignature, flatStarts, flatWords, flattenCompilation, isFlatClip } from '#services/compilation_flat'

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const item = (id: string, start: number, end: number, more: Record<string, unknown> = {}) => ({ id, start, end, text: '', why: '', sources: ['voice'], ...more })
const video = (...items: ReturnType<typeof item>[]) => ({ id: 'abcdefghij', sections: [{ id: 'sectionone', title: '', query: '', items }] })

test.group('A compilation as one clip', (group) => {
  const made: string[] = []
  group.teardown(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  /** A live's folder, with the clips of its passages: [id, where the file starts and ends in the live] */
  function live(pieces: [string, number, number][] = []) {
    const id = randomUUID()
    const dir = clipDir(id)
    made.push(dir)
    mkdirSync(dir, { recursive: true })
    for (const [piece, start, end] of pieces) {
      writeFileSync(path.join(dir, `piece_${piece}.mp4`), '')
      writeFileSync(path.join(dir, `piece_${piece}_meta.json`), JSON.stringify({ vod_start: start, vod_end: end, settled: true }))
    }
    return { id, dir }
  }

  test('knows its own clips by their name', ({ assert }) => {
    assert.isTrue(isFlatClip('flat_abcdefghij_0123abcd.mp4'))
    assert.equal(flatCompilation('flat_abcdefghij_0123abcd.mp4'), 'abcdefghij')
    assert.isFalse(isFlatClip('piece_abcdefghij.mp4'))
    assert.isFalse(isFlatClip('flat_abcdefghij.mp4'))
    assert.isNull(flatCompilation('comp_abcdefghij.mp4'))
  })

  test('each passage plays the part of its clip it is cut on, from the live it is in', ({ assert }) => {
    const home = live([['aaaaaaaaaa', 100, 112]])
    const other = live([['bbbbbbbbbb', 500, 520]])
    const parts = flatParts(home.id, video(item('aaaaaaaaaa', 102.5, 106), item('bbbbbbbbbb', 507, 511.25, { job: other.id })))
    assert.deepEqual(parts, [
      { live: home.id, file: 'piece_aaaaaaaaaa.mp4', from: 2.5, length: 3.5, liveStart: 102.5 },
      { live: other.id, file: 'piece_bbbbbbbbbb.mp4', from: 7, length: 4.25, liveStart: 507 },
    ])
  })

  test('a passage without its clip, or whose clip does not hold it, stops everything', ({ assert }) => {
    const home = live([['aaaaaaaaaa', 100, 112]])
    assert.isNull(flatParts(home.id, video(item('aaaaaaaaaa', 102, 106), item('cccccccccc', 200, 204))))
    assert.isNull(flatParts(home.id, video(item('aaaaaaaaaa', 108, 115))))
  })

  test('the same passages and cuts make the same clip, a cut that moved makes another', ({ assert }) => {
    const home = live([['aaaaaaaaaa', 100, 112]])
    const one = flatSignature(flatParts(home.id, video(item('aaaaaaaaaa', 102, 106)))!)
    assert.match(one, /^[a-f0-9]{8}$/)
    assert.equal(flatSignature(flatParts(home.id, video(item('aaaaaaaaaa', 102, 106)))!), one)
    assert.notEqual(flatSignature(flatParts(home.id, video(item('aaaaaaaaaa', 102, 106.5)))!), one)
  })

  test('each passage starts on a frame, right after the one before', ({ assert }) => {
    const { starts, duration } = flatStarts([{ length: 1.3 }, { length: 4.01 }, { length: 0.5 }], 30)
    assert.deepEqual(starts.map((s) => Math.round(s * 30)), [0, 39, 159])
    assert.closeTo(duration, 174 / 30, 1e-9)
  })

  test('words move to where their passage plays, those cut out are gone', ({ assert }) => {
    const part = (from: number, length: number, words: [string, number, number][]) => ({ live: 'x', file: 'f.mp4', from, length, liveStart: 0, words: words.map(([word, start, end]) => ({ word, start, end, speaker: 'Falkarst' })) })
    const words = flatWords(
      [part(2, 3, [['avant', 1, 1.4], ['calme', 2.2, 2.6], ['ici', 4.4, 5.3], ['après', 5.4, 5.8]]), part(10, 2, [['débordés', 10.5, 11]])],
      [0, 3]
    )
    assert.deepEqual(words, [
      { word: 'calme', start: 0.2, end: 0.6, speaker: 'Falkarst' },
      // Said across the cut: it stops with its passage
      { word: 'ici', start: 2.4, end: 3, speaker: 'Falkarst' },
      { word: 'débordés', start: 3.5, end: 4, speaker: 'Falkarst' },
    ])
  })

  test('every passage is cut exactly and brought to one size before being joined', ({ assert }) => {
    const args = flatArgs(
      [
        { live: 'a', file: 'one.mp4', path: '/clips/a/one.mp4', from: 2.5, length: 3.5, liveStart: 0 },
        { live: 'b', file: 'two.mp4', path: '/clips/b/two.mp4', from: 7, length: 1, liveStart: 0 },
      ],
      '/clips/a/out.mp4',
      { width: 1920, height: 1080, fps: 60 }
    )
    assert.deepEqual(args.slice(3, 15), ['-ss', '2.5', '-t', '3.5', '-i', '/clips/a/one.mp4', '-ss', '7', '-t', '1', '-i', '/clips/b/two.mp4'])
    const graph = args[args.indexOf('-filter_complex') + 1]
    assert.include(graph, '[1:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=60,trim=end_frame=60')
    // The sound dips to nothing at each join, and is as long as the picture
    assert.include(graph, 'afade=t=in:st=0:d=0.008,afade=t=out:st=3.492:d=0.008,apad=whole_dur=3.5[a0]')
    assert.include(graph, '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]')
    assert.equal(args.at(-1), '/clips/a/out.mp4')
  })

  test('two passages of two lives become one clip with their words and chat, made once', async ({ assert }) => {
    if (!hasFfmpeg()) return
    const home = live()
    const other = live()
    const clip = (dir: string, id: string, size: string, rate: number, tone: number, start: number) => {
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${rate}:duration=4`,
        '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=4`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, `piece_${id}.mp4`),
      ])
      writeFileSync(path.join(dir, `piece_${id}_meta.json`), JSON.stringify({ vod_start: start, vod_end: start + 4, settled: true }))
    }
    clip(home.dir, 'aaaaaaaaaa', '320x180', 30, 220, 100)
    clip(other.dir, 'bbbbbbbbbb', '160x120', 25, 440, 500)
    writeFileSync(path.join(home.dir, 'piece_aaaaaaaaaa_probe.json'), JSON.stringify({ width: 320, height: 180, duration: 4 }))
    writeFileSync(path.join(home.dir, 'piece_aaaaaaaaaa_words.json'), JSON.stringify([{ word: 'calme', start: 1.2, end: 1.6 }, { word: 'coupé', start: 3.6, end: 3.9 }]))
    writeFileSync(path.join(other.dir, 'piece_bbbbbbbbbb_words.json'), JSON.stringify([{ word: 'débordés', start: 1.5, end: 2 }]))
    const chatOf = (id: string) => (id === other.id ? [{ author: 'viewer', text: 'MDR', timestamp: 502 }, { author: 'viewer', text: 'plus tard', timestamp: 900 }] : [])

    const compilation = video(item('aaaaaaaaaa', 101, 103), item('bbbbbbbbbb', 501, 503.5, { job: other.id }))
    const flat = await flattenCompilation(home.id, compilation, chatOf)
    assert.isNotNull(flat)
    assert.isTrue(flat!.fresh)
    assert.isTrue(isFlatClip(flat!.clip))
    assert.deepEqual(flat!.starts, [0, 2])
    assert.closeTo(flat!.duration, 4.5, 0.001)

    // The first passage's size and rate; picture and sound as long as each other
    const file = path.join(home.dir, flat!.clip)
    const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration', '-of', 'json', file]).toString()).streams
    const picture = streams.find((s: any) => s.codec_type === 'video')
    const sound = streams.find((s: any) => s.codec_type === 'audio')
    assert.deepInclude(picture, { width: 320, height: 180, r_frame_rate: '30/1' })
    assert.closeTo(Number(picture.duration), 4.5, 0.05)
    assert.closeTo(Number(sound.duration), 4.5, 0.05)

    const base = flat!.clip.slice(0, -4)
    assert.deepEqual(JSON.parse(readFileSync(path.join(home.dir, `${base}_probe.json`), 'utf-8')), { width: 320, height: 180, duration: 4.5 })
    assert.deepEqual(JSON.parse(readFileSync(path.join(home.dir, `${base}_words.json`), 'utf-8')), [
      { word: 'calme', start: 0.2, end: 0.6 },
      { word: 'débordés', start: 2.5, end: 3 },
    ])
    assert.deepEqual(JSON.parse(readFileSync(path.join(home.dir, `${base}_chat.json`), 'utf-8')), [{ author: 'viewer', text: 'MDR', timestamp: 3 }])

    // Asked again, unchanged: the same clip, not made again
    const again = await flattenCompilation(home.id, compilation, chatOf)
    assert.deepInclude(again, { clip: flat!.clip, fresh: false })

    // A cut that moved: another clip, and the one before is deleted with its files
    const moved = await flattenCompilation(home.id, video(item('aaaaaaaaaa', 101, 102), item('bbbbbbbbbb', 501, 503.5, { job: other.id })), chatOf)
    assert.notEqual(moved!.clip, flat!.clip)
    assert.isFalse(existsSync(file))
    assert.deepEqual(readdirSync(home.dir).filter((name) => name.startsWith('flat_')).sort(), [moved!.clip, `${moved!.clip.slice(0, -4)}_chat.json`, `${moved!.clip.slice(0, -4)}_probe.json`, `${moved!.clip.slice(0, -4)}_words.json`].sort())

    dropFlats(home.id, 'abcdefghij')
    assert.lengthOf(readdirSync(home.dir).filter((name) => name.startsWith('flat_')), 0)
  }).timeout(60_000)

  test('nothing to join without passages', async ({ assert }) => {
    const home = live()
    assert.isNull(await flattenCompilation(home.id, video(), () => []))
  })
})
