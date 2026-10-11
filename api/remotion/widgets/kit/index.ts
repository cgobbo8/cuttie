/**
 * The widget kit: brand widgets for the simple template editor. Copied as is to
 * api/remotion/widgets/kit (scripts/sync-remotion.mjs). Names and help texts
 * live in the editor's i18n files (widgets.<id>).
 */
import type { FC } from "react";
import type { KitWidgetProps } from "./shared";
import ChannelName from "./ChannelName";
import ClipSticker from "./ClipSticker";
import CornerLogo from "./CornerLogo";
import FollowBanner from "./FollowBanner";
import FollowButton from "./FollowButton";
import FollowerCount from "./FollowerCount";
import Handle from "./Handle";
import LiveBadge from "./LiveBadge";
import Logo from "./Logo";
import LowerThird from "./LowerThird";
import ProgressBar from "./ProgressBar";
import Socials from "./Socials";

export type KitWidgetId =
  | "logo"
  | "channel-name"
  | "handle"
  | "live-badge"
  | "follow-button"
  | "follow-banner"
  | "lower-third"
  | "socials"
  | "follower-count"
  | "clip-sticker"
  | "corner-logo"
  | "progress-bar";

export type KitEnter = "bounceIn" | "scaleIn" | "fadeIn" | "slideInBottom" | "slideInLeft" | "slideInRight";

export interface KitWidget {
  id: KitWidgetId;
  /** Where it lands on the 1080x1920 frame when added: out of the parts TikTok / Shorts / Reels cover */
  box: { x: number; y: number; w: number; h: number };
  /** When it shows by default */
  timing: "start" | "always" | "end";
  /** How it comes in (null: no entrance, e.g. the progress bar) */
  enter: KitEnter | null;
  /** Texts the streamer can change (everything else comes from the channel) */
  fields: string[];
  Component: FC<KitWidgetProps>;
}

export const KIT_WIDGETS: KitWidget[] = [
  { id: "logo", box: { x: 60, y: 216, w: 190, h: 190 }, timing: "start", enter: "bounceIn", fields: ["shape"], Component: Logo },
  { id: "channel-name", box: { x: 150, y: 1300, w: 780, h: 120 }, timing: "start", enter: "slideInBottom", fields: [], Component: ChannelName },
  { id: "handle", box: { x: 190, y: 1336, w: 700, h: 84 }, timing: "start", enter: "fadeIn", fields: [], Component: Handle },
  { id: "live-badge", box: { x: 60, y: 216, w: 520, h: 84 }, timing: "start", enter: "scaleIn", fields: ["text"], Component: LiveBadge },
  { id: "follow-button", box: { x: 290, y: 1260, w: 500, h: 160 }, timing: "end", enter: "bounceIn", fields: ["text"], Component: FollowButton },
  { id: "follow-banner", box: { x: 150, y: 1210, w: 780, h: 210 }, timing: "start", enter: "slideInBottom", fields: ["text"], Component: FollowBanner },
  { id: "lower-third", box: { x: 40, y: 1270, w: 760, h: 150 }, timing: "start", enter: "slideInLeft", fields: [], Component: LowerThird },
  { id: "socials", box: { x: 290, y: 1100, w: 500, h: 320 }, timing: "end", enter: "fadeIn", fields: ["tiktok", "youtube", "instagram"], Component: Socials },
  { id: "follower-count", box: { x: 320, y: 1310, w: 440, h: 110 }, timing: "start", enter: "scaleIn", fields: ["text"], Component: FollowerCount },
  { id: "clip-sticker", box: { x: 560, y: 216, w: 460, h: 160 }, timing: "start", enter: "bounceIn", fields: ["text"], Component: ClipSticker },
  { id: "corner-logo", box: { x: 950, y: 216, w: 90, h: 90 }, timing: "always", enter: "fadeIn", fields: [], Component: CornerLogo },
  { id: "progress-bar", box: { x: 60, y: 200, w: 960, h: 14 }, timing: "always", enter: null, fields: [], Component: ProgressBar },
];

export const KIT_COMPONENTS: Record<string, FC<KitWidgetProps>> = Object.fromEntries(KIT_WIDGETS.map((w) => [w.id, w.Component]));

export function kitWidget(id: string): KitWidget | undefined {
  return KIT_WIDGETS.find((w) => w.id === id);
}
