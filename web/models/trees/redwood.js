// models/trees/redwood.js
// Coast redwood: massive reddish-brown trunk tapering up to a tall
// narrow conical evergreen crown. Distinguishable from everything else
// by sheer scale + the conical (not spherical) canopy.

import * as THREE from "three";

export function buildRedwood() {
    const g = new THREE.Group();

    // Massive trunk — reddish brown, slightly tapering.
    const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x6e2a1a, roughness: 0.96,
    });
    const trunkH = 13;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.55, trunkH, 10),
        trunkMat
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    // Buttressed base (root flare).
    const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.85, 0.9, 10),
        trunkMat
    );
    flare.position.y = 0.45;
    flare.castShadow = true;
    g.add(flare);

    // Conical evergreen crown — stacked cones of decreasing radius so
    // the silhouette reads as needle-tipped redwood instead of generic
    // tree-blob.
    const needleColors = [0x1f4a1a, 0x2a5a22, 0x356a2c];
    const baseY = trunkH;
    for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const radius = 2.6 * (1 - t * 0.85);
        const height = 1.3 * (1 - t * 0.4);
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(radius, height, 12),
            new THREE.MeshStandardMaterial({
                color: needleColors[i % 3], roughness: 0.9,
            })
        );
        cone.position.y = baseY + i * 0.95;
        cone.castShadow = true;
        g.add(cone);
    }
    // Final tip spike.
    const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 1.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a4515, roughness: 0.9 })
    );
    spike.position.y = baseY + 7 * 0.95;
    g.add(spike);

    return g;
}
