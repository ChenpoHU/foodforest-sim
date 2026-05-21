// models/trees/bamboo.js
// Cluster of 8 thin stalks with a leaf puff on top of each.
import * as THREE from "three";

export function buildBamboo() {
    const g = new THREE.Group();
    const stalkMat = new THREE.MeshStandardMaterial({ color: 0x6a8a3a });
    const leafMat  = new THREE.MeshStandardMaterial({ color: 0x4a7a2a });
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = 0.3 + Math.random() * 0.3;
        const h = 4 + Math.random() * 4;
        const stalk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.06, h, 4),
            stalkMat
        );
        stalk.position.set(Math.cos(angle) * r, h / 2, Math.sin(angle) * r);
        stalk.castShadow = true; g.add(stalk);
        const leaves = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 5, 4),
            leafMat
        );
        leaves.position.set(Math.cos(angle) * r, h - 0.3, Math.sin(angle) * r);
        leaves.scale.y = 0.5; g.add(leaves);
    }
    return g;
}
