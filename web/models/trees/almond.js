// models/trees/almond.js — pale-cream almond fruit, light-green canopy.
import { makeTree } from "./_tree.js";
export function buildAlmond() {
    return makeTree({
        trunkColor: 0x6a5a3a, trunkRadius: 0.15, trunkHeight: 3,
        canopyColor: 0x5a8a3a, canopyRadius: 1.8, canopyHeight: 1.5, canopyY: 4.2,
        fruitColor: 0xeeddcc, fruitCount: 6,
    });
}
