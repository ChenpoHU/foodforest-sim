// models/plants/thyme.js — low ring of flattened spheres.
import * as THREE from "three";

export function buildThyme() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a6a4a });
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.15, 4, 3), mat);
        s.position.set(Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2);
        s.scale.y = 0.5; g.add(s);
    }
    return g;
}
