// models/animals/animal.js — generic fallback (unknown species id).
import * as THREE from "three";

export function buildGenericAnimal() {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0xcc8844 })
    );
    mesh.position.y = 0.3;
    mesh.castShadow = true;
    return mesh;
}
