// models/plants/grapevine.js
// Grapevine on a pole: woody trunk, a few twisting cordons that hold
// the leaf canopy, dangling grape clusters. Leaves are a real
// leaf-cloud (NO sphere blob). Grapes ripen from pale green to deep
// purple at the Fruiting stage.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "../trees/_canopy.js";

export function buildGrapevine() {
    const g = new THREE.Group();

    const vineMat = new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.92 });

    // Vertical trunk / cordon
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.07, 1.8, 6), vineMat,
    );
    trunk.position.y = 0.9;
    trunk.castShadow = true;
    g.add(trunk);

    // Two twisted cordons reaching out either side, holding the canopy.
    for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.045, 0.8, 5), vineMat,
        );
        arm.position.set(side * 0.25, 1.7, 0);
        arm.rotation.z = side * -1.1;
        arm.castShadow = true;
        g.add(arm);
    }
    // A few thin "tendrils" climbing further out.
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.3;
        const tendril = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.025, 0.45, 4), vineMat,
        );
        tendril.position.set(Math.cos(a) * 0.45, 1.95, Math.sin(a) * 0.45);
        tendril.rotation.z = -Math.cos(a) * 0.5;
        tendril.rotation.x = Math.sin(a) * 0.5;
        g.add(tendril);
    }

    // Leaf canopy — broad, vine-green, wider than tall.
    const canopyY = 2.1;
    const canopyR = 0.95;
    const canopyHHalf = 0.55;
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, canopyY, 0),
        canopyR, 220,
        { ySquash: canopyHHalf / canopyR, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(leafPositions, {
        leafSize: 0.18,
        sizeJitter: 0.45,
        color: new THREE.Color(0x4a8a2a),
    }));

    // Grape bunches — dense conical clusters of berries hanging below
    // the canopy. The key to "reads as grapes" is DENSITY: berries
    // packed tightly (spacing ≈ berry diameter) into a tapered cone, so
    // it looks like a solid bunch rather than a scatter of loose balls.
    const BERRY = 0.05;
    const grapePositions = [];
    function addBunch(cx, cy, cz, height, topR) {
        const rows = Math.max(5, Math.ceil(height / (BERRY * 0.85)));
        for (let r = 0; r < rows; r++) {
            const t = r / (rows - 1);                 // 0 top → 1 bottom
            const y = cy - t * height;
            // Quadratic taper to a near-point at the bottom.
            const radius = topR * (1 - t) * (1 - t) + 0.012;
            const circ = 2 * Math.PI * radius;
            const count = Math.max(1, Math.round(circ / (BERRY * 1.45)));
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2 + r * 0.5;
                grapePositions.push(new THREE.Vector3(
                    cx + Math.cos(a) * radius + (Math.random() - 0.5) * BERRY * 0.4,
                    y + (Math.random() - 0.5) * BERRY * 0.3,
                    cz + Math.sin(a) * radius + (Math.random() - 0.5) * BERRY * 0.4,
                ));
            }
            // Fill the core so the bunch isn't hollow.
            if (radius > BERRY * 1.2) grapePositions.push(new THREE.Vector3(cx, y, cz));
        }
    }
    // Four full bunches dangling at different spots under the canopy.
    addBunch(-0.34, 1.58,  0.14, 0.42, 0.13);
    addBunch( 0.38, 1.56, -0.10, 0.46, 0.14);
    addBunch( 0.06, 1.50,  0.40, 0.38, 0.12);
    addBunch(-0.10, 1.52, -0.34, 0.40, 0.12);

    g.add(buildFruitCluster(grapePositions, 0x4a1466, {  // deep grape purple
        size: BERRY,
        elongation: 1.05,
        unripeColor: 0x9ab84a,   // pale green when unripe
    }));

    return g;
}
