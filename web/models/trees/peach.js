// models/trees/peach.js — peachy fruit, light-green canopy.
import { makeTree } from "./_tree.js";
export function buildPeach() {
    return makeTree({
        trunkColor: 0x5a3a2a, trunkRadius: 0.14, trunkHeight: 2.5,
        canopyColor: 0x5aaa5a, canopyRadius: 1.8, canopyHeight: 1.6, canopyY: 3.8,
        fruitColor: 0xffaa88, fruitCount: 8,
    });
}
