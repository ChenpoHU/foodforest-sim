// models/structures/semi_ai.js
// Boxy hover-drone in a cool blue palette — visually distinct from
// organic life so farmers recognise it as a monarch deployment
// competing for harvestable fruit.
import * as THREE from "three";

export function buildSemiAI() {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.25, 0.45),
        new THREE.MeshStandardMaterial({
            color: 0x3a4a6a, roughness: 0.4, metalness: 0.6,
            emissive: 0x224477, emissiveIntensity: 0.25,
        })
    );
    chassis.position.y = 0.9;
    chassis.castShadow = true;
    g.add(chassis);
    // Glowing sensor strip
    const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.06, 0.02),
        new THREE.MeshStandardMaterial({
            color: 0x44ccff, emissive: 0x44ccff, emissiveIntensity: 1.2,
        })
    );
    eye.position.set(0, 0.92, 0.23);
    g.add(eye);
    // Four rotor pods at the corners
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.6 });
    const rotorGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const r = new THREE.Mesh(rotorGeo, rotorMat);
        r.position.set(sx * 0.28, 1.0, sz * 0.28);
        g.add(r);
    }
    return g;
}
