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
import {
    generateCanopyPoints,
    buildLeafCloud,
    buildFruitCluster,
} from "./_canopy.js";

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

    // ── Visible primary branches ─────────────────────────────────────
    // Without sphere blobs, the canopy structure needs real branches
    // poking into it; otherwise leaves would float on top of a bare
    // pole. Four branches around the trunk reaching up into the
    // canopy give it solidity.
    const branchCount = 4;
    for (let i = 0; i < branchCount; i++) {
        const a = (i / branchCount) * Math.PI * 2 + 0.5;
        const branchLen = canopyRadius * 0.75;
        const branch = new THREE.Mesh(
            new THREE.CylinderGeometry(
                trunkRadius * 0.20, trunkRadius * 0.45, branchLen, 6
            ),
            trunkMat,
        );
        const dir = Math.cos(a), dirZ = Math.sin(a);
        branch.position.set(
            dir * canopyRadius * 0.3,
            trunkHeight + branchLen * 0.35,
            dirZ * canopyRadius * 0.3,
        );
        branch.rotation.z = -dir * 0.65;
        branch.rotation.x = dirZ * 0.65;
        branch.castShadow = true;
        g.add(branch);
    }

    // ── Canopy: leaves only ──────────────────────────────────────────
    // Density tuned by canopy volume so small trees aren't sparse
    // and big trees aren't ludicrously expensive. ~80 leaves per
    // canopyRadius² unit, scaled by canopyHeight ratio.
    const ySquash = canopyHeight / canopyRadius;
    const leafCount = Math.max(40, Math.floor(
        canopyRadius * canopyRadius * ySquash * 80 * leafDensity
    ));
    const center = new THREE.Vector3(0, canopyY, 0);
    const leafPositions = generateCanopyPoints(center, canopyRadius, leafCount, {
        ySquash,
        shellBias: 0.55,
    });
    const canopy = buildLeafCloud(leafPositions, {
        leafSize,
        sizeJitter: 0.5,
        color: canopyColor,
        aspectW: elongatedLeaves ? 0.45 : 1.0,
        aspectH: elongatedLeaves ? 1.6  : 1.0,
    });
    g.add(canopy);

    // ── Fruits ────────────────────────────────────────────────────────
    if (fruitColor !== undefined && fruitCount) {
        const fruitPositions = [];
        for (let i = 0; i < fruitCount; i++) {
            const a = (i / fruitCount) * Math.PI * 2 + Math.random() * 0.3;
            const r = canopyRadius * (0.7 + Math.random() * 0.25);
            fruitPositions.push(new THREE.Vector3(
                Math.cos(a) * r,
                canopyY + (Math.random() - 0.5) * canopyHeight * 0.7,
                Math.sin(a) * r,
            ));
        }
        const fruits = buildFruitCluster(fruitPositions, fruitColor, {
            size: fruitSize ?? 0.16,
            elongation: fruitElongation ?? 1.0,
        });
        g.add(fruits);
    }

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
