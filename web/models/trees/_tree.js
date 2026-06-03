// models/trees/_tree.js
// Shared tree builder used by every species file that doesn't have
// its own bespoke geometry. Builds:
//   - a tapered trunk + root flare,
//   - four visible primary branches splaying upward,
//   - a canopy made entirely of LEAF PLANES (no sphere blobs!),
//     all merged into a single BufferGeometry,
//   - an optional fruit cluster with unripe + ripe variants that
//     main.js toggles per growth stage.

import * as THREE from "three";
import { buildBranchyCanopy } from "./_canopy.js";

/**
 * @typedef {object} TreeOpts
 * @property {number} trunkColor
 * @property {number} trunkRadius
 * @property {number} trunkHeight
 * @property {number} canopyColor    Base hex colour for leaves.
 * @property {number} canopyRadius   Canopy half-width.
 * @property {number} canopyHeight   Canopy half-height (vertical extent).
 * @property {number} canopyY        Y-position of the canopy centre.
 * @property {number} [fruitColor]   Optional ripe fruit colour.
 * @property {number} [fruitCount]   Optional number of fruits.
 * @property {number} [fruitSize]    Fruit sphere radius (default 0.16).
 * @property {number} [fruitElongation] 1.0 round, 1.4 berry, 1.6 plum-shaped.
 * @property {number} [leafDensity]  Multiplier for the leaf count (default 1).
 * @property {number} [leafSize]     Per-leaf size (default 0.28 m).
 * @property {boolean} [elongatedLeaves]  Long thin leaves (eucalyptus-style).
 */

/**
 * @param {TreeOpts} opts
 * @returns {THREE.Group}
 */
export function makeTree(opts) {
    const g = new THREE.Group();
    const {
        trunkColor, trunkRadius, trunkHeight,
        canopyColor, canopyRadius, canopyHeight, canopyY,
        fruitColor, fruitCount, fruitSize, fruitElongation,
        leafDensity = 1.0, leafSize = 0.28, elongatedLeaves = false,
    } = opts;

    // ── Trunk ────────────────────────────────────────────────────────
    const trunkMat = new THREE.MeshStandardMaterial({
        color: trunkColor, roughness: 0.95, metalness: 0.0,
    });
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(
            trunkRadius * 0.55, trunkRadius * 1.05, trunkHeight, 8
        ),
        trunkMat,
    );
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    g.add(trunk);
    // Root flare
    const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(
            trunkRadius * 0.95, trunkRadius * 1.5, trunkRadius * 0.6, 8
        ),
        trunkMat,
    );
    flare.position.y = trunkRadius * 0.3;
    g.add(flare);

    // ── Canopy: recursive curving branches with leaf clusters ────────
    // Topology adapts to the tree's proportions: broad species (big
    // canopyRadius) get low-springing, wide-splaying, deeply-forked
    // boughs → rounded spreading crowns; narrow species get steeper,
    // shallower branching → upright crowns.
    const broadness = Math.min(1, Math.max(0, (canopyRadius - 1.2) / 1.8)); // 0=narrow, 1=broad
    const branchCount = Math.max(3, Math.min(7, Math.round(3 + canopyRadius * 1.2)));
    const leavesPerCluster = Math.max(38, Math.floor(55 * leafDensity));
    const canopy = buildBranchyCanopy({
        base: new THREE.Vector3(0, trunkHeight - 0.1, 0),
        spread: canopyRadius,
        rise: canopyHeight * 1.5,
        branches: branchCount,
        barkColor: trunkColor,
        leafColor: canopyColor,
        boughRadius: Math.max(0.05, trunkRadius * 0.55),
        leafSize: Math.min(leafSize, 0.17),
        clusterRadius: Math.max(0.42, canopyRadius * 0.40),
        leavesPerCluster,
        aspectW: elongatedLeaves ? 0.4 : 0.9,
        aspectH: elongatedLeaves ? 1.7 : 1.1,
        // Broad trees spring out lower (0.5) + splay wide + fork deeper;
        // narrow trees rise steeply (0.82) + fork shallow.
        startElevation: 0.82 - broadness * 0.32,
        splay: 0.45 + broadness * 0.35,
        depth: canopyRadius > 2.2 ? 3 : 2,
        curve: 0.30,
        upBias: 0.10,
        // Fruit hangs from real twig tips inside the canopy builder, so
        // it's always attached to a branch end (never floating).
        fruitColor,
        fruitCount: fruitCount || 0,
        fruitSize: fruitSize ?? 0.16,
        fruitElongation: fruitElongation ?? 1.0,
    });
    // Branches start at the trunk top (base) and rise into the foliage
    // — no extra offset, so the canopy stays attached to the trunk.
    g.add(canopy);

    return g;
}

/**
 * Legacy positional signature (older one-liner wrappers still use it).
 *   makeTreePositional(trunkColor, trunkRadius, trunkHeight,
 *                      canopyColor, canopyRadius, canopyHeight, canopyY,
 *                      fruitColor?, fruitCount?)
 */
export function makeTreePositional(
    trunkColor, trunkRadius, trunkHeight,
    canopyColor, canopyRadius, canopyHeight, canopyY,
    fruitColor, fruitCount,
) {
    return makeTree({
        trunkColor, trunkRadius, trunkHeight,
        canopyColor, canopyRadius, canopyHeight, canopyY,
        fruitColor, fruitCount,
    });
}
