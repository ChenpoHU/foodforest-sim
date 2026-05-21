// models/trees/mulberry.js — wide canopy, dark berries.
import { makeTree } from "./_tree.js";
export function buildMulberry() {
    return makeTree({
        trunkColor: 0x5a3a1a, trunkRadius: 0.18, trunkHeight: 3,
        canopyColor: 0x3a7a2a, canopyRadius: 2.0, canopyHeight: 1.8, canopyY: 4.2,
        fruitColor: 0x3a1a2a, fruitCount: 8,
    });
}
