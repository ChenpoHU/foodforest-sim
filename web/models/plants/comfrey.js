// models/plants/comfrey.js
// Large broad-leafed perennial. Wide oval leaves radiating from
// the centre at angles.

import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildComfrey() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.18, 0),
        0.32, 35,
        { ySquash: 0.55, shellBias: 0.55 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.22,
        sizeJitter: 0.40,
        color: new THREE.Color(0x3a7a2a),
        aspectW: 0.7, aspectH: 1.5,
    }));
    return g;
}
