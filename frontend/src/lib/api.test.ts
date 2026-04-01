import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  clipUrl,
  assetUrl,
  listJobs,
  getJobStatus,
  type JobStatusType,
  type PaginationMeta,
  type JobSummary,
} from './api'

// ── Pure utility functions ───────────────────────────────────────────────────

describe('clipUrl', () => {
  it('builds the correct URL from jobId and filename', () => {
    expect(clipUrl('job-123', 'clip_01.mp4')).toBe('/api/clips/job-123/clip_01.mp4')
  })

  it('handles filenames with spaces or special characters', () => {
    expect(clipUrl('abc', 'my clip.mp4')).toBe('/api/clips/abc/my clip.mp4')
  })
})

describe('assetUrl', () => {
  it('builds the correct asset URL', () => {
    expect(assetUrl('logo.png')).toBe('/api/assets/logo.png')
  })
})

// ── Type guards (compile-time check that types are correct) ──────────────────

describe('JobStatusType', () => {
  it('accepts all valid status literals', () => {
    const statuses: JobStatusType[] = [
      'PENDING',
      'DOWNLOADING_AUDIO',
      'DOWNLOADING_CHAT',
      'ANALYZING_AUDIO',
      'ANALYZING_CHAT',
      'SCORING',
      'ANALYZING_CLIPS',
      'CLIPPING',
      'LLM_ANALYSIS',
      'DONE',
      'ERROR',
    ]
    expect(statuses).toHaveLength(11)
  })
})

// ── Fetch-dependent functions (mocked) ───────────────────────────────────────

const mockMeta: PaginationMeta = {
  total: 1,
  per_page: 10,
  current_page: 1,
  last_page: 1,
}

const rawJobSummary = {
  id: 'job-abc',
  url: 'https://twitch.tv/videos/123',
  status: 'DONE',
  vodTitle: 'My VOD',
  vodGame: 'Minecraft',
  vodDurationSeconds: 3600,
  streamer: 'streamer1',
  viewCount: 500,
  streamDate: '2024-01-01',
  chatMessageCount: 200,
  createdAt: '2024-01-01T00:00:00.000Z',
  error: null,
}

describe('listJobs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps camelCase API response fields to snake_case JobSummary', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [rawJobSummary], meta: mockMeta }),
    })

    const result = await listJobs()

    expect(result.meta).toEqual(mockMeta)
    expect(result.data).toHaveLength(1)

    const job: JobSummary = result.data[0]
    expect(job.job_id).toBe('job-abc')
    expect(job.vod_title).toBe('My VOD')
    expect(job.vod_game).toBe('Minecraft')
    expect(job.vod_duration_seconds).toBe(3600)
    expect(job.streamer).toBe('streamer1')
    expect(job.view_count).toBe(500)
    expect(job.stream_date).toBe('2024-01-01')
    expect(job.chat_message_count).toBe(200)
    expect(job.created_at).toBe('2024-01-01T00:00:00.000Z')
    expect(job.error).toBeNull()
  })

  it('passes query params to the fetch call', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], meta: { ...mockMeta, total: 0 } }),
    })

    await listJobs({ page: 2, per_page: 5, search: 'minecraft', status: 'DONE' })

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('per_page=5')
    expect(calledUrl).toContain('search=minecraft')
    expect(calledUrl).toContain('status=DONE')
  })

  it('throws when the response is not ok', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false })

    await expect(listJobs()).rejects.toThrow('Failed to fetch jobs')
  })
})

describe('getJobStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps a raw job response to JobResponse', async () => {
    const rawJob = {
      id: 'job-xyz',
      status: 'DONE',
      progress: null,
      hotPoints: null,
      error: null,
      vodTitle: 'Stream title',
      vodGame: 'Fortnite',
      vodDurationSeconds: 7200,
      streamer: 'gamer42',
      viewCount: 1000,
      streamDate: '2024-06-15',
      stepTimings: null,
    }

    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => rawJob,
    })

    const job = await getJobStatus('job-xyz')

    expect(job.job_id).toBe('job-xyz')
    expect(job.status).toBe('DONE')
    expect(job.vod_title).toBe('Stream title')
    expect(job.vod_game).toBe('Fortnite')
    expect(job.streamer).toBe('gamer42')
    expect(job.hot_points).toBeNull()
  })

  it('throws when the response is not ok', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false })

    await expect(getJobStatus('bad-id')).rejects.toThrow('Failed to fetch job status')
  })
})
