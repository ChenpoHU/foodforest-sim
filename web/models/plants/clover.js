// models/plants/clover.js — 4 small flat leaves.
import * as THREE from "three";

export function buildClover() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a8a2a });
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), mat);
        leaf.position.set(Math.cos(angle) * 0.12, 0.1, Math.sin(angle) * 0.12);
        leaf.scale.y = 0.4;
        group.add(leaf);
    }
    return group;
}
