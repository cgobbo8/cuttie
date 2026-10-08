/**
 * Public Twitch data (channel info + recent VODs) through the same public GQL
 * endpoint the worker already uses for chat replays. No user token needed.
 */

const GQL_URL = 'https://gql.twitch.tv/gql'
const PUBLIC_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const CACHE_MS = 60_000
const STORYBOARD_CACHE_MS = 30 * 60_000

export interface TwitchVod {
  id: string
  title: string
  duration_seconds: number
  published_at: string
  view_count: number
  /** 640x360 */
  thumbnail_url: string | null
  /** 1280x720, for heroes and blurred backdrops */
  thumbnail_large_url: string | null
  game: string | null
  url: string
}

export interface TwitchChannel {
  login: string
  display_name: string
  avatar_url: string | null
  banner_url: string | null
  description: string | null
  followers: number | null
  /** Channel color picked by the streamer on Twitch (#RRGGBB) */
  primary_color: string | null
  vods: TwitchVod[]
}

/** Sprite sheets of a VOD's seek previews: `count` frames, one every `interval` seconds */
export interface TwitchStoryboard {
  images: string[]
  cols: number
  rows: number
  count: number
  width: number
  height: number
  interval: number
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Client-ID': PUBLIC_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Twitch GQL HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T }
  if (!json.data) throw new Error('Twitch GQL: empty response')
  return json.data
}

/** "…/thumb0-640x360.jpg" -> "…/thumb0-1280x720.jpg" */
export function resizeThumbnail(url: string, width: number, height: number): string {
  return url.replace(/-\d+x\d+(\.\w+)$/, `-${width}x${height}$1`)
}

const cache = new Map<string, { at: number; channel: TwitchChannel | null }>()

export async function fetchChannel(login: string): Promise<TwitchChannel | null> {
  const key = login.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.channel

  const query = `query($login: String!) {
    user(login: $login) {
      login displayName description primaryColorHex profileImageURL(width: 300) bannerImageURL
      followers { totalCount }
      videos(first: 12, type: ARCHIVE, sort: TIME) {
        edges { node { id title lengthSeconds publishedAt viewCount previewThumbnailURL(width: 640, height: 360) game { displayName } } }
      }
    }
  }`
  const data = await gql<{ user: any }>(query, { login: key })
  const user = data.user
  const channel: TwitchChannel | null = user
    ? {
        login: user.login,
        display_name: user.displayName,
        avatar_url: user.profileImageURL ?? null,
        banner_url: user.bannerImageURL ?? null,
        description: user.description || null,
        followers: user.followers?.totalCount ?? null,
        primary_color: user.primaryColorHex ? `#${user.primaryColorHex}` : null,
        vods: (user.videos?.edges ?? []).map(({ node }: any) => {
          // Twitch serves a placeholder image while the VOD is still processing
          const thumb: string | null = node.previewThumbnailURL?.includes('404_processing')
            ? null
            : node.previewThumbnailURL ?? null
          return {
            id: node.id,
            title: node.title,
            duration_seconds: node.lengthSeconds,
            published_at: node.publishedAt,
            view_count: node.viewCount ?? 0,
            thumbnail_url: thumb,
            thumbnail_large_url: thumb ? resizeThumbnail(thumb, 1280, 720) : null,
            game: node.game?.displayName ?? null,
            url: `https://www.twitch.tv/videos/${node.id}`,
          }
        }),
      }
    : null
  cache.set(key, { at: Date.now(), channel })
  return channel
}

const storyboards = new Map<string, { at: number; storyboard: TwitchStoryboard | null }>()

export async function fetchStoryboard(vodId: string): Promise<TwitchStoryboard | null> {
  const hit = storyboards.get(vodId)
  if (hit && Date.now() - hit.at < STORYBOARD_CACHE_MS) return hit.storyboard

  const data = await gql<{ video: { seekPreviewsURL: string | null } | null }>(
    'query($id: ID!) { video(id: $id) { seekPreviewsURL } }',
    { id: vodId }
  )
  const infoUrl = data.video?.seekPreviewsURL
  let storyboard: TwitchStoryboard | null = null
  if (infoUrl) {
    const res = await fetch(infoUrl, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const qualities = (await res.json()) as any[]
      const best = qualities.find((q) => q.quality === 'high') ?? qualities[0]
      if (best?.images?.length) {
        const base = infoUrl.slice(0, infoUrl.lastIndexOf('/') + 1)
        storyboard = {
          images: best.images.map((name: string) => base + name),
          cols: best.cols,
          rows: best.rows,
          count: best.count,
          width: best.width,
          height: best.height,
          interval: best.interval,
        }
      }
    }
  }
  storyboards.set(vodId, { at: Date.now(), storyboard })
  return storyboard
}
