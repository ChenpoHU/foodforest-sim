// models/trees/persimmon.js — bright-orange fruit, medium tree.
import { makeTree } from "./_tree.js";
export function buildPersimmon() {
    return makeTree({
        trunkColor: 0x5a3a1a, trunkRadius: 0.15, trunkHeight: 3,
        canopyColor: 0x4a7a2a, canopyRadius: 1.8, canopyHeight: 1.8, canopyY: 4.2,
        fruitColor: 0xee6622, fruitCount: 5,
    });
}
