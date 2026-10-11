import { test } from '@japa/runner'
import { planExtend, shiftClipClock, suggestedCut } from '#services/clip_extend'

// A clip file covering 1000-1090 s of a 5 h live, cut at 20-50 s by the AI
const LIVE = 5 * 3600

test.group('Clip extend', () => {
  test('the cut grows inside the clip while there is room', ({ assert }) => {
    assert.deepEqual(planExtend('end', 1000, 1090, [20, 50], LIVE), { file: null, trim: [20, 80] })
    assert.deepEqual(planExtend('start', 1000, 1090, [35, 50], LIVE), { file: null, trim: [5, 50] })
  })

  test('the clip itself grows when the cut would go past it', ({ assert }) => {
    // 30 s before: the file starts at 970, its clock moves by 30 s
    assert.deepEqual(planExtend('start', 1000, 1090, [20, 50], LIVE), { file: { start: 970, end: 1090 }, trim: [20, 80] })
    // 30 s after a cut ending at 80: the file grows to 1120, the cut to 110
    assert.deepEqual(planExtend('end', 1000, 1090, [20, 80], LIVE), { file: { start: 1000, end: 1120 }, trim: [20, 110] })
  })

  test('the live starts and ends somewhere', ({ assert }) => {
    // 12 s of live before the clip: only those
    assert.deepEqual(planExtend('start', 12, 102, [5, 50], LIVE), { file: { start: 0, end: 102 }, trim: [0, 62] })
    // At the very start, the cut already there: nothing to do
    assert.isNull(planExtend('start', 0, 90, [0, 50], LIVE))
    // At the start, the cut not yet: it goes to the start
    assert.deepEqual(planExtend('start', 0, 90, [10, 50], LIVE), { file: null, trim: [0, 50] })
    // The live ends 10 s after the clip
    assert.deepEqual(planExtend('end', LIVE - 100, LIVE - 10, [20, 85], LIVE), { file: { start: LIVE - 100, end: LIVE }, trim: [20, 100] })
    assert.isNull(planExtend('end', LIVE - 90, LIVE, [20, 90], LIVE))
  })

  test("what the AI timed on the clip's clock follows its new start", ({ assert }) => {
    const hp = { clip_filename: 'a.mp4', llm: { cut_start: 20, cut_end: 50, key_moments: [{ time: 33.3, label: 'chute' }] } }
    const shifted = shiftClipClock(hp, 30)
    assert.deepEqual(shifted.llm, { cut_start: 50, cut_end: 80, key_moments: [{ time: 63.3, label: 'chute' }] })
    assert.equal(hp.llm.cut_start, 20)
    assert.strictEqual(shiftClipClock(hp, 0), hp)
  })

  test('the cut the AI suggested, when it is one', ({ assert }) => {
    assert.deepEqual(suggestedCut({ llm: { cut_start: 3, cut_end: 40 } }), [3, 40])
    assert.isNull(suggestedCut({ llm: { cut_start: 3, cut_end: 6 } }))
    assert.isNull(suggestedCut({ llm: null }))
  })
})
