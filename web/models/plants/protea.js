// models/plants/protea.js
// Protea: a tough leafy shrub with one big star-shaped pink flower
// at the top. The flower is the "fruit" for visibility-toggle
// purposes — unripe is a closed green bud, ripe opens into the
// signature pink head.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "../trees/_canopy.js";

export function buildProtea() {
    const g = new THREE.Group();

    // Single woody stem.
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.9 });
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.06, 1.0, 5), stemMat,
    );
    stem.position.y = 0.5;
    stem.castShadow = true;
    g.add(stem);

    // Broad olive-green leaves around the stem, mostly clustered
    // near the top.
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, 0.7, 0),
        0.30, 60,
        { ySquash: 1.0, shellBias: 0.4 },
    );
    g.add(buildLeafCloud(leafPositions, {
        leafSize: 0.18,
        sizeJitter: 0.5,
        color: new THREE.Color(0x4a6a3a),
        aspectW: 0.7, aspectH: 1.4,
    }));

    // Flower — built as a fruit cluster: a single big position so we
    // get the unripe (green bud) → ripe (pink head) toggle. Pink
    // head is built from a few overlapping fruit spheres to give it
    // the star-shape.
    const flowerCenter = new THREE.Vector3(0, 1.2, 0);
    const petalPoints = [flowerCenter];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        petalPoints.push(new THREE.Vector3(
            flowerCenter.x + Math.cos(a) * 0.15,
            flowerCenter.y + 0.02,
            flowerCenter.z + Math.sin(a) * 0.15,
        ));
    }
    g.add(buildFruitCluster(petalPoints, 0xd64a78, {
        size: 0.12,
        elongation: 0.85,
        unripeColor: 0x6a7a3a,    // closed green bud
    }));

    return g;
}
