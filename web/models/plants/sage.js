// models/plants/sage.js
// Small soft-grey-green herb with long narrow leaves.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildSage() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.22, 0),
        0.25, 30,
        { ySquash: 0.85, shellBias: 0.45 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.16,
        sizeJitter: 0.45,
        color: new THREE.Color(0x7a8a6a),
        aspectW: 0.35, aspectH: 1.6,
    }));
    return g;
}
