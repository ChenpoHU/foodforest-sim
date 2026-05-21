// models/trees/plum.js — small understory tree, purple fruit.
import { makeTree } from "./_tree.js";
export function buildPlum() {
    return makeTree({
        trunkColor: 0x5a3a2a, trunkRadius: 0.12, trunkHeight: 2,
        canopyColor: 0x3a7a2a, canopyRadius: 1.5, canopyHeight: 1.5, canopyY: 3.2,
        fruitColor: 0x6622aa, fruitCount: 7,
    });
}
