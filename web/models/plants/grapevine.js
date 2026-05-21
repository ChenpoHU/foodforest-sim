// models/plants/grapevine.js — pole + foliage canopy + dangling grape clusters.
import * as THREE from "three";

export function buildGrapevine() {
    const group = new THREE.Group();
    const vine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.07, 2.0, 5),
        new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.9 })
    );
    vine.position.y = 1.0; vine.castShadow = true; group.add(vine);
    const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a8a2a, roughness: 0.85 })
    );
    foliage.position.y = 2.0; foliage.scale.y = 0.6;
    foliage.castShadow = true; group.add(foliage);
    const grapeMat = new THREE.MeshStandardMaterial({ color: 0x5522aa, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        for (let j = 0; j < 3; j++) {
            const grape = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), grapeMat);
            grape.position.set(
                Math.cos(a) * 0.5, 1.7 - j * 0.06,
                Math.sin(a) * 0.5 + (j - 1) * 0.03
            );
            group.add(grape);
        }
    }
    return group;
}
