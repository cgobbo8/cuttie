import { registerRoot, Composition } from "remotion";
import { CuttieComposition } from "./CuttieComposition";
import type { CuttieCompositionProps } from "./CuttieComposition";
import { MontageComposition } from "./MontageComposition";

import { loadClipFonts } from "./fonts";

loadClipFonts();

const defaultLayers: CuttieCompositionProps["layers"] = [];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CuttieVideo"
        component={CuttieComposition}
        durationInFrames={900} // overridden per-render via calculateMetadata
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ layers: defaultLayers }}
      />
      {/* Several pieces one after the other (a clip cut in pieces, a compilation) */}
      <Composition
        id="CuttieMontage"
        component={MontageComposition}
        durationInFrames={900} // overridden per render
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ segments: [], overlays: [] }}
      />
    </>
  );
};

import React from "react";
registerRoot(RemotionRoot);
