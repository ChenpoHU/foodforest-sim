// models/trees/citrus.js
// Citrus (orange / lemon family). Short slim trunk + low wide
// glossy-dark-green leaf canopy + bright-orange fruit globes. The
// orange-against-dark-green contrast is the strongest ripeness
// signal in the game — easy to spot from a distance.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud, buildFruitCluster } from "./_canopy.js";

export function buildCitrus() {
    const g = new THREE.Group();

    // Short trunk
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
    const trunkH = 1.6;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.17, trunkH, 8), barkMat,
    );
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);

    // Canopy — flat & wide, dense dark-green leaves
    const canopyY = trunkH + 1.05;
    const canopyRadius = 1.7;
    const canopyHeightHalf = 1.2;
    const leafCount = 520;
    const leafPositions = generateCanopyPoints(
        new THREE.Vector3(0, canopyY, 0),
        canopyRadius, leafCount,
        { ySquash: canopyHeightHalf / canopyRadius, shellBias: 0.55 },
    );
    const canopy = buildLeafCloud(leafPositions, {
        leafSize: 0.24,
        sizeJitter: 0.4,
        color: new THREE.Color(0x244c1c),
    });
    g.add(canopy);

    // Oranges: pale green (unripe) → bright orange (ripe). Bigger
    // than other fruits so they read at distance — citrus's
    // signature look.
    const fruitPositions = [];
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        const r = canopyRadius * (0.7 + Math.random() * 0.25);
        fruitPositions.push(new THREE.Vector3(
            Math.cos(a) * r,
            canopyY + (Math.random() - 0.5) * canopyHeightHalf * 1.4,
            Math.sin(a) * r,
        ));
    }
    g.add(buildFruitCluster(fruitPositions, 0xff8c1f, {
        size: 0.20,
        unripeColor: 0xa6c468,
    }));

    return g;
}
