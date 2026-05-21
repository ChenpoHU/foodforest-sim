// models/trees/banana.js
// Plant-like green trunk with 6 long capsule leaves and a small bunch.
import * as THREE from "three";

export function buildBanana() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.18, 3, 6),
        new THREE.MeshStandardMaterial({ color: 0x7a9a3a, roughness: 0.85 })
    );
    trunk.position.y = 1.5; trunk.castShadow = true; g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a8a2a, roughness: 0.7 });
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 1.2, 3, 5), leafMat);
        leaf.position.set(Math.cos(angle) * 0.3, 3.1, Math.sin(angle) * 0.3);
        leaf.rotation.y = angle;
        leaf.rotation.x = -0.5;
        leaf.scale.set(2.5, 1, 0.15);
        g.add(leaf);
    }
    // Banana bunch
    const bunchMat = new THREE.MeshStandardMaterial({ color: 0xddcc33, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
        const banana = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 3, 4), bunchMat);
        banana.position.set(Math.cos(i * 1.5) * 0.08, 2.6 - i * 0.06, Math.sin(i * 1.5) * 0.08);
        banana.rotation.z = 0.3; g.add(banana);
    }
    return g;
}
