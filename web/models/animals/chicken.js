// models/animals/chicken.js
// Simple barnyard chicken: tan body, small head, red comb.

import * as THREE from "three";

export function buildChicken() {
    const g = new THREE.Group();
    const tan = new THREE.MeshStandardMaterial({ color: 0xddaa66 });
    const red = new THREE.MeshStandardMaterial({ color: 0xcc2222 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 5), tan);
    body.position.y = 0.3;
    body.scale.set(1, 0.8, 1.3);
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), tan);
    head.position.set(0, 0.5, 0.2);
    g.add(head);

    const comb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.06), red);
    comb.position.set(0, 0.6, 0.2);
    g.add(comb);

    return g;
}
