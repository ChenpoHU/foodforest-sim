// models/animals/boar.js
// Wild boar (Sus scrofa). Characteristic silhouette: long compact
// barrel body, sloped back (high shoulder hump, lower rump), low
// short legs, long snout, short tusks, dorsal bristly mane.
//
// Coordinate convention used throughout the codebase: +Z is forward,
// +X is right, +Y is up. The body capsule's natural axis is Y, so we
// rotate around X to align it with Z (i.e. head-to-tail along the
// forward axis). NOT around Z — that was the old bug which made the
// body lie sideways and read as a fat round blob.

import * as THREE from "three";

export function buildBoar() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.92 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.92 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.85 });
    const hoofMat = darkMat;
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xeee8dd, roughness: 0.6 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x8a6655, roughness: 0.7 });

    // ── Body ────────────────────────────────────────────────────────
    // Capsule length-wise along Z. radius 0.20 + length 0.55 yields a
    // body ~0.95 m long × 0.40 m wide × 0.40 m tall before the
    // shoulder hump.
    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.20, 0.55, 6, 10),
        bodyMat
    );
    body.position.set(0, 0.48, 0);
    body.rotation.x = Math.PI / 2;   // aligns capsule axis with +Z
    body.castShadow = true;
    g.add(body);

    // Belly tone — flatter, lighter sphere underneath the main body
    // to give the silhouette a less uniform look.
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), bellyMat);
    belly.position.set(0, 0.37, -0.05);
    belly.scale.set(0.85, 0.55, 1.6);
    g.add(belly);

    // Shoulder hump — boars carry their weight forward, with a
    // distinctive raised mass above the front legs.
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 6), bodyMat);
    shoulder.position.set(0, 0.62, 0.18);
    shoulder.scale.set(0.95, 0.85, 1.1);
    shoulder.castShadow = true;
    g.add(shoulder);

    // Rump (the back tapers down behind the shoulder).
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), bodyMat);
    rump.position.set(0, 0.50, -0.32);
    rump.scale.set(0.95, 0.85, 1.0);
    g.add(rump);

    // ── Legs ────────────────────────────────────────────────────────
    // Short stout legs. Front legs are a touch taller than rear,
    // reinforcing the sloped-back posture.
    const legPos = [
        { x: -0.10, z:  0.22, h: 0.32 }, // front-left
        { x:  0.10, z:  0.22, h: 0.32 }, // front-right
        { x: -0.10, z: -0.22, h: 0.28 }, // rear-left
        { x:  0.10, z: -0.22, h: 0.28 }, // rear-right
    ];
    for (const { x, z, h } of legPos) {
        const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.055, h, 6),
            bodyMat
        );
        leg.position.set(x, h / 2, z);
        leg.castShadow = true;
        g.add(leg);
        // Cloven hoof (squash a small sphere).
        const hoof = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), hoofMat);
        hoof.position.set(x, 0.03, z);
        hoof.scale.set(1.0, 0.4, 1.1);
        g.add(hoof);
    }

    // ── Head ────────────────────────────────────────────────────────
    // Sits in front of and slightly below the shoulder, joined by a
    // thick neck blob.
    const neck = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), bodyMat);
    neck.position.set(0, 0.56, 0.30);
    g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bodyMat);
    head.position.set(0, 0.52, 0.45);
    head.scale.set(0.95, 0.95, 1.05);
    head.castShadow = true;
    g.add(head);

    // Long tapering snout — capsule along Z again.
    const snout = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.07, 0.18, 4, 6),
        bellyMat
    );
    snout.position.set(0, 0.44, 0.62);
    snout.rotation.x = Math.PI / 2;
    snout.scale.set(0.9, 0.85, 1.0);
    g.add(snout);
    // Nose disc at the tip.
    const noseDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.018, 8),
        noseMat
    );
    noseDisc.position.set(0, 0.44, 0.73);
    noseDisc.rotation.x = Math.PI / 2;
    g.add(noseDisc);
    // Nostrils
    for (const s of [-1, 1]) {
        const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), darkMat);
        nostril.position.set(s * 0.02, 0.45, 0.74);
        g.add(nostril);
    }

    // Eyes
    for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), darkMat);
        eye.position.set(s * 0.10, 0.58, 0.52);
        g.add(eye);
    }

    // Ears — small pointed cones angled forward.
    for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 5), bodyMat);
        ear.position.set(s * 0.10, 0.69, 0.38);
        ear.rotation.z = s * -0.35;
        ear.rotation.x = -0.20;
        g.add(ear);
    }

    // Tusks — small ivory-coloured cylinders jutting forward + slightly out.
    for (const s of [-1, 1]) {
        const tusk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.008, 0.014, 0.10, 4),
            tuskMat
        );
        tusk.position.set(s * 0.05, 0.41, 0.66);
        tusk.rotation.x = 0.35;
        tusk.rotation.z = s * 0.25;
        g.add(tusk);
    }

    // Bristly dorsal mane — small dark cones along the spine to read
    // as the boar's characteristic crest of bristles.
    for (let i = 0; i < 4; i++) {
        const z = 0.18 - i * 0.13;
        const b = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.10, 4), darkMat);
        b.position.set(0, 0.74 - i * 0.02, z);
        g.add(b);
    }

    // Curly tail — half-torus around Y so it hangs as a little curl.
    const tail = new THREE.Mesh(
        new THREE.TorusGeometry(0.04, 0.012, 4, 8, Math.PI),
        bodyMat
    );
    tail.position.set(0, 0.55, -0.44);
    tail.rotation.y = Math.PI / 2;
    tail.rotation.x = -0.4;
    g.add(tail);

    return g;
}
