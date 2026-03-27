import { registerRoot, Composition, staticFile } from "remotion";
import { CuttieComposition } from "./CuttieComposition";
import type { CuttieCompositionProps } from "./CuttieComposition";

// Load Luckiest Guy font for Remotion's headless Chrome renderer
const fontFace = new FontFace(
  "Luckiest Guy",
  `url(${staticFile("fonts/LuckiestGuy-Regular.ttf")})`,
  { style: "normal", weight: "400" }
);
fontFace.load().then((ff) => {
  document.fonts.add(ff);
});

const defaultLayers: CuttieCompositionProps["layers"] = [];

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="CuttieVideo"
      component={CuttieComposition}
      durationInFrames={900} // overridden per-render via calculateMetadata
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ layers: defaultLayers }}
    />
  );
};

import React from "react";
registerRoot(RemotionRoot);
