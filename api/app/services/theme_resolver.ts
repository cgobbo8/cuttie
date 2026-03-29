/**
 * Resolves a theme template + clip edit-env into concrete layers.
 * Mirrors the frontend handleApplyTheme() logic from CanvasEditor/RemotionEditor.
 */

import { randomUUID } from 'node:crypto'
import type { Layer, SubtitleData } from '../../remotion/editorTypes.js'
import type { EditEnvironment } from '#services/edit_env_resolver'

/** Theme layer template — same shape as frontend ThemeLayerTemplate */
export interface ThemeLayerTemplate {
  type: Layer['type']
  name: string
  transform: Layer['transform']
  style: Layer['style']
  videoCrop?: { x: number; y: number; w: number; h: number }
  subtitle?: Omit<SubtitleData, 'words' | 'autoColor'>
  chat?: Omit<Layer['chat'] & {}, 'messages'>
  shape?: Layer['shape']
  asset?: Layer['asset']
  text?: Omit<Layer['text'] & {}, 'content'>
  animations?: Layer['animations']
  keyframes?: Layer['keyframes']
}

interface ResolveOptions {
  /** Clip video src placeholder — will be replaced by presigned URL at render time */
  clipSrc: string
}

export function resolveThemeForClip(
  templates: ThemeLayerTemplate[],
  env: EditEnvironment,
  options: ResolveOptions,
): Layer[] {
  const dc = env.dominant_color
  const autoColor = dc
    ? `#${dc.r.toString(16).padStart(2, '0')}${dc.g.toString(16).padStart(2, '0')}${dc.b.toString(16).padStart(2, '0')}`
    : '#6464C8'

  const layers: Layer[] = []

  for (const tpl of templates) {
    const id = randomUUID()
    const base: Layer = {
      id,
      name: tpl.name,
      type: tpl.type,
      visible: true,
      locked: false,
      transform: { ...tpl.transform },
      style: { ...tpl.style },
    }

    if (tpl.type === 'gameplay') {
      base.video = { src: options.clipSrc }
    } else if (tpl.type === 'facecam') {
      const crop = env.facecam ?? tpl.videoCrop ?? {
        x: Math.round((env.clip_width ?? 1920) * 0.65),
        y: Math.round((env.clip_height ?? 1080) * 0.65),
        w: Math.round(Math.min(env.clip_width ?? 1920, env.clip_height ?? 1080) / 3),
        h: Math.round(Math.min(env.clip_width ?? 1920, env.clip_height ?? 1080) / 3),
      }
      base.video = { src: options.clipSrc, crop }
    } else if (tpl.type === 'subtitles' && tpl.subtitle) {
      base.subtitle = { ...tpl.subtitle, words: env.words ?? [], autoColor } as SubtitleData
    } else if (tpl.type === 'shape' && tpl.shape) {
      base.shape = { ...tpl.shape }
    } else if (tpl.type === 'chat') {
      base.chat = {
        maxVisible: 6,
        fontSize: 28,
        fontFamily: 'Inter',
        showDuration: 5,
        ...tpl.chat,
        messages: env.chat_messages ?? [],
      }
    } else if (tpl.type === 'asset' && tpl.asset) {
      base.asset = { ...tpl.asset }
    } else if (tpl.type === 'text' && tpl.text) {
      base.text = { ...tpl.text, content: '' }
    }

    if (tpl.animations && tpl.animations.length > 0) {
      base.animations = tpl.animations.map((a) => ({ ...a }))
    }
    if (tpl.keyframes && tpl.keyframes.length > 0) {
      base.keyframes = tpl.keyframes.map((k) => ({ ...k }))
    }

    layers.push(base)
  }

  return layers
}
