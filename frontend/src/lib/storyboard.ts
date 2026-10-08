import type { CSSProperties } from "react";
import type { TwitchStoryboard } from "./api";

/** CSS showing frame `index` of a Twitch seek-preview sprite sheet */
export function tileStyle(sb: TwitchStoryboard, index: number): CSSProperties {
  const perSheet = sb.cols * sb.rows;
  const i = Math.min(Math.max(0, Math.round(index)), sb.count - 1);
  const cell = i % perSheet;
  const col = cell % sb.cols;
  const row = Math.floor(cell / sb.cols);
  return {
    backgroundImage: `url("${sb.images[Math.floor(i / perSheet)] ?? sb.images[0]}")`,
    backgroundSize: `${sb.cols * 100}% ${sb.rows * 100}%`,
    backgroundPosition: `${sb.cols > 1 ? (col / (sb.cols - 1)) * 100 : 0}% ${sb.rows > 1 ? (row / (sb.rows - 1)) * 100 : 0}%`,
  };
}

/** Frame index closest to a time of the VOD */
export function frameAt(sb: TwitchStoryboard, seconds: number): number {
  return Math.min(sb.count - 1, Math.max(0, Math.floor(seconds / Math.max(sb.interval, 1))));
}

/** `count` frames spread evenly across the VOD */
export function evenFrames(sb: TwitchStoryboard, count: number): number[] {
  return Array.from({ length: count }, (_, k) => Math.round(((k + 0.5) * sb.count) / count));
}
