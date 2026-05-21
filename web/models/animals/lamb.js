// models/animals/lamb.js — woolly body, dark face, floppy ears.
import * as THREE from "three";

export function buildLamb() {
    const g = new THREE.Group();
    const wool = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1.0 });
    const face = new THREE.MeshStandardMaterial({ color: 0x2a2020, roughness: 0.85 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xddaaaa });

    // Woolly body (multiple blobs)
    const bod = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), wool);
    bod.position.set(0, 0.55, 0); bod.scale.set(1, 0.85, 1.2);
    bod.castShadow = true; g.add(bod);
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), wool);
        fluff.position.set(Math.cos(a) * 0.18, 0.6 + Math.sin(i) * 0.05, Math.sin(a) * 0.2);
        g.add(fluff);
    }

    // Legs (dark, thin)
    for (const [lx, lz] of [[-0.12, -0.2], [0.12, -0.2], [-0.12, 0.2], [0.12, 0.2]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.35, 4), face);
        leg.position.set(lx, 0.18, lz); leg.castShadow = true; g.add(leg);
        const hf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 3, 3), face);
        hf.position.set(lx, 0.04, lz); hf.scale.y = 0.5; g.add(hf);
    }

    // Head + face wool
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), face);
    hd.position.set(0, 0.65, 0.32); g.add(hd);
    const headWool = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), wool);
    headWool.position.set(0, 0.72, 0.28); g.add(headWool);

    // Eyes (light olive)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x888844 });
    for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 3), eyeMat);
        e.position.set(s * 0.08, 0.68, 0.38); g.add(e);
    }
    // Floppy ears
    for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), face);
        ear.position.set(s * 0.12, 0.63, 0.28);
        ear.scale.set(0.5, 1, 0.7); ear.rotation.z = s * 0.5; g.add(ear);
    }
    // Nose + tail
    const ns = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), pink);
    ns.position.set(0, 0.62, 0.43); g.add(ns);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3), wool);
    tl.position.set(0, 0.6, -0.28); g.add(tl);

    return g;
}
