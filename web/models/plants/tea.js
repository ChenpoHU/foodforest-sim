// models/plants/tea.js — small low-hugging tea bush.
import * as THREE from "three";

export function buildTea() {
    const g = new THREE.Group();
    const bush = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0x3a6a2a })
    );
    bush.position.y = 0.4; bush.scale.y = 0.6; g.add(bush);
    return g;
}
