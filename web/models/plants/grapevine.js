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

    // Grape clusters — three pendant clusters hanging *below* the
    // canopy. Each cluster is built as a fruit position group: many
    // small fruit positions stacked vertically + slightly varying
    // X/Z, so each cluster reads as a tapered bunch of grapes.
    const grapePositions = [];
    const clusterCenters = [
        [-0.35, 1.55,  0.15],
        [ 0.40, 1.55, -0.10],
        [ 0.05, 1.50,  0.40],
    ];
    for (const [cx, cy, cz] of clusterCenters) {
        // Tapered bunch: wider at top, narrower at bottom.
        let row = 0;
        for (let y = 0; y < 6; y++) {
            const radius = (6 - y) * 0.04;
            const perRow = Math.max(2, 6 - y);
            for (let i = 0; i < perRow; i++) {
                const a = (i / perRow) * Math.PI * 2 + y * 0.3;
                grapePositions.push(new THREE.Vector3(
                    cx + Math.cos(a) * radius,
                    cy - y * 0.045,
                    cz + Math.sin(a) * radius,
                ));
            }
            row++;
        }
    }
    g.add(buildFruitCluster(grapePositions, 0x5a229a, {
        size: 0.04,
        elongation: 1.1,
        unripeColor: 0x9eb55c, // pale green when unripe
    }));

    return g;
}
