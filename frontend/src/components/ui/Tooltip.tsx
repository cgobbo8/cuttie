import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface Props {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ children, content, side = "top", delayDuration }: Props) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={5}
          className="z-[200] max-w-[220px] rounded-lg bg-zinc-900 border border-white/[0.08] px-3 py-2 text-[11px] text-zinc-300 shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-zinc-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function HintBadge({ tooltip, side }: { tooltip: string; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tooltip content={tooltip} side={side}>
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/[0.06] text-zinc-500 text-[8px] cursor-help shrink-0">
        ?
      </span>
    </Tooltip>
  );
}
