import type { CSSProperties } from "react";

/** Images in kit widgets. Editor side: a plain <img> (the server copy uses Remotion's <Img>). */
export default function WidgetImg({ src, style }: { src: string; style?: CSSProperties }) {
  return <img src={src} alt="" draggable={false} style={style} />;
}
