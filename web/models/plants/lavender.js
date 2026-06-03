// models/plants/lavender.js
// Lavender bush. Small grey-green leaf clump near the ground plus
// vertical flower spikes that go from green-grey (unripe) to deep
// purple at flowering. The "fruits" subgroup here represents the
// flower spikes — same visibility toggle, same UX.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "../trees/_canopy.js";

export function buildLavender() {
    const g = new THREE.Group();

    // Low silvery-green leaf clump.
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, 0.18, 0),
        0.25, 50,
        { ySquash: 0.65, shellBias: 0.45 },
    );
    g.add(buildLeafCloud(leafPositions, {
        leafSize: 0.10,
        sizeJitter: 0.5,
        color: new THREE.Color(0x8a9a78),
        aspectW: 0.35,
        aspectH: 1.5,    // narrow lavender leaf
    }));

    // Thin upright stems holding the flower spikes.
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x6a7a55, roughness: 0.9 });
    const flowerStems = [];
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = 0.13 + (i % 2) * 0.04;
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 0.55, 3), stemMat,
        );
        const sx = Math.cos(a) * r;
        const sz = Math.sin(a) * r;
        stem.position.set(sx, 0.40, sz);
        g.add(stem);
        flowerStems.push([sx, 0.78, sz]);
    }

    // Flower spikes: each is a vertical chain of small flower
    // "buds" so the cluster reads as a lavender spike instead of a
    // single cone. Unripe = silvery-green (pre-bloom), ripe = deep
    // lavender purple.
    const fruitPositions = [];
    for (const [sx, top, sz] of flowerStems) {
        for (let j = 0; j < 5; j++) {
            fruitPositions.push(new THREE.Vector3(
                sx,
                top - j * 0.07,
                sz,
            ));
        }
    }
    g.add(buildFruitCluster(fruitPositions, 0x8855c8, {
        size: 0.035,
        elongation: 1.5,
        unripeColor: 0x8a9a78,
    }));

    return g;
}
