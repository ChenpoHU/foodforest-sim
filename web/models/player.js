// models/player.js — humanoid avatar (capsule torso + arms + legs).
import * as THREE from "three";

export function buildPlayer() {
    const g = new THREE.Group();
    const skin  = new THREE.MeshStandardMaterial({ color: 0xf0d0a8, roughness: 0.75 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x5588bb, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.8 });
    const shoe  = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
    const hair  = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9 });
    const dot   = new THREE.MeshStandardMaterial({ color: 0x221111, roughness: 0.6 });

    // Torso, neck, head
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.4, 6, 8), shirt);
    torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 6), skin);
    neck.position.y = 1.35; g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
    head.position.y = 1.56; head.castShadow = true; g.add(head);
    const hairCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair
    );
    hairCap.position.y = 1.58; g.add(hairCap);

    // Simple dot eyes (friendly, no uncanny valley)
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 5, 4), dot);
        eye.position.set(side * 0.08, 1.58, -0.2); g.add(eye);
    }

    // Arms (connected to torso, overlapping)
    for (const side of [-1, 1]) {
        const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.24, 4, 6), shirt);
        upperArm.position.set(side * 0.3, 1.1, 0); upperArm.castShadow = true; g.add(upperArm);
        const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 6), skin);
        forearm.position.set(side * 0.3, 0.8, 0); g.add(forearm);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), skin);
        hand.position.set(side * 0.3, 0.62, 0); g.add(hand);
    }

    // Legs (overlapping with torso)
    for (const side of [-1, 1]) {
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.24, 4, 6), pants);
        thigh.position.set(side * 0.1, 0.6, 0); thigh.castShadow = true; g.add(thigh);
        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 6), pants);
        shin.position.set(side * 0.1, 0.32, 0); g.add(shin);
        const shoeM = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.1, 4, 5), shoe);
        shoeM.position.set(side * 0.1, 0.14, -0.02); shoeM.rotation.x = Math.PI / 2;
        shoeM.scale.set(1, 1.3, 0.8); g.add(shoeM);
    }

    return g;
}
