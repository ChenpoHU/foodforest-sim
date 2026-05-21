// models/plants/saffron.js — 3 thin stems with magenta tips.
import * as THREE from "three";

export function buildSaffron() {
    const g = new THREE.Group();
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a7a3a });
    const tipMat  = new THREE.MeshStandardMaterial({ color: 0xaa44aa });
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 3), stemMat);
        stem.position.set(Math.cos(a) * 0.08, 0.25, Math.sin(a) * 0.08);
        g.add(stem);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3), tipMat);
        tip.position.set(Math.cos(a) * 0.08, 0.55, Math.sin(a) * 0.08);
        g.add(tip);
    }
    return g;
}
