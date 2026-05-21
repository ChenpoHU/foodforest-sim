// models/trees/chestnut.js
// Stocky trunk, broad green canopy, brown-husk nuts.
import { makeTree } from "./_tree.js";
export function buildChestnut() {
    return makeTree({
        trunkColor: 0x5c3a1a, trunkRadius: 0.3, trunkHeight: 4,
        canopyColor: 0x2a7a1a, canopyRadius: 2.5, canopyHeight: 2.5, canopyY: 5.5,
        fruitColor: 0x8a5a1a, fruitCount: 6,
    });
}
