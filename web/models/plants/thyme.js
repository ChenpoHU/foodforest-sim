// models/plants/thyme.js
// Tiny low spreading mat with small grey-green leaves.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildThyme() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.08, 0),
        0.22, 30,
        { ySquash: 0.30, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.07,
        sizeJitter: 0.4,
        color: new THREE.Color(0x6a8a4a),
        aspectW: 0.55, aspectH: 1.0,
    }));
    return g;
}
