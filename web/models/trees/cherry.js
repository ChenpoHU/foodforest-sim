// models/trees/cherry.js
// Sakura cherry. Slim dark trunk + branch-and-leaf crown in soft
// sakura pink. Cherries ripen green → deep red.

import * as THREE from "three";
import { buildBranchyCanopy, buildFruitCluster } from "./_canopy.js";

export function buildCherry() {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x3a2218, roughness: 0.96 });

    const trunkH = 3.5;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, trunkH, 8), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);

    // Cherry topology: a vase/fan shape — boughs sweep upward and out,
    // curling skyward (high upBias) into a soft rounded blossom crown.
    g.add(buildBranchyCanopy({
        base: new THREE.Vector3(0, trunkH - 0.1, 0),
        spread: 2.0, rise: 1.8, branches: 5,
        barkColor: 0x3a2218, leafColor: 0xf3c2d6, // soft sakura pink
        boughRadius: 0.11, leafSize: 0.15,
        clusterRadius: 0.8, leavesPerCluster: 80,
        startElevation: 0.7, splay: 0.5, depth: 3, curve: 0.3, upBias: 0.2,
    }));

    // Cherries: green unripe → deep red ripe
    const fruitPositions = [];
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        const r = 2.0 * (0.6 + Math.random() * 0.3);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            trunkH + 1.1 + (Math.random() - 0.5) * 1.3,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0xc81b2a, {
        size: 0.09, unripeColor: 0x6aaa44,
    }));

    return g;
}
