// models/trees/fig.js — short, spreading canopy + purple figs.
import { makeTree } from "./_tree.js";
export function buildFig() {
    return makeTree({
        trunkColor: 0x6a5a3a, trunkRadius: 0.15, trunkHeight: 1.5,
        canopyColor: 0x3a7a2a, canopyRadius: 2.0, canopyHeight: 1.4, canopyY: 2.8,
        fruitColor: 0x6a2a5a, fruitCount: 7,
    });
}
