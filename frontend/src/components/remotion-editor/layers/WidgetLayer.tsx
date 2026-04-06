import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "../../../lib/editorTypes";
import { getWidgetDef } from "../../editor/widgets/registry";

interface Props {
  layer: Layer;
}

export default function WidgetLayer({ layer }: Props) {
  const { widget, transform } = layer;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  if (!widget) return null;

  const def = getWidgetDef(widget.widgetId);
  if (!def) return null;

  const Component = def.Component;
  return <Component props={widget.props} width={transform.width} height={transform.height} currentTime={currentTime} />;
}
