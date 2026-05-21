// models/trees/_canopy.js
// Shared canopy + fruit builders, used by every species file.
//
// Two goals:
//   1. NO sphere blobs. Tree canopies should look like leaves, not
//      balls. We build a single BufferGeometry containing hundreds of
//      flat leaf quads — one Mesh, one draw call per canopy, no
//      matter how dense.
//   2. Visible ripeness without glow. Unripe fruits are small + green;
//      ripe fruits are full-size + species colour (red cherry, orange
//      citrus, dark olive, etc.). main.js toggles which subgroup is
//      visible based on the plant's growth stage:
//          Mature (4)   → fruits-unripe shown
//          Fruiting (5) → fruits-ripe   shown
//      Materials use NO emissive — ripeness reads from real colour
//      contrast against the foliage, which is how it works in
//      real orchards.

import * as THREE from "three";

/**
 * Generate ~uniform random points inside a (squashed) sphere — used
 * as leaf positions for a canopy cluster. Points are biased slightly
 * toward the outer shell so the canopy reads as foliage, not a
 * filled mass.
 *
 * @param {THREE.Vector3} center
 * @param {number} radius
 * @param {number} count
 * @param {object} [opts]
 * @param {number} [opts.ySquash=1.0]  <1 = flatter, >1 = taller
 * @param {number} [opts.shellBias=0.55] 0=uniform fill, 1=shell only
 * @returns {THREE.Vector3[]}
 */
