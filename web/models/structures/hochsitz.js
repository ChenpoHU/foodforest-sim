// models/structures/hochsitz.js
// Closed Kanzel (German hunting stand) — larch wood, ~3.5 m stilts,
// 1.2 m × 1.2 m cabin with observation windows on every side.
import * as THREE from "three";

export function buildHochsitz() {
    const g = new THREE.Group();
    const larch     = new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 0.92 });
    const larchDark = new THREE.MeshStandardMaterial({ color: 0x5a3a18, roughness: 0.95 });
    const plank     = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 });
    const roofMat   = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a3a4a, roughness: 0.3, metalness: 0.1 });
    const platformH = 3.5;

    // Four larch log stilts
    for (const [lx, lz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, platformH, 6), larch);
        leg.position.set(lx, platformH / 2, lz); leg.castShadow = true; g.add(leg);
    }
    // Diagonal cross braces on two sides
    for (const side of [-1, 1]) {
        const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.5, 4), larchDark);
        brace.position.set(side * 0.55, 1.8, 0);
        brace.rotation.z = side * 0.55; brace.rotation.x = 0.3;
        g.add(brace);
        const brace2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.5, 4), larchDark);
        brace2.position.set(0, 1.8, side * 0.55);
        brace2.rotation.x = side * -0.55; brace2.rotation.z = 0.3;
        g.add(brace2);
    }
    // Horizontal cross beams at mid-height
    for (const lz of [-0.55, 0.55]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), larchDark);
        beam.position.set(0, platformH * 0.5, lz); g.add(beam);
    }
    for (const lx of [-0.55, 0.55]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), larchDark);
        beam.position.set(lx, platformH * 0.5, 0); g.add(beam);
    }
    // Platform floor (thick planks)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 1.3), plank);
    floor.position.y = platformH; floor.castShadow = true; g.add(floor);

    // Cabin walls — closed on all four sides
    const cabinH = 1.9;
    const cabinY = platformH + cabinH / 2 + 0.05;
    const wallThick = 0.06;
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, cabinH, wallThick), plank);
    backWall.position.set(0, cabinY, -0.57); backWall.castShadow = true; g.add(backWall);
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, cabinH, wallThick), plank);
    frontWall.position.set(0, cabinY, 0.57); frontWall.castShadow = true; g.add(frontWall);
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThick, cabinH, 1.2), plank);
    leftWall.position.set(-0.57, cabinY, 0); leftWall.castShadow = true; g.add(leftWall);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThick, cabinH, 1.2), plank);
    rightWall.position.set(0.57, cabinY, 0); rightWall.castShadow = true; g.add(rightWall);

    // Observation windows on all four sides
    const winW = 0.8, winH = 0.35;
    const winY = platformH + cabinH * 0.65;
    for (const [wx, wz, ry] of [
        [0, -0.58, 0], [0, 0.58, 0], [-0.58, 0, Math.PI / 2], [0.58, 0, Math.PI / 2],
    ]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), windowMat);
        win.position.set(wx, winY, wz);
        win.rotation.y = ry;
        if (wz < 0) win.rotation.y = Math.PI;
        g.add(win);
    }

    // Pitched roof
    const roofOverhang = 0.2;
    const roofW = 1.2 + roofOverhang * 2;
    const roofD = (1.2 + roofOverhang * 2) / 2;
    const roofAngle = 0.35;
    const roofY = platformH + cabinH + 0.1;
    const roofLeft = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.05, roofD + 0.1), roofMat);
    roofLeft.position.set(0, roofY + 0.2, -roofD / 2 + 0.05);
    roofLeft.rotation.x = roofAngle; roofLeft.castShadow = true; g.add(roofLeft);
    const roofRight = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.05, roofD + 0.1), roofMat);
    roofRight.position.set(0, roofY + 0.2, roofD / 2 - 0.05);
    roofRight.rotation.x = -roofAngle; roofRight.castShadow = true; g.add(roofRight);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.06, 0.06), larchDark);
    ridge.position.set(0, roofY + 0.42, 0); g.add(ridge);

    // Gable triangles (front and back)
    const gableGeo = new THREE.BufferGeometry();
    const gableVerts = new Float32Array([
        -0.6, 0, 0,  0.6, 0, 0,  0, 0.35, 0,
    ]);
    gableGeo.setAttribute("position", new THREE.BufferAttribute(gableVerts, 3));
    gableGeo.computeVertexNormals();
    for (const gz of [-0.58, 0.58]) {
        const gable = new THREE.Mesh(gableGeo, plank);
        gable.position.set(0, roofY, gz); g.add(gable);
    }

    // Internal ladder
    const ladderMat = larchDark;
    for (let ly = 0; ly < platformH; ly += 0.4) {
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), ladderMat);
        rung.position.set(0, ly + 0.2, 0.65); rung.rotation.z = Math.PI / 2; g.add(rung);
    }
    const ladderL = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, platformH + 0.5, 5), larch);
    ladderL.position.set(-0.15, platformH / 2, 0.65); ladderL.rotation.x = 0.08; g.add(ladderL);
    const ladderR = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, platformH + 0.5, 5), larch);
    ladderR.position.set(0.15, platformH / 2, 0.65); ladderR.rotation.x = 0.08; g.add(ladderR);

    return g;
}
