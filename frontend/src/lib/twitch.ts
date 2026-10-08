/** What the streamer typed or pasted as their channel */
export type LoginInput =
  | { kind: "empty" }
  | { kind: "login"; login: string }
  /** A link to a video, not to a channel */
  | { kind: "vod" }
  | { kind: "invalid" };

const LOGIN = /^[a-z0-9_]{2,25}$/;

/** "Falkarst", "@falkarst", "twitch.tv/falkarst/videos", "https://www.twitch.tv/falkarst" -> "falkarst" */
export function parseTwitchLogin(input: string): LoginInput {
  let value = input.trim();
  if (!value) return { kind: "empty" };

  const link = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]*)(?:\/([^/?#\s]*))?/i);
  if (link) {
    if (link[1].toLowerCase() === "videos") return { kind: "vod" };
    value = link[1];
  }
  const login = value.replace(/^@/, "").toLowerCase();
  return LOGIN.test(login) ? { kind: "login", login } : { kind: "invalid" };
}

/** Start of a valid key, per provider */
export const KEY_PREFIX = { groq_api_key: "gsk_", openrouter_api_key: "sk-or-" } as const;

export function keyLooksRight(name: keyof typeof KEY_PREFIX, value: string): boolean {
  return value.trim().startsWith(KEY_PREFIX[name]);
}