export function generateCanopyPoints(center, radius, count, opts = {}) {
    const ySquash = opts.ySquash ?? 1.0;
    const shellBias = opts.shellBias ?? 0.55;
    const points = [];
    while (points.length < count) {
        // Rejection-sample a point inside the unit sphere.
        const x = Math.random() * 2 - 1;
        const y = Math.random() * 2 - 1;
        const z = Math.random() * 2 - 1;
        const d2 = x * x + y * y + z * z;
        if (d2 > 1 || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        // Pull each point toward the shell by `shellBias`.
        const r = (1 - shellBias) * d + shellBias;
        const sx = (x / d) * r;
        const sy = (y / d) * r;
        const sz = (z / d) * r;
        points.push(new THREE.Vector3(
            center.x + sx * radius,
            center.y + sy * radius * ySquash,
            center.z + sz * radius,
        ));
    }
    return points;
}

/**
 * Build a single Mesh containing N flat leaf quads at the given
 * positions, with randomised rotations + slight colour variation.
 * One geometry, one material, one draw call.
 *
 * @param {THREE.Vector3[]} positions
 * @param {object} opts
 * @param {number} [opts.leafSize=0.28]
 * @param {number} [opts.sizeJitter=0.45]
 * @param {THREE.Color|number} [opts.color=0x3a7a2a]
 * @param {number} [opts.aspectW=1.0]  Leaf width multiplier
 * @param {number} [opts.aspectH=1.0]  Leaf height multiplier (>1 = long thin)
 * @returns {THREE.Mesh}
 */
export function buildLeafCloud(positions, opts = {}) {
    const leafSize   = opts.leafSize   ?? 0.28;
    const sizeJitter = opts.sizeJitter ?? 0.45;
    const aspectW    = opts.aspectW    ?? 1.0;
    const aspectH    = opts.aspectH    ?? 1.0;
    const color = opts.color instanceof THREE.Color
        ? opts.color
        : new THREE.Color(opts.color ?? 0x3a7a2a);

    const N = positions.length;
    const verts   = new Float32Array(N * 4 * 3);
    const normals = new Float32Array(N * 4 * 3);
    const uvs     = new Float32Array(N * 4 * 2);
    const colors  = new Float32Array(N * 4 * 3);
    const indices = new Uint32Array(N * 6);

    const tmpEuler = new THREE.Euler();
    const tmpQuat  = new THREE.Quaternion();
    const tmpVec   = new THREE.Vector3();
    const tmpNorm  = new THREE.Vector3();

    const cornerXY = [
        [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5],
    ];
    const cornerUV = [[0, 0], [1, 0], [1, 1], [0, 1]];

    for (let i = 0; i < N; i++) {
        const p = positions[i];
        const s = leafSize * (1 - sizeJitter + Math.random() * sizeJitter * 2);
        const w = s * aspectW;
        const h = s * aspectH;

        tmpEuler.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
        );
        tmpQuat.setFromEuler(tmpEuler);

        // Per-leaf colour variation in HSL space — natural-looking
        // tone shifts without needing a texture.
        const lc = color.clone().offsetHSL(
            (Math.random() - 0.5) * 0.05,
            (Math.random() - 0.5) * 0.10,
            (Math.random() - 0.5) * 0.14,
        );

        // Surface normal of this leaf = rotated +Z.
        tmpNorm.set(0, 0, 1).applyQuaternion(tmpQuat);

        for (let c = 0; c < 4; c++) {
            const [cx, cy] = cornerXY[c];
            tmpVec.set(cx * w, cy * h, 0).applyQuaternion(tmpQuat);
            const vi = (i * 4 + c) * 3;
            const ui = (i * 4 + c) * 2;
            verts[vi]     = p.x + tmpVec.x;
            verts[vi + 1] = p.y + tmpVec.y;
            verts[vi + 2] = p.z + tmpVec.z;
            normals[vi]     = tmpNorm.x;
            normals[vi + 1] = tmpNorm.y;
            normals[vi + 2] = tmpNorm.z;
            uvs[ui]     = cornerUV[c][0];
            uvs[ui + 1] = cornerUV[c][1];
            colors[vi]     = lc.r;
            colors[vi + 1] = lc.g;
            colors[vi + 2] = lc.b;
        }
        const base = i * 4;
        const ii = i * 6;
        indices[ii]     = base;
        indices[ii + 1] = base + 1;
        indices[ii + 2] = base + 2;
        indices[ii + 3] = base;
        indices[ii + 4] = base + 2;
        indices[ii + 5] = base + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setAttribute("normal",   new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv",       new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("color",    new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.88,
        metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
}

/**
 * Build a fruit cluster with TWO visible variants — unripe (small +
 * green) and ripe (full size + species colour). main.js toggles
 * which subgroup is visible based on growth stage so the player can
 * watch fruit ripen on the tree.
 *
 * Returns a THREE.Group named "fruits". Its children are named
 * "fruits-unripe" and "fruits-ripe". Both are hidden by default;
 * main.js sets visibility per stage.
 *
 * @param {THREE.Vector3[]} positions
 * @param {number} ripeColorHex
 * @param {object} [opts]
 * @param {number} [opts.size=0.16]        Ripe fruit sphere radius (m).
 * @param {number} [opts.elongation=1.0]   Y-scale (1.0 round, 1.4 berry, 1.6 plum).
 * @param {number} [opts.unripeColor=0x4a6a2a]
 * @returns {THREE.Group}
 */
export function buildFruitCluster(positions, ripeColorHex, opts = {}) {
    const size = opts.size ?? 0.16;
    const elongation = opts.elongation ?? 1.0;
    const unripeColor = opts.unripeColor ?? 0x4a6a2a;

    const root = new THREE.Group();
    root.name = "fruits";
    root.visible = false;

    const fruitGeo = new THREE.SphereGeometry(size, 8, 6);

    // Ripe — bright species colour, slight specular but NO emissive
    // glow. Ripeness reads via colour contrast against green foliage.
    const ripeMat = new THREE.MeshStandardMaterial({
        color: ripeColorHex,
        roughness: 0.42,
        metalness: 0.05,
    });
    const ripeGroup = new THREE.Group();
    ripeGroup.name = "fruits-ripe";
    ripeGroup.visible = false;
    for (const p of positions) {
        const f = new THREE.Mesh(fruitGeo, ripeMat);
        f.position.copy(p);
        f.scale.y = elongation;
        ripeGroup.add(f);
    }
    root.add(ripeGroup);

    // Unripe — smaller and dark green. Same positions so the player
    // sees fruits "fill in" with colour rather than appear out of
    // nowhere.
    const unripeMat = new THREE.MeshStandardMaterial({
        color: unripeColor,
        roughness: 0.7,
    });
    const unripeGroup = new THREE.Group();
    unripeGroup.name = "fruits-unripe";
    unripeGroup.visible = false;
    for (const p of positions) {
        const f = new THREE.Mesh(fruitGeo, unripeMat);
        f.position.copy(p);
        f.scale.set(0.65, elongation * 0.65, 0.65);
        unripeGroup.add(f);
    }
    root.add(unripeGroup);

    return root;
}
