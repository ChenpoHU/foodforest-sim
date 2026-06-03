// models/trees/eucalyptus.js
// Eucalyptus. Tall pale-bark trunk + a narrow, high branch-and-leaf
// crown of long thin silver-green leaves. No fruit (gum nuts are too
// small to read at game distance).

import * as THREE from "three";
import { buildBranchyCanopy } from "./_canopy.js";

export function buildEucalyptus() {
    const g = new THREE.Group();

    // Pale-bark trunk + grey-green peel patches.
    const barkMat = new THREE.MeshStandardMaterial({ color: 0xc8b8a6, roughness: 0.95 });
    const trunkH = 9;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.30, trunkH, 8), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);

    const patchMat = new THREE.MeshStandardMaterial({ color: 0x7a8a78, roughness: 0.95 });
    for (let i = 0; i < 6; i++) {
        const y = 1.0 + Math.random() * (trunkH - 2);
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
        const patch = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.4, 8, 1, true), patchMat,
        );
        patch.position.set(0, y, 0);
        patch.rotation.y = a;
        g.add(patch);
    }

    // Eucalyptus topology: tall bare trunk, branches only near the very
    // top, rising almost vertically (startElevation high) with little
    // splay and shallow forking — an open, wispy crown rather than a
    // broad spreading one. Long thin droopy silver leaves.
    g.add(buildBranchyCanopy({
        base: new THREE.Vector3(0, trunkH - 0.1, 0),
        spread: 1.3, rise: 2.4, branches: 4,
        barkColor: 0xb8a896, leafColor: 0x8aab8a,
        boughRadius: 0.06, leafSize: 0.30,
        clusterRadius: 0.7, leavesPerCluster: 70,
        aspectW: 0.26, aspectH: 2.0,   // long droopy eucalyptus leaves
        startElevation: 0.92,          // boughs go almost straight up
        splay: 0.30, depth: 1, curve: 0.18, upBias: 0.06,
    }));

    return g;
}
