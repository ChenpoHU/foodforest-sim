// models/plants/sage.js — ring of upright sage cones.
import * as THREE from "three";

export function buildSage() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a7a6a });
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.8, 4), mat);
        leaf.position.set(Math.cos(a) * 0.25, 0.4, Math.sin(a) * 0.25);
        g.add(leaf);
    }
    return g;
}
