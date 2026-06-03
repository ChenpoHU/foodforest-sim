// models/trees/olive.js
// Olive (Olea europaea). Signature gnarled trunk of braided twisted
// segments + splayed roots, topped by a branch-and-leaf crown of
// silvery-green foliage and ripening drupes (green → dark olive).

import * as THREE from "three";
import { buildBranchyCanopy, buildFruitCluster } from "./_canopy.js";

export function buildOlive() {
    const g = new THREE.Group();

    // ── Materials ───────────────────────────────────────────────────
    const barkBase = new THREE.Color(0xa89070);
    const trunkMats = [
        new THREE.MeshStandardMaterial({ color: barkBase.clone(),                               roughness: 0.96 }),
        new THREE.MeshStandardMaterial({ color: barkBase.clone().offsetHSL(0.02, -0.05, -0.10),  roughness: 0.95 }),
        new THREE.MeshStandardMaterial({ color: barkBase.clone().offsetHSL(-0.01, -0.02, 0.08),  roughness: 0.97 }),
    ];

    // ── Splayed roots ───────────────────────────────────────────────
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const root = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.13, 0.45, 5), trunkMats[i % 3],
        );
        root.position.set(Math.cos(a) * 0.22, 0.18, Math.sin(a) * 0.22);
        root.rotation.z = Math.cos(a) * 0.7;
        root.rotation.x = Math.sin(a) * 0.7;
        root.castShadow = true;
        g.add(root);
    }
    const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.32, 0.35, 8), trunkMats[0],
    );
    stump.position.y = 0.18; stump.castShadow = true; g.add(stump);

    // ── Braided twisted trunk ───────────────────────────────────────
    const trunkH = 1.7;
    const trunkSegs = 5;
    for (let i = 0; i < trunkSegs; i++) {
        const a = (i / trunkSegs) * Math.PI * 2;
        const r = 0.12 + (i % 2) * 0.04;
        const seg = new THREE.Mesh(
            new THREE.CylinderGeometry(r * 0.7, r * 1.05, trunkH, 6), trunkMats[i % 3],
        );
        seg.position.set(Math.cos(a) * 0.10, 0.4 + trunkH / 2, Math.sin(a) * 0.10);
        seg.rotation.z = Math.cos(a + 0.6) * 0.13;
        seg.rotation.x = Math.sin(a + 0.6) * 0.13;
        seg.castShadow = true;
        g.add(seg);
    }
    const capY = 0.4 + trunkH + 0.05;

    // ── Branch-and-leaf crown (silvery olive foliage) ───────────────
    // Olive topology: gnarled + twisted. High curve makes the boughs
    // writhe; low upBias + wide splay gives the characteristic broad
    // billowing silvery crown.
    g.add(buildBranchyCanopy({
        base: new THREE.Vector3(0, capY, 0),
        spread: 1.6, rise: 1.3, branches: 6,
        barkColor: 0x9a8468, leafColor: 0x9eb59a,  // silver-green
        boughRadius: 0.09, leafSize: 0.26,
        clusterRadius: 0.7, leavesPerCluster: 70,
        aspectW: 0.4, aspectH: 1.5,   // narrow olive leaves
        startElevation: 0.55, splay: 0.6, depth: 2, curve: 0.5, upBias: 0.05,
    }));

    // ── Olives: green unripe → dark-olive ripe ──────────────────────
    const fruitPositions = [];
    for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
        const r = 1.5 * (0.55 + Math.random() * 0.35);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            capY + 1.0 + (Math.random() - 0.5) * 1.1,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0x2a3a14, {
        size: 0.085, elongation: 1.5,
        unripeColor: 0x9eb59a,   // matches foliage when unripe — hard to spot
    }));

    return g;
}
