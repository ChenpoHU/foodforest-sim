// models/trees/walnut.js
// Walnut (Juglans). Tall straight trunk + a branch-and-leaf crown
// (real boughs forking up with leaf clusters at the tips). Husk-green
// → russet walnuts.

import * as THREE from "three";
import { buildBranchyCanopy } from "./_canopy.js";

export function buildWalnut() {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x402612, roughness: 0.96 });

    const trunkH = 5.5;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.30, 0.42, trunkH, 10), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.65, 0.5, 10), barkMat,
    );
    flare.position.y = 0.25; flare.castShadow = true; g.add(flare);

    // Walnut topology: broad, rounded, spreading crown. Boughs spring
    // out low and wide, curve generously, and fork deeply.
    g.add(buildBranchyCanopy({
        base: new THREE.Vector3(0, trunkH - 0.1, 0),
        spread: 2.6, rise: 2.4, branches: 5,
        barkColor: 0x402612, leafColor: 0x244e1b,
        boughRadius: 0.17, leafSize: 0.16,
        clusterRadius: 0.95, leavesPerCluster: 75,
        startElevation: 0.5, splay: 0.72, depth: 3, curve: 0.34, upBias: 0.10,
        // Walnuts: green husk (unripe) → russet-brown (ripe), hung from twigs.
        fruitColor: 0x6a4622, fruitCount: 14, fruitSize: 0.16, unripeColor: 0x4a6a2a,
    }));

    return g;
}
