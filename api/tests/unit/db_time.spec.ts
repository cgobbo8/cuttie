import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { dbMillis, dbTime } from '#services/db_time'

test.group('Stored times', () => {
  test("reads Lucid's format and the ISO text raw updates wrote", ({ assert }) => {
    assert.equal(dbMillis('2026-10-11 09:23:17'), Date.UTC(2026, 9, 11, 9, 23, 17))
    assert.equal(dbMillis('2026-10-10T23:25:06.123Z'), Date.UTC(2026, 9, 10, 23, 25, 6, 123))
    assert.equal(dbMillis('2026-10-10T23:25:06+02:00'), Date.UTC(2026, 9, 10, 21, 25, 6))
    assert.equal(dbMillis(new Date(5000)), 5000)
    assert.equal(dbMillis(DateTime.fromMillis(7000)), 7000)
  })

  test('says when a time cannot be read', ({ assert }) => {
    for (const value of [null, undefined, '', 'yesterday', DateTime.fromSQL('2026-10-10T23:25:06.123Z')]) {
      assert.isNaN(dbMillis(value), String(value))
    }
  })

  test('writes what Lucid reads', ({ assert }) => {
    assert.equal(dbTime(new Date('2026-10-10T23:25:06.123Z')), '2026-10-10 23:25:06')
    assert.isTrue(DateTime.fromSQL(dbTime(), { zone: 'utc' }).isValid)
  })
})
