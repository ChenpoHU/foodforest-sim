// models/plants/shiso.js
// Purple-leafed Japanese herb. Small cluster of deep-purple-red
// leaves shaped like crinkled hearts.
import * as THREE from "three";
import { generateCanopyPoints, buildLeafCloud } from "../trees/_canopy.js";

export function buildShiso() {
    const g = new THREE.Group();
    const positions = generateCanopyPoints(
        new THREE.Vector3(0, 0.22, 0),
        0.22, 25,
        { ySquash: 0.95, shellBias: 0.5 },
    );
    g.add(buildLeafCloud(positions, {
        leafSize: 0.14,
        sizeJitter: 0.45,
        color: new THREE.Color(0x6a2a4a),
        aspectW: 0.85, aspectH: 1.2,
    }));
    return g;
}
