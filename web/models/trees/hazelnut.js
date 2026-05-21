// models/trees/hazelnut.js — mid-size nut tree.
import { makeTree } from "./_tree.js";
export function buildHazelnut() {
    return makeTree({
        trunkColor: 0x5a4020, trunkRadius: 0.2, trunkHeight: 3.5,
        canopyColor: 0x3a7a1a, canopyRadius: 2.0, canopyHeight: 2.0, canopyY: 4.8,
        fruitColor: 0x8a6a2a, fruitCount: 5,
    });
}
