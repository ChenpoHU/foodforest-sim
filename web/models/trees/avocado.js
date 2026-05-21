// models/trees/avocado.js — dark canopy + green fruit.
import { makeTree } from "./_tree.js";
export function buildAvocado() {
    return makeTree({
        trunkColor: 0x5a4a2a, trunkRadius: 0.2, trunkHeight: 3,
        canopyColor: 0x2a6a1a, canopyRadius: 2.0, canopyHeight: 2.0, canopyY: 4.5,
        fruitColor: 0x3a5a1a, fruitCount: 5,
    });
}
