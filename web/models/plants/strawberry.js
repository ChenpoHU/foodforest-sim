// models/plants/strawberry.js — leaf clump with 3 small red berries.
import * as THREE from "three";

export function buildStrawberry() {
    const group = new THREE.Group();
    const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 6, 4),
        new THREE.MeshStandardMaterial({ color: 0x3a8a2a, roughness: 0.85 })
    );
    leaves.position.y = 0.15; leaves.scale.y = 0.5; group.add(leaves);
    const berryMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3), berryMat);
        berry.position.set(Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15);
        berry.scale.y = 1.3; group.add(berry);
    }
    return group;
}
