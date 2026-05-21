// models/plants/basil.js — 4 small green leaves.
import * as THREE from "three";

export function buildBasil() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a8a2a });
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 3), mat);
        leaf.position.set(Math.cos(a) * 0.15, 0.25, Math.sin(a) * 0.15);
        leaf.scale.y = 0.3; g.add(leaf);
    }
    return g;
}
