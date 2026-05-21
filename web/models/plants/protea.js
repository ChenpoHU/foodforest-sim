// models/plants/protea.js — single stem with inverted-cone pink flower.
import * as THREE from "three";

export function buildProtea() {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.06, 1.0, 4),
        new THREE.MeshStandardMaterial({ color: 0x4a5a3a })
    );
    stem.position.y = 0.5; g.add(stem);
    const flower = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: 0xcc4466 })
    );
    flower.position.y = 1.2; flower.rotation.x = Math.PI; g.add(flower);
    return g;
}
