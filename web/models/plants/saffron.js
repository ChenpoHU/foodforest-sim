// models/plants/saffron.js
// Saffron crocus. Narrow grass-like leaves at ground level + three
// small magenta flower heads on thin stalks. The flower acts as the
// "fruit" — unripe = green bud, ripe = magenta crocus.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "../trees/_canopy.js";

export function buildSaffron() {
    const g = new THREE.Group();

    // Grass-like blade cluster
    const blades = generateCanopyPoints(
        new THREE.Vector3(0, 0.18, 0),
        0.10, 18,
        { ySquash: 1.6, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(blades, {
        leafSize: 0.20,
        sizeJitter: 0.4,
        color: new THREE.Color(0x4a7a3a),
        aspectW: 0.10, aspectH: 1.8,
    }));

    // Three flower stalks
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 0.85 });
    const flowerPositions = [];
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sx = Math.cos(a) * 0.06;
        const sz = Math.sin(a) * 0.06;
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.008, 0.008, 0.40, 3), stemMat,
        );
        stem.position.set(sx, 0.20, sz);
        g.add(stem);
        flowerPositions.push(new THREE.Vector3(sx, 0.42, sz));
    }
    g.add(buildFruitCluster(flowerPositions, 0xa634a6, {
        size: 0.045,
        elongation: 1.2,
        unripeColor: 0x5a7a3a,
    }));

    return g;
}
