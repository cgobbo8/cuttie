import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BrandKit } from "../lib/api";
import { buildAny, customTemplates, defaultTemplateKey, findCustom, type TemplateKey } from "../lib/templateKeys";
import type { TemplateContext } from "../lib/templates";
import TemplateSketch from "./montage/TemplateSketch";

/** The template new projects start with, its name and what it is */
export function useDefaultTemplate(kit: BrandKit | null | undefined): { key: TemplateKey; name: string; desc: string } {
  const { t } = useTranslation();
  return useMemo(() => {
    const customs = customTemplates(kit);
    const key = defaultTemplateKey(kit, customs);
    const custom = findCustom(key, customs);
    return custom
      ? { key, name: custom.name, desc: t("montage.basedOn", { base: t(`montage.template.${custom.base}.name`) }) }
      : { key, name: t(`montage.template.${key}.name`), desc: t(`montage.template.${key}.desc`) };
  }, [kit, t]);
}

interface Props {
  kit: BrandKit;
  templateKey: TemplateKey;
  /** Still frame of a clip or of the live (16:9) */
  frameUrl: string | null;
  login: string | null;
  avatarUrl: string | null;
  /** For the brand widgets */
  displayName?: string | null;
  followers?: number | null;
  /** A few words for the subtitles */
  sample: string[];
  hook: string;
  className?: string;
}

/**
 * A template on a still of the streamer's live, as wide as its box: the same
 * layers as the render, at the clip's first seconds (its cover).
 */
export default function TemplatePreview({ kit, templateKey, frameUrl, login, avatarUrl, displayName, followers, sample, hook, className = "" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layers = useMemo(() => {
    const cam = kit.facecam || null;
    const ctx: TemplateContext = {
      src: "",
      backgroundSrc: "",
      frameW: cam?.ref_w || 1920,
      frameH: cam?.ref_h || 1080,
      facecam: cam ? { x: cam.x, y: cam.y, w: cam.w, h: cam.h } : null,
      words: [],
      startAt: 0,
      endAt: 30,
      colors: kit.colors,
      subtitleStyle: kit.subtitles.style,
      widget: kit.widget,
      login,
      avatarUrl,
      displayName,
      followers,
      hook,
    };
    return buildAny(templateKey, ctx, customTemplates(kit));
  }, [kit, templateKey, login, avatarUrl, displayName, followers, hook]);

  return (
    <div ref={box} className={`relative aspect-[9/16] overflow-hidden bg-black ${className}`}>
      {width > 0 && <TemplateSketch layers={layers} frameUrl={frameUrl} width={width} sample={sample} at={1.5} />}
    </div>
  );
}
