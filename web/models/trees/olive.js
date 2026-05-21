// models/trees/olive.js
// Olive (Olea europaea). Signature gnarled trunk of braided twisted
// segments + splayed roots, then a silvery-green canopy made
// entirely of leaf planes (NO sphere blobs) and ripening drupes
// that turn from green → dark olive as the plant matures.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "./_canopy.js";

export function buildOlive() {
    const g = new THREE.Group();

    // ── Materials ───────────────────────────────────────────────────
    const barkBase = new THREE.Color(0xa89070);
    const trunkMats = [
        new THREE.MeshStandardMaterial({ color: barkBase.clone(),                              roughness: 0.96 }),
        new THREE.MeshStandardMaterial({ color: barkBase.clone().offsetHSL(0.02, -0.05, -0.10), roughness: 0.95 }),
        new THREE.MeshStandardMaterial({ color: barkBase.clone().offsetHSL(-0.01, -0.02, 0.08), roughness: 0.97 }),
    ];

    // ── Splayed roots at the base ───────────────────────────────────
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const root = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.13, 0.45, 5),
            trunkMats[i % 3],
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

    // ── Trunk: 5 braided twisted segments ───────────────────────────
    const trunkH = 1.7;
    const trunkSegs = 5;
    for (let i = 0; i < trunkSegs; i++) {
        const a = (i / trunkSegs) * Math.PI * 2;
        const r = 0.12 + (i % 2) * 0.04;
        const seg = new THREE.Mesh(
            new THREE.CylinderGeometry(r * 0.7, r * 1.05, trunkH, 6),
            trunkMats[i % 3],
        );
        seg.position.set(Math.cos(a) * 0.10, 0.4 + trunkH / 2, Math.sin(a) * 0.10);
        seg.rotation.z = Math.cos(a + 0.6) * 0.13;
        seg.rotation.x = Math.sin(a + 0.6) * 0.13;
        seg.castShadow = true;
        g.add(seg);
    }
    const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.20, 0.22, 0.25, 8), trunkMats[1],
    );
    cap.position.y = 0.4 + trunkH + 0.1; cap.castShadow = true; g.add(cap);

    // ── Branches reaching into canopy ───────────────────────────────
    const branchCount = 6;
    const canopyY = 0.4 + trunkH + 0.95;
    for (let i = 0; i < branchCount; i++) {
        const a = (i / branchCount) * Math.PI * 2 + 0.4;
        const dir = Math.cos(a), dirZ = Math.sin(a);
        const seg1 = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.075, 0.8, 5),
            trunkMats[i % 3],
        );
        seg1.position.set(dir * 0.25, canopyY - 0.45, dirZ * 0.25);
        seg1.rotation.z = -dir * 0.7;
        seg1.rotation.x = dirZ * 0.7;
        seg1.castShadow = true; g.add(seg1);
        const seg2 = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.045, 0.7, 5),
            trunkMats[(i + 1) % 3],
        );
        seg2.position.set(dir * 0.55, canopyY - 0.1, dirZ * 0.55);
        seg2.rotation.z = -dir * 1.0;
        seg2.rotation.x = dirZ * 1.0;
        g.add(seg2);
    }

    // ── Canopy: silvery-green leaves only (no blobs!) ───────────────
    // Slightly squashed so the canopy is wider than tall, matching
    // mature olive trees. Long thin leaf aspect = real olive leaves.
    const canopyRadius = 1.4;
    const canopyHeightHalf = 0.95;
    const leafCount = 380;
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, canopyY, 0),
        canopyRadius,
        leafCount,
        { ySquash: canopyHeightHalf / canopyRadius, shellBias: 0.5 },
    );
    const canopy = buildLeafCloud(leafPositions, {
        leafSize: 0.30,
        sizeJitter: 0.5,
        color: new THREE.Color(0x9eb59a), // silver-green
        aspectW: 0.40,
        aspectH: 1.6,   // long, narrow olive-leaf shape
    });
    g.add(canopy);

    // ── Olives: green unripe → dark-olive ripe ──────────────────────
    const fruitPositions = [];
    for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
        const r = canopyRadius * (0.65 + Math.random() * 0.30);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            canopyY + (Math.random() - 0.5) * canopyHeightHalf * 1.3,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0x2a3a14, {
        size: 0.085,
        elongation: 1.5,
        unripeColor: 0x9eb59a,   // matches the foliage when unripe — hard to spot
    }));

    return g;
}
