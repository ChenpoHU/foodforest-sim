// models/trees/stonepine.js
// Italian/stone pine: tall narrow trunk + flat umbrella canopy.
import * as THREE from "three";

export function buildStonepine() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.25, 7, 6),
        new THREE.MeshStandardMaterial({ color: 0x5a3a1a })
    );
    trunk.position.y = 3.5; trunk.castShadow = true; g.add(trunk);
    const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(3.0, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a5a2a })
    );
    canopy.position.y = 8; canopy.scale.y = 0.4; canopy.castShadow = true; g.add(canopy);
    return g;
}
