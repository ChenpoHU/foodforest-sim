// models/trees/corkoak.js — broad oak, no fruit (acorns abstracted).
import { makeTree } from "./_tree.js";
export function buildCorkoak() {
    return makeTree({
        trunkColor: 0x4a3018, trunkRadius: 0.35, trunkHeight: 5,
        canopyColor: 0x2a5a1a, canopyRadius: 3.0, canopyHeight: 2.5, canopyY: 6.5,
    });
}
