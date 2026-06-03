// models/plants/rooibos.js
// Red-brown stemmed legume with tiny needle leaves.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildRooibos() {
    const g = new THREE.Group();
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.95 });
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.020, 0.55, 3), stemMat,
        );
        stem.position.set(Math.cos(a) * 0.14, 0.27, Math.sin(a) * 0.14);
        g.add(stem);
    }
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.40, 0),
        0.22, 60,
        { ySquash: 1.4, shellBias: 0.45 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.10,
        sizeJitter: 0.45,
        color: new THREE.Color(0x6a8a4a),
        aspectW: 0.18, aspectH: 1.6,
    }));
    return g;
}
