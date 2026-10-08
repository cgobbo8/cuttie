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

  test('scales rectangles between frame sizes', ({ assert }) => {
    assert.deepEqual(scaleRect(USUAL, 1920, 1080, 1280, 720), { x: 1012, y: 0, w: 268, h: 297 })
    assert.deepEqual(scaleRect({ ...USUAL, ref_w: 1920 } as any, 1920, 1080, 1920, 1080), USUAL)
  })
})
