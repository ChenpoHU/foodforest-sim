// models/plants/rosemary.js
// Small woody shrub with needle-like leaves. A few short woody
// stems poking up, surrounded by a tight cluster of long narrow
// dark-green leaf planes.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildRosemary() {
    const g = new THREE.Group();

    // Stems
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.95 });
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.020, 0.45, 4), stemMat,
        );
        stem.position.set(Math.cos(a) * 0.10, 0.22, Math.sin(a) * 0.10);
        g.add(stem);
    }

    // Needle leaves
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, 0.32, 0),
        0.22, 80,
        { ySquash: 1.4, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(leafPositions, {
        leafSize: 0.16,
        sizeJitter: 0.45,
        color: new THREE.Color(0x3a6a3a),
        aspectW: 0.18,  // very narrow needle-leaves
        aspectH: 1.8,
    }));

    return g;
}
