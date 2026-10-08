/**
 * A template picked in Montage: one of the 6 built-in layouts, or the id of a
 * template the streamer made in the simple editor.
 */
import type { BrandKit } from "./api";
import type { Layer } from "./editorTypes";
import { buildTemplate, HAS_HOOK, NEEDS_WEBCAM, TEMPLATE_IDS, type TemplateContext, type TemplateId } from "./templates";
import { buildFromSpec, upgradeTemplate, type TemplateSpec } from "./templateSpec";

export type TemplateKey = string;

/** The streamer's own templates, in the current format */
export function customTemplates(kit: BrandKit | null | undefined): TemplateSpec[] {
  return (kit?.templates ?? []).map(upgradeTemplate);
}

export function isBuiltIn(key: TemplateKey): key is TemplateId {
  return (TEMPLATE_IDS as string[]).includes(key);
}

export function findCustom(key: TemplateKey, customs: TemplateSpec[]): TemplateSpec | undefined {
  return customs.find((t) => t.id === key);
}

/** The layout behind a key (unknown keys, e.g. a deleted template, fall back to Signature) */
export function baseOf(key: TemplateKey, customs: TemplateSpec[]): TemplateId {
  return findCustom(key, customs)?.base ?? (isBuiltIn(key) ? key : "signature");
}

export function buildAny(key: TemplateKey, ctx: TemplateContext, customs: TemplateSpec[]): Layer[] {
  const custom = findCustom(key, customs);
  return custom ? buildFromSpec(custom, ctx) : buildTemplate(baseOf(key, customs), ctx);
}

/** The template shows a hook line (Montage's hook input only applies then) */
export function showsHook(key: TemplateKey, customs: TemplateSpec[]): boolean {
  const custom = findCustom(key, customs);
  return custom ? custom.hook.visible : HAS_HOOK.includes(baseOf(key, customs));
}

/** Built-in layouts made around the webcam can't be used without one; custom ones just drop it */
export function needsWebcam(key: TemplateKey, customs: TemplateSpec[]): boolean {
  return !findCustom(key, customs) && NEEDS_WEBCAM.includes(baseOf(key, customs));
}
