import { test } from '@japa/runner'
import { beatSeconds, followsBeat, introFade, introHoldFrames, introSeconds } from '#services/compilations'

test.group('a jingle on the music of its video', () => {
  test('lasts a few of the track\'s beats, so that the video starts on one', ({ assert }) => {
    // 120 beats a minute: four beats are two seconds, a length this jingle (56 frames as written) can have
    assert.equal(beatSeconds('sunset', 120), 2)
    // A slow track: two of its beats; a very fast one: eight
    assert.equal(beatSeconds('sunset', 72), 1.667)
    assert.equal(beatSeconds('sunset', 200), 2.4)
    // No music, no tempo, a tempo nobody plays at, a hook, a style nobody knows: as written
    for (const [style, bpm] of [['sunset', null], ['sunset', undefined], ['sunset', 0], ['sunset', 900], ['hook', 120], ['wobble', 120]] as const) {
      assert.isNull(beatSeconds(style, bpm))
    }
    // The video is that much longer
    assert.equal(introSeconds({ style: 'sunset' }, 120), 2)
    assert.closeTo(introSeconds({ style: 'sunset' }), 56 / 30, 1e-9)
    assert.closeTo(introSeconds({ style: 'sunset' }, null), 56 / 30, 1e-9)
  })

  test('holds the screen that long in the export, its sound played as much faster or slower', ({ assert }) => {
    assert.equal(introHoldFrames({ style: 'sunset', hold: 2 }, 30), 60)
    assert.equal(introHoldFrames({ style: 'sunset', hold: 2 }, 60), 120)
    assert.equal(introHoldFrames({ style: 'sunset' }, 30), 56)
    // A length that jingle can't be played at is not followed
    assert.isTrue(followsBeat('sunset', 2) && !followsBeat('sunset', 0.4) && !followsBeat('sunset', 9) && !followsBeat('hook', 2) && !followsBeat('sunset', '2'))
    assert.equal(introHoldFrames({ style: 'sunset', hold: 9 }, 30), 56)
    // Its sound fades from where the video starts, and was written for 56 frames
    const fade = introFade('sunset', 2)!
    assert.equal(fade.at, 2)
    assert.closeTo(fade.rate, 56 / 60, 1e-9)
    assert.deepEqual(introFade('sunset'), { at: 56 / 30, for: (10 + 24) / 30, rate: 1 })
    assert.isNull(introFade('wobble'))
  })
})
