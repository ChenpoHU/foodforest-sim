// models/trees/pomegranate.js — compact tree, red fruit.
import { makeTree } from "./_tree.js";
export function buildPomegranate() {
    return makeTree({
        trunkColor: 0x5a3a2a, trunkRadius: 0.12, trunkHeight: 1.8,
        canopyColor: 0x3a6a1a, canopyRadius: 1.2, canopyHeight: 1.2, canopyY: 3.0,
        fruitColor: 0xcc2233, fruitCount: 6,
    });
}
