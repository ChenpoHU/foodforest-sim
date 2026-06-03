// models/plants/basil.js
// Small cluster of broad bright-green leaves.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildBasil() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.20, 0),
        0.20, 22,
        { ySquash: 0.85, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.13,
        sizeJitter: 0.45,
        color: new THREE.Color(0x2a8a3a),
        aspectW: 0.85, aspectH: 1.25,
    }));
    return g;
}
