// models/trees/mango.js — orange tropical fruit, dense canopy.
import { makeTree } from "./_tree.js";
export function buildMango() {
    return makeTree({
        trunkColor: 0x5a4a2a, trunkRadius: 0.25, trunkHeight: 4,
        canopyColor: 0x2a6a1a, canopyRadius: 2.5, canopyHeight: 2.0, canopyY: 5.5,
        fruitColor: 0xee8822, fruitCount: 6,
    });
}
