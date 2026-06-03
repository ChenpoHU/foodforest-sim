// models/plants/clover.js
// Ground cover — small dense patch of tiny round leaves.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildClover() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.06, 0),
        0.18, 24,
        { ySquash: 0.30, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.08,
        sizeJitter: 0.4,
        color: new THREE.Color(0x2a8a2a),
    }));
    return g;
}
