import { describe, expect, it } from "vitest";
import { stackLabels } from "./labels";

describe("labels over the live's curve", () => {
  it("keeps far apart labels on one row and moves close ones down", () => {
    expect(stackLabels([100, 500, 900], 200)).toEqual([0, 0, 0]);
    // "Maurice en Roue Libre" right next to "Echec Moto Maurice"
    expect(stackLabels([600, 640, 100], 200)).toEqual([0, 1, 0]);
    expect(stackLabels([300, 320, 340], 200)).toEqual([0, 1, 2]);
    // A third label clear of the first row's last one goes back up
    expect(stackLabels([100, 150, 400], 200)).toEqual([0, 1, 0]);
  });
});
