// models/trees/pistachio.js — small Mediterranean nut tree, red drupes.
import { makeTree } from "./_tree.js";
export function buildPistachio() {
    return makeTree({
        trunkColor: 0x6a5a3a, trunkRadius: 0.2, trunkHeight: 3,
        canopyColor: 0x5a8a3a, canopyRadius: 2.0, canopyHeight: 1.5, canopyY: 4.2,
        fruitColor: 0xcc5544, fruitCount: 6,
    });
}
