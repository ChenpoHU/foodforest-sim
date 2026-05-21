// models/plants/comfrey.js — fan of 6 angled cones.
import * as THREE from "three";

export function buildComfrey() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a7a2a });
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 4), mat);
        leaf.position.set(Math.cos(angle) * 0.25, 0.3, Math.sin(angle) * 0.25);
        leaf.rotation.z = Math.cos(angle) * 0.3;
        leaf.rotation.x = Math.sin(angle) * 0.3;
        group.add(leaf);
    }
    return group;
}
