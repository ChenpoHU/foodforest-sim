// models/trees/eucalyptus.js
// Eucalyptus. Tall pale-bark trunk + sparse silver-green canopy of
// long droopy leaf planes (NO sphere blobs). No fruit cluster — gum
// nuts are too small to read at game distance.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "./_canopy.js";

export function buildEucalyptus() {
    const g = new THREE.Group();

    // Pale-bark trunk + grey-green peel patches
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
            new THREE.CylinderGeometry(0.32, 0.32, 0.4, 8, 1, true),
            patchMat,
        );
        patch.position.set(0, y, 0);
        patch.rotation.y = a;
        g.add(patch);
    }

    // Canopy — tall narrow leaf cloud high on the trunk. Eucalyptus
    // crowns are notably wispier than other trees, so we use long
    // thin elongated leaf shapes and a tighter shell distribution.
    const canopyY = trunkH + 1.6;
    const canopyRadius = 1.3;
    const canopyHeightHalf = 2.0;
    const leafCount = 480;
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, canopyY, 0),
        canopyRadius, leafCount,
        { ySquash: canopyHeightHalf / canopyRadius, shellBias: 0.45 },
    );
    const canopy = buildLeafCloud(leafPositions, {
        leafSize: 0.35,
        sizeJitter: 0.5,
        color: new THREE.Color(0x8aab8a),
        aspectW: 0.30,  // long thin droopy eucalyptus leaves
        aspectH: 2.0,
    });
    g.add(canopy);

    return g;
}
