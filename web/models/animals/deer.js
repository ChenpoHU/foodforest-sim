// models/animals/deer.js
// Stag-like deer built from overlapping spheres + capsule legs, with
// a friendly low-poly aesthetic that still reads as a real deer at
// player distance.

import * as THREE from "three";

export function buildDeer() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.9 });
    const furLight = new THREE.MeshStandardMaterial({ color: 0xc8aa78, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.8 });

    // Main body: overlapping spheres for smooth form
    const bodyFront = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 7), fur);
    bodyFront.position.set(0, 0.88, 0.15); bodyFront.scale.set(0.85, 0.9, 1.1);
    bodyFront.castShadow = true; g.add(bodyFront);
    const bodyRear = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 7), fur);
    bodyRear.position.set(0, 0.86, -0.18); bodyRear.scale.set(0.9, 0.88, 1.0);
    bodyRear.castShadow = true; g.add(bodyRear);
    const bodyMid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), fur);
    bodyMid.position.set(0, 0.87, 0); bodyMid.scale.set(0.8, 0.85, 1.05);
    g.add(bodyMid);

    // Belly
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 5), furLight);
    belly.position.set(0, 0.76, 0); belly.scale.set(0.7, 0.6, 1.0); g.add(belly);

    // Legs (upper starts inside body sphere)
    for (const [lx, lz] of [[-0.11, -0.28], [0.11, -0.28], [-0.11, 0.28], [0.11, 0.28]]) {
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 4, 5), fur);
        upper.position.set(lx, 0.52, lz); upper.castShadow = true; g.add(upper);
        const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.26, 4, 4), fur);
        lower.position.set(lx, 0.22, lz); g.add(lower);
        const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.06, 5), dark);
        hoof.position.set(lx, 0.04, lz); g.add(hoof);
    }

    // Shoulder + hip bumps (hide leg-body junction)
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), fur);
    shoulderL.position.set(-0.12, 0.82, 0.25); g.add(shoulderL);
    const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), fur);
    shoulderR.position.set(0.12, 0.82, 0.25); g.add(shoulderR);
    const hipL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), fur);
    hipL.position.set(-0.12, 0.8, -0.25); g.add(hipL);
    const hipR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), fur);
    hipR.position.set(0.12, 0.8, -0.25); g.add(hipR);

    // Neck: multiple overlapping spheres for smooth curve
    const neckBase = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), fur);
    neckBase.position.set(0, 0.98, 0.35); g.add(neckBase);
    const neckMid = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), fur);
    neckMid.position.set(0, 1.1, 0.42); g.add(neckMid);
    const neckTop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), fur);
    neckTop.position.set(0, 1.2, 0.46); g.add(neckTop);

    // Head + face features
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), fur);
    head.position.set(0, 1.28, 0.52); g.add(head);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), furLight);
    snout.position.set(0, 1.24, 0.65); snout.scale.set(0.7, 0.65, 1.0); g.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), dark);
    nose.position.set(0, 1.25, 0.73); g.add(nose);
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), dark);
        eye.position.set(side * 0.11, 1.32, 0.58); g.add(eye);
    }
    for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), furLight);
        ear.position.set(side * 0.1, 1.42, 0.46);
        ear.scale.set(0.35, 1.0, 0.5);
        ear.rotation.z = side * -0.3; ear.rotation.x = -0.15;
        g.add(ear);
    }

    // Antlers
    const antler = new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.85 });
    for (const side of [-1, 1]) {
        const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.3, 4), antler);
        a1.position.set(side * 0.06, 1.46, 0.48); a1.rotation.z = side * -0.4; g.add(a1);
        const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.2, 3), antler);
        a2.position.set(side * 0.12, 1.58, 0.45); a2.rotation.z = side * -0.7; g.add(a2);
        const a3 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.15, 3), antler);
        a3.position.set(side * 0.08, 1.6, 0.43); a3.rotation.z = side * -0.3;
        a3.rotation.x = -0.4; g.add(a3);
    }

    // White tail
    const tail = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 5, 4),
        new THREE.MeshStandardMaterial({ color: 0xf0e8dd, roughness: 0.9 })
    );
    tail.position.set(0, 0.92, -0.45); tail.scale.set(0.8, 0.6, 1.0); g.add(tail);

    return g;
}
