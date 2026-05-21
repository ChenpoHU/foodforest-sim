// models/trees/cherry.js
// Sakura cherry. Slim dark trunk + flat-ish canopy of soft-pink
// petal-leaf planes (NO sphere blobs). Cherries ripen from green
// to deep red.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "./_canopy.js";

export function buildCherry() {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x3a2218, roughness: 0.96 });

    // Slim dark trunk + two visible side branches
    const trunkH = 3.5;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, trunkH, 8), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    for (const side of [-1, 1]) {
        const br = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.10, 1.4, 6), barkMat,
        );
        br.position.set(side * 0.45, trunkH + 0.2, 0);
        br.rotation.z = side * -0.7;
        br.castShadow = true;
        g.add(br);
    }

    // Canopy — light pink "petal-leaf" cloud, wider than tall
    const canopyY = trunkH + 0.8;
    const canopyRadius = 2.0;
    const canopyHeightHalf = 1.2;
    const leafCount = 600;
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, canopyY, 0),
        canopyRadius, leafCount,
        { ySquash: canopyHeightHalf / canopyRadius, shellBias: 0.5 },
    );
    const canopy = buildLeafCloud(leafPositions, {
        leafSize: 0.22,
        sizeJitter: 0.5,
        color: new THREE.Color(0xf3c2d6), // soft sakura pink
    });
    g.add(canopy);

    // Cherries: green unripe → deep red ripe
    const fruitPositions = [];
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        const r = canopyRadius * (0.7 + Math.random() * 0.25);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            canopyY + (Math.random() - 0.5) * canopyHeightHalf * 1.3,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0xc81b2a, {
        size: 0.09,
        unripeColor: 0x6aaa44,
    }));

    return g;
}
