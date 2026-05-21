// models/plants/shiso.js — spiral of deep-purple leaves.
import * as THREE from "three";

export function buildShiso() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a2a4a });
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 3), mat);
        leaf.position.set(Math.cos(a) * 0.15, 0.2 + i * 0.05, Math.sin(a) * 0.15);
        leaf.scale.y = 0.3; g.add(leaf);
    }
    return g;
}
