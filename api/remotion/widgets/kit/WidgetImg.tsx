import type { CSSProperties } from "react";
import { Img } from "remotion";

/** Images in kit widgets. Server side: Remotion's <Img>, so frames wait until it is loaded. */
export default function WidgetImg({ src, style }: { src: string; style?: CSSProperties }) {
  return <Img src={src} style={style} />;
}
