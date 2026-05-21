// models/trees/walnut.js
// Walnut (Juglans). Tall straight trunk + 4 visible primary branches
// + dense deep-green LEAF CLOUD (no sphere blobs). Husk-coloured
// walnuts on the canopy edge.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "./_canopy.js";

export function buildWalnut() {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x402612, roughness: 0.96 });

    // Trunk
    const trunkH = 5.5;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.30, 0.42, trunkH, 10), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.65, 0.5, 10), barkMat,
    );
    flare.position.y = 0.25; flare.castShadow = true; g.add(flare);

    // Primary branches splaying upward + outward
    const branchCount = 4;
    const branchBaseY = trunkH;
    const branchLen = 1.6;
    for (let i = 0; i < branchCount; i++) {
        const a = (i / branchCount) * Math.PI * 2 + 0.5;
        const dir = Math.cos(a), dirZ = Math.sin(a);
        const branch = new THREE.Mesh(
            new THREE.CylinderGeometry(0.10, 0.18, branchLen, 6), barkMat,
        );
        branch.position.set(dir * 0.45, branchBaseY + branchLen * 0.4, dirZ * 0.45);
        branch.rotation.z = -dir * 0.55;
        branch.rotation.x = dirZ * 0.55;
        branch.castShadow = true;
        g.add(branch);
    }

    // Canopy — dense deep-green leaf cloud
    const canopyY = trunkH + 1.7;
    const canopyRadius = 2.6;
    const canopyHeightHalf = 1.8;
    const leafCount = 700;
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, canopyY, 0),
        canopyRadius, leafCount,
        { ySquash: canopyHeightHalf / canopyRadius, shellBias: 0.50 },
    );
    const canopy = buildLeafCloud(leafPositions, {
        leafSize: 0.32,
        sizeJitter: 0.5,
        color: new THREE.Color(0x244e1b),
    });
    g.add(canopy);

    // Walnuts: green husk (unripe) → russet-brown (ripe)
    const fruitPositions = [];
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
        const r = canopyRadius * (0.65 + Math.random() * 0.25);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            canopyY + (Math.random() - 0.5) * canopyHeightHalf * 1.3,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0x6a4622, {
        size: 0.16,
        unripeColor: 0x4a6a2a,
    }));

    return g;
}
