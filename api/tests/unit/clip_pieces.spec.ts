import { test } from '@japa/runner'
import { envelope, extendPieces, normalizeRanges, parseRanges } from '#services/clip_pieces'

test.group('Clip pieces', () => {
  test('reads pieces as the app sends them', ({ assert }) => {
    assert.deepEqual(parseRanges([[5, 12], ['30', 40.5]]), [[5, 12], [30, 40.5]])
    assert.isNull(parseRanges('5-12'))
    assert.isNull(parseRanges([[5]]))
    assert.isNull(parseRanges([[12, 5]]))
    assert.isNull(parseRanges([[-1, 5]]))
    assert.isNull(parseRanges([[0, Number.NaN]]))
    assert.deepEqual(parseRanges([]), [])
  })

  test('keeps pieces in order, the tiny ones dropped; those that touch stay two, those that overlap become one', ({ assert }) => {
    assert.deepEqual(normalizeRanges([[30, 40], [5, 12.004], [12.03, 20], [50, 50.2]]), [[5, 12], [12, 20], [30, 40]])
    assert.deepEqual(normalizeRanges([[5, 15], [15, 25]]), [[5, 15], [15, 25]])
    assert.deepEqual(normalizeRanges([[10, 30], [15, 20], [25, 40]]), [[10, 40]])
    assert.deepEqual(normalizeRanges([]), [])
  })

  test('the trim spans the pieces', ({ assert }) => {
    assert.deepEqual(envelope([[5.04, 12], [30, 40.26]]), [5, 40.3])
  })

  test('30 s more: the first or the last piece grows', ({ assert }) => {
    const pieces: [number, number][] = [[12, 20], [40, 65]]
    // More after, inside the clip's file
    assert.deepEqual(extendPieces(pieces, 'end', [12, 95], 0), [[12, 20], [40, 95]])
    // More before, the file grew by 18 s: every piece moves with the clip's clock
    assert.deepEqual(extendPieces(pieces, 'start', [0, 83], 18), [[0, 38], [58, 83]])
    // Two pieces that touch stay two
    assert.deepEqual(extendPieces([[12, 20], [20, 65]], 'end', [12, 95], 0), [[12, 20], [20, 95]])
  })
})
