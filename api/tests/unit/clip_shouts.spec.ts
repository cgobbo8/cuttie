import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { clipShouts, clipSound, curveOf, levelArgs, parseLevels, shoutsIn } from '#services/clip_shouts'

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** A clip's levels: talk at `usual` dB, with louder stretches (`[from, to, level]`, readings) */
function levels(readings: number, usual: number, louder: [number, number, number][] = []): number[] {
  // (talk is never flat: a little up and down around its level)
  const out = Array.from({ length: readings }, (_, i) => usual + ((i * 7) % 5) - 2)
  for (const [from, to, level] of louder) for (let i = from; i < to; i++) out[i] = level
  return out
}

test.group('Where someone shouts in a clip', () => {
  test('reads what ffmpeg printed, one level a reading', ({ assert }) => {
    const printed = [
      'frame:0    pts:0       pts_time:0',
      'lavfi.astats.Overall.RMS_level=-31.25',
      'frame:1    pts:800     pts_time:0.1',
      'lavfi.astats.Overall.RMS_level=-inf',
      'frame:2    pts:1600    pts_time:0.2',
      'lavfi.astats.Overall.RMS_level=-12.5',
      'lavfi.astats.Overall.RMS_level=nan',
    ].join('\n')
    assert.deepEqual(parseLevels(printed), [-31.25, -120, -12.5, -120])
    assert.deepEqual(parseLevels(''), [])
    // The clip's sound only, read ten times a second
    const args = levelArgs('/clips/a.mp4').join(' ')
    assert.include(args, '-i /clips/a.mp4 -vn')
    assert.include(args, 'asetnsamples=n=800')
    assert.include(args, 'RMS_level')
  })

  test('finds the instants the sound stays far above its usual level, and says by how much', ({ assert }) => {
    // 40 s of talk around -32 dB; a shout of half a second at 12 s, a longer one at 30 s
    const found = shoutsIn(levels(400, -32, [[120, 125, -18], [300, 312, -14]]))
    assert.deepEqual(found.map((shout) => shout.at), [12, 30])
    assert.isAbove(found[1].over, found[0].over)
    assert.closeTo(found[0].over, 14, 2.5)
  })

  test('is not fooled by a click, by even talk, or by silence', ({ assert }) => {
    // A tenth of a second: a click, not a shout
    assert.deepEqual(shoutsIn(levels(400, -32, [[120, 121, -10]])), [])
    // Talk that never rises: nothing stands out
    assert.deepEqual(shoutsIn(levels(400, -30)), [])
    // A little louder for a while is not a shout either
    assert.deepEqual(shoutsIn(levels(400, -32, [[100, 140, -27]])), [])
    // Almost nothing heard
    assert.deepEqual(shoutsIn(Array.from({ length: 400 }, () => -90)), [])
    assert.deepEqual(shoutsIn([]), [])
  })

  test('counts two bursts right after one another as the same shout', ({ assert }) => {
    const found = shoutsIn(levels(400, -32, [[120, 125, -16], [130, 136, -15], [250, 256, -16]]))
    assert.deepEqual(found.map((shout) => shout.at), [12, 25])
  })

  test('keeps how loud the clip is over its length, five values a second, 0 to 100', ({ assert }) => {
    // Two readings make one value (the loudest of the two): silence, quiet talk, a burst, the loudest there is
    assert.deepEqual(curveOf([-120, -120, -33, -60, -6, -40, 0, -3]), [0, 50, 100, 100])
    assert.deepEqual(curveOf([-33]), [50])
    assert.deepEqual(curveOf([]), [])
  })

  test('measures a real clip once and keeps what it found beside it', async ({ assert }) => {
    if (!hasFfmpeg()) return
    const dir = mkdtempSync(path.join(tmpdir(), 'cuttie-shouts-'))
    try {
      const clip = path.join(dir, 'clip.mp4')
      // 12 s of a quiet tone, much louder between 6 and 7 s
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=12',
        '-f', 'lavfi', '-i', 'sine=frequency=300:duration=12',
        '-af', "volume='if(between(t,6,7),1,0.04)':eval=frame",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        clip,
      ])
      const found = await clipShouts(clip)
      assert.lengthOf(found, 1)
      assert.closeTo(found[0].at, 6, 0.25)
      assert.isAbove(found[0].over, 15)
      const kept = path.join(dir, 'clip_shouts.json')
      assert.isTrue(existsSync(kept))
      assert.deepEqual(JSON.parse(readFileSync(kept, 'utf-8')).shouts, found)
      assert.deepEqual(await clipShouts(clip), found)
      // Its curve: 12 s at five values a second, low all along and high during the loud second
      const { curve } = await clipSound(clip)
      assert.closeTo(curve.length, 60, 2)
      assert.isAbove(curve[32], curve[10] + 30)
      // A clip that is not there has none
      assert.deepEqual(await clipShouts(path.join(dir, 'gone.mp4')), [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }).timeout(30_000)
})
