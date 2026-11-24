import { describe, expect, it } from "vitest";
import { codecsOf, headerEnd, heldAhead } from "./liveStream";

/** An MP4 box: its size, its name, what it holds */
function box(name: string, ...inside: (Uint8Array | number[])[]): Uint8Array {
  const body = inside.flatMap((part) => [...part]);
  const size = 8 + body.length;
  return new Uint8Array([(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...[...name].map((c) => c.charCodeAt(0)), ...body]);
}
const join = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((part) => [...part]));

// What ffmpeg writes for a 480p rendition of Twitch: H.264 Main 3.1, and AAC
const avcC = box("avcC", [1, 0x4d, 0x40, 0x1f, 0xff, 0xe1]);
const header = (sound = true) => join(box("ftyp", [...Array(20).fill(0)]), box("moov", box("trak", box("avc1", [...Array(8).fill(0)], avcC)), sound ? box("trak", box("mp4a", [0, 0, 0, 0])) : new Uint8Array(0)));

describe("a live's stream read piece by piece", () => {
  it("finds where the header ends once the first fragment has begun, whatever the pieces it comes in", () => {
    const head = header();
    const stream = join(head, box("moof", [1, 2, 3]), box("mdat", [4, 5, 6, 7]));
    expect(headerEnd(stream)).toBe(head.length);
    // Not enough of it yet: the header alone, or the fragment's name cut off
    expect(headerEnd(head)).toBeNull();
    expect(headerEnd(stream.subarray(0, head.length + 7))).toBeNull();
    expect(headerEnd(stream.subarray(0, head.length + 8))).toBe(head.length);
    expect(headerEnd(new Uint8Array(0))).toBeNull();
    // Not an MP4: it never says so
    expect(headerEnd(new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4, 5, 6]))).toBeNull();
  });

  it("says how pictures and sound are coded, the way a player asks", () => {
    expect(codecsOf(header())).toBe("avc1.4d401f, mp4a.40.2");
    expect(codecsOf(header(false))).toBe("avc1.4d401f");
    // Pictures that are not H.264: nothing it can feed the player
    expect(codecsOf(join(box("ftyp", [0, 0, 0, 0]), box("moov", box("hvc1", [1, 2, 3]))))).toBeNull();
  });

  it("knows how far ahead of a time the player holds the stream", () => {
    const ranges = [{ start: 0.04, end: 20 }, { start: 40, end: 55 }];
    expect(heldAhead(ranges, 8)).toBe(12);
    // (the very start: the first picture comes a few hundredths in)
    expect(heldAhead(ranges, 0)).toBe(20);
    expect(heldAhead(ranges, 30)).toBe(0);
    expect(heldAhead(ranges, 41)).toBe(14);
    expect(heldAhead(ranges, 60)).toBe(0);
    expect(heldAhead([], 0)).toBe(0);
  });
});
