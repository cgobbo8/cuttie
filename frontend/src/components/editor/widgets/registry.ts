import type React from "react";
import type { LayerTransform } from "../../../lib/editorTypes";
import TwitchSubscribe from "./TwitchSubscribe";
import SocialFollow from "./SocialFollow";
import TwitchLiveBanner from "./TwitchLiveBanner";
import ChannelPill from "./ChannelPill";
import { KIT_WIDGETS } from "./kit";

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
  "channel-pill": {
    id: "channel-pill",
    name: "Widget de chaîne",
    description: "Ton logo et twitch.tv/ta-chaîne sur une pastille blanche",
    defaultTransform: { x: 140, y: 1640, width: 800, height: 96 },
    propDefs: [
      { key: "login", label: "Chaîne", type: "text", default: "streamer" },
      { key: "avatarUrl", label: "Logo", type: "image", default: "" },
      { key: "darkColor", label: "Couleur du texte", type: "color", default: "#111317" },
      { key: "lightColor", label: "Fond du logo", type: "color", default: "#F5F5F2" },
    ],
    Component: ChannelPill,
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

/* ── Brand kit widgets (simple template editor) ───────────── */

const BRAND_PROPS: WidgetPropDef[] = [
  { key: "login", label: "Chaîne", type: "text", default: "streamer" },
  { key: "displayName", label: "Nom affiché", type: "text", default: "Streamer" },
  { key: "avatarUrl", label: "Logo", type: "image", default: "" },
  { key: "accent", label: "Couleur principale", type: "color", default: "#3DBE8B" },
  { key: "highlight", label: "Couleur d'accent", type: "color", default: "#FFD21F" },
  { key: "dark", label: "Couleur sombre", type: "color", default: "#111317" },
  { key: "light", label: "Couleur claire", type: "color", default: "#F5F5F2" },
];

const KIT_NAMES: Record<string, [string, string]> = {
  logo: ["Logo", "Ton logo avec un anneau à ta couleur"],
  "channel-name": ["Nom de la chaîne", "Ton nom en grand, souligné"],
  handle: ["twitch.tv/pseudo", "Ton lien Twitch sur une pastille"],
  "live-badge": ["Badge EN DIRECT", "Badge rouge qui pulse"],
  "follow-button": ["Bouton Suivre", "Un curseur clique sur Suivre"],
  "follow-banner": ["Bandeau Suis-moi", "Logo, nom et bouton Suivre"],
  "lower-third": ["Bandeau TV", "Logo, nom et jeu, façon télé"],
  socials: ["Réseaux", "Tes pseudos Twitch, TikTok, YouTube, Instagram"],
  "follower-count": ["Compteur de followers", "Tes followers qui défilent"],
  "clip-sticker": ["Sticker", "Un autocollant penché qui gigote"],
  "corner-logo": ["Logo en coin", "Ton logo discret, façon chaîne télé"],
  "progress-bar": ["Barre de progression", "Avance avec le clip"],
};

for (const w of KIT_WIDGETS) {
  const [name, description] = KIT_NAMES[w.id] ?? [w.id, ""];
  WIDGET_REGISTRY[w.id] = {
    id: w.id,
    name,
    description,
    defaultTransform: { x: w.box.x, y: w.box.y, width: w.box.w, height: w.box.h },
    propDefs: [...BRAND_PROPS, ...w.fields.map((key) => ({ key, label: key, type: "text" as const, default: "" }))],
    Component: w.Component,
  };
}

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
