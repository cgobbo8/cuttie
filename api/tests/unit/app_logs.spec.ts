import { test } from '@japa/runner'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { clearLogs, journalFiles, journalSince, linesSince, logsSize, redact } from '#services/app_logs'
import { crc32, zip } from '#services/zip'
import { unzip } from '../helpers/unzip.js'

test.group('Journal', () => {
  test('a period keeps its lines and the lines that continue them', ({ assert }) => {
    const text = [
      '2026-10-11T08:00:00.000Z [worker] old line',
      'Traceback of the old line',
      '2026-10-11T09:30:00.000Z [worker] ERROR worker: Job crashed',
      'Traceback (most recent call last):',
      '  File "pipeline.py", line 12',
      '2026-10-11T09:31:00.000Z [api] started',
    ].join('\n')
    assert.deepEqual(linesSince(text, Date.parse('2026-10-11T09:00:00Z')), [
      '2026-10-11T09:30:00.000Z [worker] ERROR worker: Job crashed',
      'Traceback (most recent call last):',
      '  File "pipeline.py", line 12',
      '2026-10-11T09:31:00.000Z [api] started',
    ])
    assert.lengthOf(linesSince('lines before any time\n' + text, 0), 7)
  })

  test('keys, tokens and signatures never leave the computer', ({ assert }) => {
    const text = redact(
      [
        'Incorrect API key provided: sk-or-v1-0123456789abcdef0123456789abcdef',
        'groq gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 openai sk-proj-abcdefghijklmnopqrstuvwxyz',
        'GET /api/storage/clips/a.mp4?exp=1791672516&sig=AbCdEfGhIjKlMnOpQrStUv',
        'https://usher.ttvnw.net/vod/1.m3u8?token=%7B%22auth%22%7D&sig=0123abcd',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sign',
        '{"openrouter_api_key": "sk-something-long-enough"}',
      ].join('\n')
    )
    assert.notMatch(text, /0123456789abcdef0123|ABCDEFGHIJKLMNOP|abcdefghijklmnopqrst|AbCdEfGhIj|%7B%22auth|0123abcd|eyJhbGci|something-long/)
    assert.include(text, 'exp=1791672516')
    assert.include(text, 'sk-or-v1-…')
  })

  test('the files rotate oldest first, and emptying keeps the current one', ({ assert }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cuttie-logs-'))
    try {
      writeFileSync(path.join(dir, 'cuttie.log'), '2026-10-11T10:00:00.000Z [api] now\n')
      writeFileSync(path.join(dir, 'cuttie.1.log'), '2026-10-10T10:00:00.000Z [api] yesterday\n')
      writeFileSync(path.join(dir, 'cuttie.2.log'), '2026-10-09T10:00:00.000Z [api] before key sk-or-v1-0123456789abcdef0123456789\n')
      writeFileSync(path.join(dir, 'other.txt'), 'x')
      assert.deepEqual(
        journalFiles(dir).map((f) => path.basename(f)),
        ['cuttie.2.log', 'cuttie.1.log', 'cuttie.log']
      )
      const journal = journalSince(0, dir)
      assert.match(journal, /before key sk-or-v1-…\n.*yesterday\n.*now\n$/s)
      assert.equal(journalSince(Date.parse('2026-10-11T00:00:00Z'), dir), '2026-10-11T10:00:00.000Z [api] now\n')

      const size = logsSize(dir)
      assert.isAbove(size, 100)
      assert.equal(clearLogs(dir), size)
      assert.equal(readFileSync(path.join(dir, 'cuttie.log'), 'utf-8'), '')
      assert.isFalse(existsSync(path.join(dir, 'cuttie.1.log')))
      assert.equal(logsSize(dir), 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test.group('Zip', () => {
  test('files come back as they went in', ({ assert }) => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
    const journal = '2026-10-11T10:00:00.000Z [worker] Transcription : 46 morceaux\n'.repeat(500)
    const archive = zip([
      { name: 'journal.log', data: journal },
      { name: 'diagnostic.json', data: '{"é": "à"}' },
    ])
    assert.isBelow(archive.length, journal.length / 10)
    assert.deepEqual(unzip(archive), { 'journal.log': journal, 'diagnostic.json': '{"é": "à"}' })
  })
})
