import type React from "react";
import type { LayerTransform } from "../../../lib/editorTypes";
import TwitchSubscribe from "./TwitchSubscribe";
import SocialFollow from "./SocialFollow";
import TwitchLiveBanner from "./TwitchLiveBanner";

/* ── Widget prop schema ──────────────────────────────────── */

export interface WidgetPropDef {
  key: string;
  label: string;
  type: "text" | "color" | "select" | "image";
  default: string;
  options?: { value: string; label: string }[];
}

/* ── Widget definition ───────────────────────────────────── */

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  defaultTransform: LayerTransform;
  propDefs: WidgetPropDef[];
  Component: React.FC<{ props: Record<string, unknown>; width: number; height: number; currentTime?: number }>;
}

/* ── Registry ────────────────────────────────────────────── */

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  "twitch-subscribe": {
    id: "twitch-subscribe",
    name: "Twitch Subscribe",
    description: "Carte d'abonnement Twitch avec nom du streamer",
    defaultTransform: { x: 290, y: 860, width: 500, height: 140 },
    propDefs: [
      { key: "streamerName", label: "Nom du streamer", type: "text", default: "streamer" },
    ],
    Component: TwitchSubscribe,
  },
  "twitch-live-banner": {
    id: "twitch-live-banner",
    name: "Twitch Live Banner",
    description: "Bannière \"EN LIVE SUR\" avec URL et logo",
    defaultTransform: { x: 90, y: 1350, width: 900, height: 220 },
    propDefs: [
      { key: "streamerName", label: "Nom du streamer", type: "text", default: "streamer" },
      { key: "logoUrl", label: "Logo du streamer", type: "image", default: "" },
    ],
    Component: TwitchLiveBanner,
  },
  "social-follow": {
    id: "social-follow",
    name: "Social Follow",
    description: "Badge \"Follow\" avec choix de plateforme",
    defaultTransform: { x: 290, y: 860, width: 500, height: 120 },
    propDefs: [
      {
        key: "platform",
        label: "Plateforme",
        type: "select",
        default: "twitch",
        options: [
          { value: "twitch", label: "Twitch" },
          { value: "youtube", label: "YouTube" },
          { value: "tiktok", label: "TikTok" },
          { value: "kick", label: "Kick" },
        ],
      },
      { key: "username", label: "Nom d'utilisateur", type: "text", default: "username" },
    ],
    Component: SocialFollow,
  },
};

/** Get widget definition by id, or null if not found. */
export function getWidgetDef(widgetId: string): WidgetDefinition | null {
  return WIDGET_REGISTRY[widgetId] ?? null;
}

/** Build default props from a widget definition. */
export function buildDefaultProps(def: WidgetDefinition): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const p of def.propDefs) {
    props[p.key] = p.default;
  }
  return props;
}
