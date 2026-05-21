// models/trees/macadamia.js — sub-tropical nut tree.
import { makeTree } from "./_tree.js";
export function buildMacadamia() {
    return makeTree({
        trunkColor: 0x5a4a2a, trunkRadius: 0.25, trunkHeight: 4,
        canopyColor: 0x2a6a2a, canopyRadius: 2.2, canopyHeight: 2.2, canopyY: 5.5,
        fruitColor: 0xddccaa, fruitCount: 5,
    });
}
