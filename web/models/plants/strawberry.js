// models/plants/strawberry.js
// Low ground plant: small cluster of dark-green leaf planes hugging
// the ground, plus visible berries that ripen from cream → bright
// red. Real strawberries have trifoliate leaves — we fake the look
// with small leaf planes scattered close to the ground.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "../trees/_canopy.js";

export function buildStrawberry() {
    const g = new THREE.Group();

    // Tiny leaf cluster at ground level, wider than tall.
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.10, 0),
        0.22, 30,
        { ySquash: 0.45, shellBias: 0.4 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.10,
        sizeJitter: 0.45,
        color: new THREE.Color(0x3a7a2e),
    }));

    // Berries — five small fruits scattered around the centre at
    // ground level so they peek out from under the leaves.
    const fruitPositions = [];
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.random() * 0.4;
        const r = 0.10 + Math.random() * 0.07;
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r, 0.06, Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0xd6232a, {
        size: 0.05,
        elongation: 1.4,           // berry-shape, taller than wide
        unripeColor: 0xeae4c4,     // cream/pale yellow when unripe
    }));

    return g;
}
