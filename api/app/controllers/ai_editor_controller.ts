import type { HttpContext } from '@adonisjs/core/http'
import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  streamText,
  tool,
  type UIMessage,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import env from '#start/env'

export default class AiEditorController {
  async chat({ request, response }: HttpContext) {
    const apiKey = env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return response.status(503).json({ error: 'OpenAI API key not configured' })
    }

    const openai = createOpenAI({ apiKey })

    const { messages, editorContext } = request.body() as {
      messages: UIMessage[]
      editorContext: {
        layers: Array<{
          id: string
          name: string
          type: string
          transform: { x: number; y: number; width: number; height: number; rotation?: number }
          style: { opacity: number; blur: number; borderRadius: number }
          visible: boolean
          locked: boolean
        }>
        selectedId: string | null
        currentTime: number
        duration: number
        trimStart: number
        trimEnd: number
      }
    }

    const systemPrompt = `Tu es un assistant IA intégré dans un éditeur vidéo vertical (1080×1920) pour clips Twitch.
Tu aides l'utilisateur à monter ses clips en manipulant les layers, animations et keyframes via des tools.

CONTEXTE ÉDITEUR ACTUEL :
- Layers : ${JSON.stringify(editorContext.layers.map((l) => ({ id: l.id, name: l.name, type: l.type, x: l.transform.x, y: l.transform.y, w: l.transform.width, h: l.transform.height, rotation: l.transform.rotation ?? 0, opacity: l.style.opacity, blur: l.style.blur, borderRadius: l.style.borderRadius, visible: l.visible, locked: l.locked })))}
- Layer sélectionné : ${editorContext.selectedId ?? 'aucun'}
- Playhead : ${editorContext.currentTime.toFixed(2)}s
- Durée : ${editorContext.duration.toFixed(2)}s
- Trim : ${editorContext.trimStart.toFixed(2)}s → ${editorContext.trimEnd.toFixed(2)}s
- Canvas : 1080×1920 (vertical 9:16)

RÈGLES :
- Réponds en français, de façon concise.
- Utilise les tools pour manipuler l'éditeur. Ne décris pas ce que tu vas faire, fais-le directement.
- Tu peux chaîner plusieurs tools dans une réponse.
- Si l'utilisateur demande quelque chose d'ambigu, demande une clarification.
- Pour centrer un layer : x = (1080 - width) / 2, y = (1920 - height) / 2.`

    const editorTools = {
      move_layer: tool({
        description: 'Move a layer to a new position (x, y in canvas coordinates 1080×1920)',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer to move'),
          x: z.number().describe('New X position'),
          y: z.number().describe('New Y position'),
        }),
      }),
      resize_layer: tool({
        description: 'Resize a layer',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer to resize'),
          width: z.number().describe('New width'),
          height: z.number().describe('New height'),
        }),
      }),
      set_opacity: tool({
        description: 'Set the opacity of a layer (0 to 1)',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          opacity: z.number().min(0).max(1).describe('Opacity value'),
        }),
      }),
      set_rotation: tool({
        description: 'Set the rotation of a layer in degrees',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          rotation: z.number().describe('Rotation in degrees (-180 to 180)'),
        }),
      }),
      set_blur: tool({
        description: 'Set the blur amount of a layer in pixels',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          blur: z.number().min(0).describe('Blur in pixels'),
        }),
      }),
      set_border_radius: tool({
        description: 'Set the border radius of a layer in pixels',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          borderRadius: z.number().min(0).describe('Border radius in pixels'),
        }),
      }),
      add_keyframe: tool({
        description: 'Add a keyframe snapshot at a specific time for a layer. Captures current state.',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          time: z.number().describe('Time in seconds for the keyframe'),
        }),
      }),
      remove_keyframe: tool({
        description: 'Remove a keyframe from a layer',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          keyframeId: z.string().describe('ID of the keyframe to remove'),
        }),
      }),
      set_trim: tool({
        description: 'Set the trim start and end times for the clip',
        inputSchema: z.object({
          start: z.number().min(0).describe('Trim start time in seconds'),
          end: z.number().describe('Trim end time in seconds'),
        }),
      }),
      add_animation: tool({
        description: 'Add an entrance or exit animation to a layer',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          type: z.enum([
            'fadeIn', 'fadeOut', 'scaleIn', 'scaleOut', 'bounceIn', 'bounceOut',
            'slideInLeft', 'slideInRight', 'slideInTop', 'slideInBottom',
            'slideOutLeft', 'slideOutRight', 'slideOutTop', 'slideOutBottom',
          ]).describe('Animation type'),
          duration: z.number().min(0.1).max(5).default(0.5).describe('Duration in seconds'),
        }),
      }),
      remove_animation: tool({
        description: 'Remove an animation from a layer',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
          animationId: z.string().describe('ID of the animation to remove'),
        }),
      }),
      select_layer: tool({
        description: 'Select a layer by ID, or null to deselect',
        inputSchema: z.object({
          layerId: z.string().nullable().describe('ID of the layer to select, or null'),
        }),
      }),
      seek: tool({
        description: 'Move the playhead to a specific time',
        inputSchema: z.object({
          time: z.number().min(0).describe('Time in seconds'),
        }),
      }),
      toggle_visibility: tool({
        description: 'Toggle the visibility of a layer',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer'),
        }),
      }),
      remove_layer: tool({
        description: 'Delete a layer',
        inputSchema: z.object({
          layerId: z.string().describe('ID of the layer to remove'),
        }),
      }),
    }

    const modelMessages = await convertToModelMessages(messages)

    const result = streamText({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      messages: modelMessages,
      tools: editorTools,
    })

    pipeUIMessageStreamToResponse({
      response: response.response,
      stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.merge(result.toUIMessageStream())
        },
      }),
    })
  }
}
