import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

let _animUid = 0;
function animUid() {
  return `anim_ai_${++_animUid}_${Date.now().toString(36)}`;
}

export default function AiPanel(props: EditorActions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const executeToolCall = useCallback((tc: ToolCall) => {
    const { toolName, args } = tc;
    switch (toolName) {
      case "move_layer":
        props.commitTransform();
        props.updateTransform(args.layerId as string, { x: args.x as number, y: args.y as number });
        break;
      case "resize_layer":
        props.commitTransform();
        props.updateTransform(args.layerId as string, { width: args.width as number, height: args.height as number });
        break;
      case "set_opacity":
        props.commitTransform();
        props.updateStyle(args.layerId as string, { opacity: args.opacity as number });
        break;
      case "set_rotation":
        props.commitTransform();
        props.updateTransform(args.layerId as string, { rotation: args.rotation as number });
        break;
      case "set_blur":
        props.commitTransform();
        props.updateStyle(args.layerId as string, { blur: args.blur as number });
        break;
      case "set_border_radius":
        props.commitTransform();
        props.updateStyle(args.layerId as string, { borderRadius: args.borderRadius as number });
        break;
      case "add_keyframe": {
        // Seek first, then add keyframe on next tick so currentTime is updated
        const time = args.time as number;
        props.seek(time);
        setTimeout(() => props.addKeyframe(args.layerId as string), 50);
        break;
      }
      case "remove_keyframe":
        props.removeKeyframe(args.layerId as string, args.keyframeId as string);
        break;
      case "set_trim":
        props.onTrimChange(args.start as number, args.end as number);
        break;
      case "add_animation": {
        const anim: LayerAnimation = {
          id: animUid(),
          type: args.type as AnimationType,
          time: 0,
          duration: (args.duration as number) ?? 0.5,
          easing: "easeOut" as EasingPreset,
        };
        props.addAnimation(args.layerId as string, anim);
        break;
      }
      case "remove_animation":
        props.removeAnimation(args.layerId as string, args.animationId as string);
        break;
      case "select_layer":
        props.setSelectedId(args.layerId as string | null);
        break;
      case "seek":
        props.seek(args.time as number);
        break;
      case "toggle_visibility":
        props.toggleVisibility(args.layerId as string);
        break;
      case "remove_layer":
        props.removeLayer(args.layerId as string);
        break;
    }
  }, [props]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const editorContext = {
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

      const res = await fetch("/api/ai/editor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          editorContext,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Parse SSE stream (data: JSON\n\n format)
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const event = JSON.parse(payload) as { type: string; text?: string; toolName?: string; args?: Record<string, unknown> };
            if (event.type === "text" && event.text) {
              assistantText += event.text;
              setMessages([...newMessages, { role: "assistant", content: assistantText }]);
            } else if (event.type === "tool-call" && event.toolName) {
              executeToolCall({ toolName: event.toolName, args: event.args ?? {} });
            }
          } catch {
            // Malformed event — skip
          }
        }
      }

      if (assistantText) {
        setMessages([...newMessages, { role: "assistant", content: assistantText }]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Erreur : ${err instanceof Error ? err.message : "inconnu"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading, props, executeToolCall]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

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
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 bg-white/[0.03] hover:bg-white/[0.06] rounded px-2 py-1.5 text-left transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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
              {msg.content}
            </div>
            {msg.role === "user" && (
              <User className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
            )}
          </div>
        ))}

        {loading && (
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
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
