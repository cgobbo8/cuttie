/**
 * Public Twitch data (channel info + recent VODs) through the same public GQL
 * endpoint the worker already uses for chat replays. No user token needed.
 */

const GQL_URL = 'https://gql.twitch.tv/gql'
const PUBLIC_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const CACHE_MS = 60_000

export interface TwitchVod {
  id: string
  title: string
  duration_seconds: number
  published_at: string
  thumbnail_url: string | null
  game: string | null
  url: string
}

export interface TwitchChannel {
  login: string
  display_name: string
  avatar_url: string | null
  vods: TwitchVod[]
}

const cache = new Map<string, { at: number; channel: TwitchChannel | null }>()

export async function fetchChannel(login: string): Promise<TwitchChannel | null> {
  const key = login.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.channel

  const query = `query($login: String!) {
    user(login: $login) {
      login displayName profileImageURL(width: 300)
      videos(first: 12, type: ARCHIVE, sort: TIME) {
        edges { node { id title lengthSeconds publishedAt previewThumbnailURL(width: 640, height: 360) game { displayName } } }
      }
    }
  }`
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Client-ID': PUBLIC_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: key } }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Twitch GQL HTTP ${res.status}`)
  const json = (await res.json()) as any
  const user = json?.data?.user
  const channel: TwitchChannel | null = user
    ? {
        login: user.login,
        display_name: user.displayName,
        avatar_url: user.profileImageURL ?? null,
        vods: (user.videos?.edges ?? []).map(({ node }: any) => ({
          id: node.id,
          title: node.title,
          duration_seconds: node.lengthSeconds,
          published_at: node.publishedAt,
          // Twitch serves a placeholder image while the VOD is still processing
          thumbnail_url: node.previewThumbnailURL?.includes('404_processing') ? null : node.previewThumbnailURL ?? null,
          game: node.game?.displayName ?? null,
          url: `https://www.twitch.tv/videos/${node.id}`,
        })),
      }
    : null
  cache.set(key, { at: Date.now(), channel })
  return channel
}
