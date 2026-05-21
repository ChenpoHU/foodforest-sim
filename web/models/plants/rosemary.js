// models/plants/rosemary.js — 5 spiky cones in a ring.
import * as THREE from "three";

export function buildRosemary() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a6a3a });
    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.0, 4), mat);
        spike.position.set(Math.cos(angle) * 0.3, 0.5, Math.sin(angle) * 0.3);
        spike.castShadow = true;
        group.add(spike);
    }
    return group;
}
