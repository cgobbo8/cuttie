import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TARGET, levelArgs, levelSound, measureLoudness, needsLevelling, parseLoudness, smoothCuts } from '#services/sound_level'

const PRINTED = `Input #0, mov,mp4, from 'export.mp4':
  Stream #0:1: Audio: aac
[Parsed_loudnorm_0 @ 0x7c49000780]
{
	"input_i" : "-25.88",
	"input_tp" : "-5.71",
	"input_lra" : "18.40",
	"input_thresh" : "-38.28",
	"output_i" : "-14.15",
	"output_tp" : "-1.50",
	"output_lra" : "9.80",
	"output_thresh" : "-26.16",
	"normalization_type" : "dynamic",
	"target_offset" : "0.15"
}
[out#0/null @ 0x7c49000780] video:0KiB audio:70288KiB`

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test.group('Sound of the exports', () => {
  test('reads what ffmpeg measured', ({ assert }) => {
    assert.deepEqual(parseLoudness(PRINTED), { loudness: -25.88, peak: -5.71, range: 18.4, threshold: -38.28, offset: 0.15 })
  })

  test('silence and unreadable output measure as nothing', ({ assert }) => {
    assert.isNull(parseLoudness(PRINTED.replace('-25.88', '-inf')))
    assert.isNull(parseLoudness('Output file does not contain any stream'))
    assert.isNull(parseLoudness('{ "input_i" : '))
  })

  test('a quiet export is levelled, one already at the target is left alone', ({ assert }) => {
    const quiet = parseLoudness(PRINTED)!
    assert.isTrue(needsLevelling(quiet))
    assert.isFalse(needsLevelling({ ...quiet, loudness: TARGET.loudness + 0.6, peak: -2 }))
    // Loud enough but clipping: brought back under the peak
    assert.isTrue(needsLevelling({ ...quiet, loudness: TARGET.loudness, peak: 0.2 }))
  })

  test('the second pass copies the picture and is told what was measured', ({ assert }) => {
    const args = levelArgs('in.mp4', 'out.mp4', parseLoudness(PRINTED)!)
    assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'copy'])
    const filter = args[args.indexOf('-af') + 1]
    assert.equal(
      filter,
      'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-25.88:measured_TP=-5.71:measured_LRA=18.4:measured_thresh=-38.28:offset=0.15:linear=true'
    )
    assert.equal(args.at(-1), 'out.mp4')
  })

  test('a quiet video comes out at the loudness of the platforms, its picture untouched', async ({ assert }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cuttie-sound-'))
    const file = path.join(dir, 'export.mp4')
    try {
      // 6 s of a quiet voice-like tone that swells, over a small picture
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=30:duration=6',
        '-f', 'lavfi', '-i', "sine=frequency=220:duration=6,volume='0.02+0.02*lt(mod(t,2),1)':eval=frame",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
      ])
      const before = await measureLoudness(file)
      assert.isBelow(before!.loudness, -25)
      const frames = (f: string) => execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', f]).toString().trim()
      const pictures = frames(file)

      const levelled = await levelSound(file)
      assert.isNotNull(levelled)
      assert.closeTo(levelled!.from, before!.loudness, 0.01)
      const after = await measureLoudness(file)
      assert.closeTo(after!.loudness, TARGET.loudness, 1.5)
      assert.isAtMost(after!.peak, TARGET.peak + 1)
      assert.equal(frames(file), pictures)
      assert.isAbove(statSync(file).size, 1000)

      // Asked again: nothing left to do
      assert.isNull(await levelSound(file))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }).skip(!hasFfmpeg(), 'ffmpeg is not installed')

  test('the cuts of a montage are smoothed in the same pass', ({ assert }) => {
    assert.isNull(smoothCuts([]))
    assert.isNull(smoothCuts([0, Number.NaN, -1]))
    // The sound dips to nothing at each cut and is back 8 ms later; a cut given twice counts once
    assert.equal(smoothCuts([1.2667, 4.5, 4.5]), "asetnsamples=n=64:p=0,volume='min(min(1,abs(t-1.2667)/0.008),abs(t-4.5000)/0.008)':eval=frame")
    const measured = parseLoudness(PRINTED)!
    const both = levelArgs('in.mp4', 'out.mp4', measured, [2])
    assert.match(both[both.indexOf('-af') + 1], /^asetnsamples=n=64:p=0,volume='min\(1,abs\(t-2\.0000\)\/0\.008\)':eval=frame,loudnorm=I=-14/)
    // Loud enough already: only the cuts
    const only = levelArgs('in.mp4', 'out.mp4', null, [2])
    assert.equal(only[only.indexOf('-af') + 1], "asetnsamples=n=64:p=0,volume='min(1,abs(t-2.0000)/0.008)':eval=frame")
  })

  test('a click at a cut is gone, the sound around it untouched', async ({ assert }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cuttie-cut-'))
    const file = path.join(dir, 'montage.mp4')
    try {
      // Two tones put end to end at 2 s, the second one starting at the top of its wave: a step in the sound
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=30:duration=4',
        '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,2),0.25*sin(2*PI*220*t),0.25*cos(2*PI*330*(t-2)))':s=48000:d=4",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-shortest', path.join(dir, 'raw.mov'),
      ])
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'raw.mov'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', file])
      const levelAt = (f: string, at: number) => {
        // The loudest sample in the 4 ms around `at`
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at - 0.002), '-t', '0.004', '-i', f, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 24 })
        let peak = 0
        for (let i = 0; i + 1 < raw.length; i += 2) peak = Math.max(peak, Math.abs(raw.readInt16LE(i)))
        return peak / 32768
      }
      assert.isAbove(levelAt(file, 2), 0.15)

      const done = await levelSound(file, [2])
      assert.isNotNull(done)
      // The sound dips at the cut (within 2 ms of it, a quarter of what it is elsewhere at most);
      // 50 ms away the tone is there, brought up with the rest
      const around = Math.min(levelAt(file, 1.95), levelAt(file, 2.05))
      assert.isAbove(around, 0.15)
      assert.isBelow(levelAt(file, 2), 0.35 * around)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }).skip(!hasFfmpeg(), 'ffmpeg is not installed')

  test('an intro\'s sound is mixed in once the video is levelled, and fades as the video starts', ({ assert }) => {
    const measured = parseLoudness(PRINTED)!
    const args = levelArgs('in.mp4', 'out.mp4', measured, [1.6], { file: 'boom.mp3', gain: 1, fade: { at: 1.6, for: 1.0667 } })
    assert.deepEqual(args.slice(0, 7), ['-v', 'error', '-y', '-i', 'in.mp4', '-i', 'boom.mp3'])
    const graph = args[args.indexOf('-filter_complex') + 1]
    // The video's own sound: its cuts smoothed and its loudness set, before anything is added to it
    assert.match(graph, /^\[0:a:0\]asetnsamples[^;]+loudnorm=[^;]+,aresample=48000\[video\];/)
    assert.include(graph, '[1:a:0]aresample=48000,atrim=0:2.667,afade=t=out:st=1.600:d=1.067,volume=1.000[jingle];')
    // Nothing turned down to make room, never over the peak allowed
    assert.include(graph, '[video][jingle]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.841:level=false[out]')
    assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 6), ['-map', '0:v:0', '-map', '[out]', '-c:v', 'copy'])
    assert.notInclude(args, '-af')
    // A video already at the level: the sound is added all the same
    assert.match(levelArgs('in.mp4', 'out.mp4', null, [], { file: 'boom.mp3', gain: 0.8 })[8], /^\[0:a:0\]aresample=48000\[video\];\[1:a:0\]aresample=48000,volume=0\.800\[jingle\]/)
  })

  test('the sound of an intro is heard at the start of the export, not after', async ({ assert }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cuttie-jingle-'))
    const file = path.join(dir, 'montage.mp4')
    const jingle = path.join(dir, 'jingle.mp3')
    try {
      // A video silent for its first 2 s (the intro holds the screen), then a quiet voice-like tone
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=30:duration=6',
        '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,2),0,0.05*sin(2*PI*220*t))':s=48000:d=6",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', file,
      ])
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*880*t)':s=48000:d=4", jingle])
      const loudest = (from: number, length: number) => {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(length), '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 26 })
        let peak = 0
        for (let i = 0; i + 1 < raw.length; i += 2) peak = Math.max(peak, Math.abs(raw.readInt16LE(i)))
        return peak / 32768
      }
      assert.isBelow(loudest(0.5, 1), 0.01)

      const done = await levelSound(file, [2], { file: jingle, gain: 1, fade: { at: 2, for: 1 } })
      assert.isNotNull(done)
      // The jingle fills the silence of the intro...
      assert.isAbove(loudest(0.5, 1), 0.2)
      // ...and is gone a second after the video starts: only the tone, brought up, is left
      const after = loudest(3.5, 1)
      assert.isAbove(after, 0.05)
      assert.isBelow(after, loudest(0.5, 1))
      // The picture was not touched: still 6 s
      const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
      assert.closeTo(length, 6, 0.1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }).skip(!hasFfmpeg(), 'ffmpeg is not installed')

  test('a file that is not a video is left as it is', async ({ assert }) => {
    assert.isNull(await levelSound(path.join(tmpdir(), 'cuttie-no-such-export.mp4')))
  })
})
