// models/trees/citrus.js
// Citrus (orange / lemon family). Short trunk + dense low branch-and-
// leaf crown in glossy dark green, with bright-orange fruit globes —
// the strongest ripeness signal in the game.

import * as THREE from "three";
import { buildBranchyCanopy, buildFruitCluster } from "./_canopy.js";

export function buildCitrus() {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
    const trunkH = 1.6;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.17, trunkH, 8), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);

    // Citrus topology: short trunk, dense low rounded crown. Boughs
    // spring out wide and fork densely close to the trunk.
    g.add(buildBranchyCanopy({
        base: new THREE.Vector3(0, trunkH - 0.1, 0),
        spread: 1.7, rise: 1.4, branches: 5,
        barkColor: 0x5a4030, leafColor: 0x244c1c,
        boughRadius: 0.08, leafSize: 0.15,
        clusterRadius: 0.78, leavesPerCluster: 85,
        startElevation: 0.55, splay: 0.6, depth: 2, curve: 0.32, upBias: 0.12,
    }));

    // Oranges: pale green (unripe) → bright orange (ripe). Big so they
    // read at distance.
    const fruitPositions = [];
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        const r = 1.7 * (0.6 + Math.random() * 0.3);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            trunkH + 1.0 + (Math.random() - 0.5) * 1.2,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0xff8c1f, {
        size: 0.20, unripeColor: 0xa6c468,
    }));

    return g;
}
