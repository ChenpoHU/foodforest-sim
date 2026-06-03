// models/plants/tea.js
// Small bushy shrub of glossy dark-green leaves.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildTea() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.35, 0),
        0.45, 100,
        { ySquash: 0.7, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.14,
        sizeJitter: 0.4,
        color: new THREE.Color(0x2a5a2a),
        aspectW: 0.55, aspectH: 1.2,
    }));
    return g;
}
