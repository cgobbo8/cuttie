import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "../editorTypes";
import TwitchSubscribe from "./TwitchSubscribe";
import TwitchLiveBanner from "./TwitchLiveBanner";
import SocialFollow from "./SocialFollow";

const WIDGET_COMPONENTS: Record<string, React.FC<{ props: Record<string, unknown>; width: number; height: number; currentTime?: number }>> = {
  "twitch-subscribe": TwitchSubscribe,
  "twitch-live-banner": TwitchLiveBanner,
  "social-follow": SocialFollow,
};

interface Props {
  layer: Layer;
}

export default function WidgetLayer({ layer }: Props) {
  const { widget, transform } = layer;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  if (!widget) return null;

  const Component = WIDGET_COMPONENTS[widget.widgetId];
  if (!Component) return null;

  return <Component props={widget.props} width={transform.width} height={transform.height} currentTime={currentTime} />;
}
