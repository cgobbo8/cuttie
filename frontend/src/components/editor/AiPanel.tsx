import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { Layer, LayerAnimation, AnimationType, EasingPreset } from "../../lib/editorTypes";

interface EditorActions {
  layers: Layer[];
  selectedId: string | null;
  currentTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  updateTransform: (id: string, patch: Partial<Layer["transform"]>) => void;
  updateStyle: (id: string, patch: Partial<Layer["style"]>) => void;
  commitTransform: () => void;
  setSelectedId: (id: string | null) => void;
  seek: (t: number) => void;
  addKeyframe: (layerId: string) => void;
  removeKeyframe: (layerId: string, kfId: string) => void;
  addAnimation: (layerId: string, anim: LayerAnimation) => void;
  removeAnimation: (layerId: string, animId: string) => void;
  toggleVisibility: (id: string) => void;
  removeLayer: (id: string) => void;
  onTrimChange: (start: number, end: number) => void;
}

let _animUid = 0;
function animUid() {
  return `anim_ai_${++_animUid}_${Date.now().toString(36)}`;
}

function buildEditorContext(props: EditorActions) {
  return {
    layers: props.layers.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      transform: l.transform,
      style: { opacity: l.style.opacity, blur: l.style.blur, borderRadius: l.style.borderRadius },
      visible: l.visible,
      locked: l.locked,
    })),
    selectedId: props.selectedId,
    currentTime: props.currentTime,
    duration: props.duration,
    trimStart: props.trimStart,
    trimEnd: props.trimEnd,
  };
}

export default function AiPanel(props: EditorActions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  // Keep a ref to the latest editor context so the transport body reads fresh values
  const editorContextRef = useRef(buildEditorContext(props));
  useEffect(() => {
    editorContextRef.current = buildEditorContext(props);
  });

  // Stable ref for editor actions (avoids stale closures in onToolCall)
  const propsRef = useRef(props);
  propsRef.current = props;

  // Transport with dynamic body via function
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/editor/chat",
        credentials: "include",
        body: () => ({ editorContext: editorContextRef.current }),
      }),
  );

  const executeToolCall = useCallback((toolName: string, input: Record<string, unknown>) => {
    const p = propsRef.current;
    switch (toolName) {
      case "move_layer":
        p.commitTransform();
        p.updateTransform(input.layerId as string, { x: input.x as number, y: input.y as number });
        break;
      case "resize_layer":
        p.commitTransform();
        p.updateTransform(input.layerId as string, { width: input.width as number, height: input.height as number });
        break;
      case "set_opacity":
        p.commitTransform();
        p.updateStyle(input.layerId as string, { opacity: input.opacity as number });
        break;
      case "set_rotation":
        p.commitTransform();
        p.updateTransform(input.layerId as string, { rotation: input.rotation as number });
        break;
      case "set_blur":
        p.commitTransform();
        p.updateStyle(input.layerId as string, { blur: input.blur as number });
        break;
      case "set_border_radius":
        p.commitTransform();
        p.updateStyle(input.layerId as string, { borderRadius: input.borderRadius as number });
        break;
      case "add_keyframe": {
        const time = input.time as number;
        p.seek(time);
        setTimeout(() => propsRef.current.addKeyframe(input.layerId as string), 50);
        break;
      }
      case "remove_keyframe":
        p.removeKeyframe(input.layerId as string, input.keyframeId as string);
        break;
      case "set_trim":
        p.onTrimChange(input.start as number, input.end as number);
        break;
      case "add_animation": {
        const anim: LayerAnimation = {
          id: animUid(),
          type: input.type as AnimationType,
          time: 0,
          duration: (input.duration as number) ?? 0.5,
          easing: "easeOut" as EasingPreset,
        };
        p.addAnimation(input.layerId as string, anim);
        break;
      }
      case "remove_animation":
        p.removeAnimation(input.layerId as string, input.animationId as string);
        break;
      case "select_layer":
        p.setSelectedId(input.layerId as string | null);
        break;
      case "seek":
        p.seek(input.time as number);
        break;
      case "toggle_visibility":
        p.toggleVisibility(input.layerId as string);
        break;
      case "remove_layer":
        p.removeLayer(input.layerId as string);
        break;
    }
  }, []);

  const { messages, sendMessage, addToolOutput, status } = useChat({
    transport,
    onToolCall: async ({ toolCall }) => {
      executeToolCall(toolCall.toolName, toolCall.input as Record<string, unknown>);
      addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: "done",
      });
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage({ text });
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-purple-400" />
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          AI Assistant
        </h4>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8">
            <Bot className="w-8 h-8 text-zinc-700" />
            <p className="text-[11px] text-zinc-600 text-center leading-relaxed max-w-[180px]">
              Demande-moi de déplacer, redimensionner, animer ou modifier tes layers.
            </p>
            <div className="flex flex-col gap-1 mt-2 w-full">
              {[
                "Centre la facecam",
                "Ajoute un fondu entrant sur tous les layers",
                "Réduis l'opacité du gameplay à 80%",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 bg-white/[0.03] hover:bg-white/[0.06] rounded px-2 py-1.5 text-left transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          // Extract text from parts
          const text = msg.parts
            ?.filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("") || "";

          if (!text && msg.role === "assistant") return null;

          return (
            <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <Bot className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              )}
              <div
                className={`max-w-[85%] text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5 ${
                  msg.role === "user"
                    ? "bg-purple-500/20 text-zinc-200"
                    : "bg-white/[0.04] text-zinc-400"
                }`}
              >
                {msg.role === "user"
                  ? msg.parts?.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("") || ""
                  : text}
              </div>
              {msg.role === "user" && (
                <User className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex gap-2 items-center">
            <Bot className="w-4 h-4 text-purple-400 shrink-0" />
            <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/[0.06] p-2">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Demande quelque chose..."
            rows={1}
            className="flex-1 text-[11px] bg-white/[0.04] text-zinc-300 rounded-lg px-2.5 py-2 border border-white/[0.06] outline-none focus:border-purple-500/30 resize-none placeholder:text-zinc-600"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
