/**
 * A live's video played as it comes from the app (see api/app/services/live_watch.ts): an MP4
 * written in fragments, read piece by piece and fed to the player (Media Source). Handed to a
 * player as a plain file, such a stream cannot be moved in at all; fed this way, the player goes
 * back and forth in what it holds, and only what is wanted ahead is read.
 */

/** Seconds read ahead of where the player is, and kept behind it */
const AHEAD = 50;
const BEHIND = 75;
/** A header longer than this is not one */
const LONGEST_HEADER = 2_000_000;

const name = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/**
 * Where a stream's header ends: the place of its first fragment (`moof`). Null while not enough
 * of it has come to tell.
 */
export function headerEnd(bytes: Uint8Array): number | null {
  let at = 0;
  while (at + 8 <= bytes.length) {
    const size = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    if (name(bytes, at + 4) === "moof") return at;
    if (size < 8) return null;
    at += size;
  }
  return null;
}

const find = (bytes: Uint8Array, what: string): number => {
  for (let at = 0; at + 4 <= bytes.length; at++) if (name(bytes, at) === what) return at;
  return -1;
};

/**
 * How a stream's pictures and sound are coded, as a player wants it said (« avc1.4d401f,
 * mp4a.40.2 »), read in its header. Null: pictures this player cannot be fed (not H.264).
 */
export function codecsOf(header: Uint8Array): string | null {
  const config = find(header, "avcC");
  // (the box's name, its version, then profile, compatibility and level: the three bytes a player asks for)
  if (config < 0 || config + 8 > header.length) return null;
  const hex = (byte: number) => byte.toString(16).padStart(2, "0");
  const pictures = `avc1.${hex(header[config + 5])}${hex(header[config + 6])}${hex(header[config + 7])}`;
  return find(header, "mp4a") >= 0 ? `${pictures}, mp4a.40.2` : pictures;
}

/** How far ahead of a time what a player holds goes, seconds (0: it does not hold that time) */
export function heldAhead(ranges: { start: number; end: number }[], at: number): number {
  // (the very start of a stream: its first picture may come a few hundredths in)
  const range = ranges.find((one) => at >= one.start - 0.15 && at <= one.end);
  return range ? Math.max(0, range.end - at) : 0;
}

const rangesOf = (buffered: TimeRanges) => Array.from({ length: buffered.length }, (_, k) => ({ start: buffered.start(k), end: buffered.end(k) }));

/** Whether a player holds a time of its stream with a little after it: it can go there at once */
export const holds = (video: HTMLVideoElement, at: number): boolean => heldAhead(rangesOf(video.buffered), at) > 0.25;

export interface LiveStream {
  /** Nothing more is read, the player is let go of */
  stop: () => void;
}

/**
 * A stream fed to a player. `grown`: the player holds more of it (what it waits for may be
 * there); `failed`: it could not be read or played. Reading waits while the player holds enough
 * ahead of where it is (or of `wanted()`, a time it is about to go to), and what is far behind
 * is let go.
 */
export function playStream(video: HTMLVideoElement, url: string, on: { grown: () => void; failed: () => void; wanted?: () => number | null }): LiveStream {
  const abort = new AbortController();
  let address: string | null = null;
  let stopped = false;
  const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const settled = (buffer: SourceBuffer) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        buffer.removeEventListener("updateend", done);
        buffer.removeEventListener("error", wrong);
        resolve();
      };
      const wrong = () => {
        buffer.removeEventListener("updateend", done);
        buffer.removeEventListener("error", wrong);
        reject(new Error("the player refused a piece of the stream"));
      };
      buffer.addEventListener("updateend", done);
      buffer.addEventListener("error", wrong);
    });

  const run = async () => {
    if (typeof MediaSource === "undefined") throw new Error("no Media Source here");
    const answer = await fetch(url, { signal: abort.signal });
    if (!answer.ok || !answer.body) throw new Error(`stream refused (${answer.status})`);
    const reader = answer.body.getReader();

    // The header first: it says how the stream is coded, which the player has to be told before anything
    let head = new Uint8Array(0);
    let cut: number | null = null;
    while (cut === null) {
      const { value, done } = await reader.read();
      if (done || head.length > LONGEST_HEADER) throw new Error("a stream with no header");
      const more = new Uint8Array(head.length + value.length);
      more.set(head);
      more.set(value, head.length);
      head = more;
      cut = headerEnd(head);
    }
    const codecs = codecsOf(head.subarray(0, cut));
    const kind = `video/mp4; codecs="${codecs}"`;
    if (!codecs || !MediaSource.isTypeSupported(kind)) throw new Error(`a stream this player cannot read (${codecs})`);

    const source = new MediaSource();
    address = URL.createObjectURL(source);
    video.src = address;
    await new Promise<void>((resolve) => source.addEventListener("sourceopen", () => resolve(), { once: true }));
    if (stopped) return;
    const buffer = source.addSourceBuffer(kind);

    // What is far behind the player is let go, so that hours of watching do not pile up
    const trim = async () => {
      if (buffer.buffered.length === 0 || buffer.updating) return;
      const first = buffer.buffered.start(0);
      if (video.currentTime - first < BEHIND + 30) return;
      buffer.remove(first, video.currentTime - BEHIND);
      await settled(buffer);
    };
    const feed = async (bytes: Uint8Array) => {
      for (let tries = 0; ; tries++) {
        try {
          buffer.appendBuffer(bytes as BufferSource);
          break;
        } catch (err) {
          // Full: room is made behind, and it is tried again
          if (!(err instanceof DOMException) || err.name !== "QuotaExceededError" || tries >= 4) throw err;
          await trim();
          await pause(600);
        }
      }
      await settled(buffer);
    };

    await feed(head);
    on.grown();
    for (;;) {
      // Enough ahead of the player (or of where it is about to go): reading waits
      while (!stopped && heldAhead(rangesOf(video.buffered), on.wanted?.() ?? video.currentTime) > AHEAD) await pause(350);
      if (stopped) return;
      const { value, done } = await reader.read();
      if (stopped) return;
      if (done) break;
      await feed(value);
      await trim();
      on.grown();
    }
    if (source.readyState === "open") source.endOfStream();
  };

  run().catch(() => {
    if (!stopped) on.failed();
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      abort.abort();
      if (address) URL.revokeObjectURL(address);
    },
  };
}
