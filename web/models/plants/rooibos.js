// models/plants/rooibos.js — red-brown stems clump.
import * as THREE from "three";

export function buildRooibos() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a4a2a });
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.0, 3), mat);
        stem.position.set(Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2);
        g.add(stem);
    }
    return g;
}
