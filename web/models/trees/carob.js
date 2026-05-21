// models/trees/carob.js — short, dense Mediterranean canopy + brown pods.
import { makeTree } from "./_tree.js";
export function buildCarob() {
    return makeTree({
        trunkColor: 0x3a2a1a, trunkRadius: 0.25, trunkHeight: 3,
        canopyColor: 0x2a5a1a, canopyRadius: 2.0, canopyHeight: 2.0, canopyY: 4.5,
        fruitColor: 0x5a3a1a, fruitCount: 5,
    });
}
