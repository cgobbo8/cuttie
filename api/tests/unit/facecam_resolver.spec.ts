import { test } from '@japa/runner'
import { camVisible, iou, resolveFacecam, scaleRect } from '#services/facecam_resolver'

const USUAL = { x: 1518, y: 0, w: 402, h: 446 }
// Same place, measured a few pixels apart on another live
const SAME = { x: 1516, y: 0, w: 404, h: 440 }
// Moved to the bottom-left corner
const MOVED = { x: 0, y: 640, w: 400, h: 440 }

test.group('Facecam resolver', () => {
  test('measures overlap', ({ assert }) => {
    assert.closeTo(iou(USUAL, SAME), 0.98, 0.02)
    assert.equal(iou(USUAL, MOVED), 0)
    assert.equal(iou(USUAL, USUAL), 1)
  })

  test("keeps the streamer's position when the cam is where it usually is", ({ assert }) => {
    assert.deepEqual(resolveFacecam({ live: null, brand: USUAL, detected: SAME }), {
      rect: USUAL,
      source: 'brand',
      moved: false,
    })
  })

  test('follows the cam when it moved on this live', ({ assert }) => {
    assert.deepEqual(resolveFacecam({ live: null, brand: USUAL, detected: MOVED }), {
      rect: MOVED,
      source: 'detected',
      moved: true,
    })
  })

  test('a framing set by hand for the live wins', ({ assert }) => {
    assert.deepEqual(resolveFacecam({ live: MOVED, brand: USUAL, detected: SAME }).rect, MOVED)
    assert.deepEqual(resolveFacecam({ live: false, brand: USUAL, detected: SAME }), {
      rect: null,
      source: 'live',
      moved: false,
    })
  })

  test('falls back on whatever is known', ({ assert }) => {
    assert.equal(resolveFacecam({ live: null, brand: USUAL, detected: null }).source, 'brand')
    assert.equal(resolveFacecam({ live: null, brand: null, detected: SAME }).source, 'detected')
    assert.isNull(resolveFacecam({ live: null, brand: false, detected: SAME }).rect)
    assert.isNull(resolveFacecam({ live: null, brand: null, detected: null }).source)
  })

  test('tells whether the cam shows in a clip', ({ assert }) => {
    assert.isTrue(camVisible(USUAL, [[400, 500], [1720, 260]]))
    // Only a game character, far from the cam
    assert.isFalse(camVisible(USUAL, [[400, 500]]))
    assert.isFalse(camVisible(USUAL, []))
    // Not checked: assume it shows
    assert.isTrue(camVisible(USUAL, undefined))
    assert.isFalse(camVisible(null, [[1720, 260]]))
  })

  test('only the exported part of a clip counts when frames have a time', ({ assert }) => {
    // Checked every 4 s; the streamer is in the cam for the first 20 s, then the
    // stream puts the webcam full screen (a face in the middle, the corner empty)
    const checked = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36]
    const people: [number, number, number][] = checked.map((t) => (t < 20 ? [1720, 260, t] : [900, 500, t]))

    assert.isTrue(camVisible(USUAL, people, checked, [0, 18]))
    assert.isFalse(camVisible(USUAL, people, checked, [22, 36]))
    // Half and half (frames 8 to 28): still shown
    assert.isTrue(camVisible(USUAL, people, checked, [10, 26]))
    // A part too short to tell, or none: the whole clip decides
    assert.isTrue(camVisible(USUAL, people, checked, [24.5, 25]))
    assert.isTrue(camVisible(USUAL, people, checked))
    assert.isFalse(camVisible(USUAL, people.slice(6), checked.slice(6), null))
  })

  test('scales rectangles between frame sizes', ({ assert }) => {
    assert.deepEqual(scaleRect(USUAL, 1920, 1080, 1280, 720), { x: 1012, y: 0, w: 268, h: 297 })
    assert.deepEqual(scaleRect({ ...USUAL, ref_w: 1920 } as any, 1920, 1080, 1920, 1080), USUAL)
  })
})
