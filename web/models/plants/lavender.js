// models/plants/lavender.js — stems with violet flower spikes.
import * as THREE from "three";

export function buildLavender() {
    const group = new THREE.Group();
    const stemMat   = new THREE.MeshStandardMaterial({ color: 0x4a6a3a });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0x8855aa });
    for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const r = 0.2 + Math.random() * 0.15;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 3), stemMat);
        stem.position.set(Math.cos(angle) * r, 0.35, Math.sin(angle) * r);
        group.add(stem);
        const flower = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 4), flowerMat);
        flower.position.set(Math.cos(angle) * r, 0.8, Math.sin(angle) * r);
        group.add(flower);
    }
    return group;
}
