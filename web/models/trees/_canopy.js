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

    // Rounder, smoother spheres so ripe fruit looks plump + appetising.
    const fruitGeo = new THREE.SphereGeometry(size, 12, 10);

    // Ripe — bright species colour with a soft waxy sheen (low roughness
    // + a touch of clearcoat-like specular via metalness). No emissive
    // glow; ripeness reads from colour contrast against the foliage.
    const ripeMat = new THREE.MeshStandardMaterial({
        color: ripeColorHex,
        roughness: 0.32,
        metalness: 0.0,
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

// ── Recursive, naturally-curving branch generator ────────────────────
// Real branches taper, bend, and fork — they are never straight tubes.
// We grow a small recursive tree: each branch is a chain of short
// tapered segments whose direction drifts a little each step (organic
// bend), and at each fork it splits into thinner, shorter children that
// splay outward + upward (phototropism). Terminal twigs carry leaf
// clusters. ALL branch segments are emitted into a single merged
// BufferGeometry (one draw call per tree) so the recursion stays cheap.

function _branchAccumulator() {
    return { pos: [], norm: [], idx: [], v: 0 };
}

// Scratch vectors reused across the whole build.
const _tan = new THREE.Vector3();
const _prevTan = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _bin = new THREE.Vector3();
const _rotQ = new THREE.Quaternion();

/**
 * Emit ONE continuous tapered tube through a polyline of centre points,
 * into the merged accumulator. Uses a rotation-minimising (parallel-
 * transport) frame so the cross-section never twists — consecutive
 * rings stay aligned, giving a smooth solid branch instead of the
 * kinked/torn look you get when each segment frames itself.
 *
 *   pts:    THREE.Vector3[]  centreline (>= 2 points)
 *   radii:  number[]         radius at each point
 *   radial: int              sides of the tube cross-section
 */
function _emitTube(acc, pts, radii, radial) {
    const n = pts.length;
    if (n < 2) return;

    // Initial frame at pts[0].
    _tan.subVectors(pts[1], pts[0]).normalize();
    // Pick a normal not parallel to the tangent.
    if (Math.abs(_tan.y) < 0.99) _nrm.set(0, 1, 0);
    else _nrm.set(1, 0, 0);
    _bin.crossVectors(_tan, _nrm).normalize();
    _nrm.crossVectors(_bin, _tan).normalize();

    const ringStart = [];
    for (let i = 0; i < n; i++) {
        // Tangent at this point (forward difference, last reuses prev).
        if (i < n - 1) {
            _prevTan.copy(_tan);
            _tan.subVectors(pts[i + 1], pts[i]).normalize();
            // Parallel-transport the normal: rotate it by the same
            // rotation that turns the previous tangent into this one.
            _rotQ.setFromUnitVectors(_prevTan, _tan);
            _nrm.applyQuaternion(_rotQ);
        }
        // Re-orthonormalise to kill drift.
        _bin.crossVectors(_tan, _nrm).normalize();
        _nrm.crossVectors(_bin, _tan).normalize();

        ringStart.push(acc.v);
        const r = Math.max(radii[i], 0.01);
        const p = pts[i];
        for (let k = 0; k <= radial; k++) {
            const th = (k / radial) * Math.PI * 2;
            const c = Math.cos(th), s = Math.sin(th);
            const ox = _nrm.x * c + _bin.x * s;
            const oy = _nrm.y * c + _bin.y * s;
            const oz = _nrm.z * c + _bin.z * s;
            acc.pos.push(p.x + ox * r, p.y + oy * r, p.z + oz * r);
            acc.norm.push(ox, oy, oz);
        }
        acc.v += radial + 1;
    }

    // Connect consecutive rings into quads.
    for (let i = 0; i < n - 1; i++) {
        const a0 = ringStart[i];
        const b0 = ringStart[i + 1];
        for (let k = 0; k < radial; k++) {
            const a = a0 + k, b = a0 + k + 1;
            const c = b0 + k, d = b0 + k + 1;
            acc.idx.push(a, c, d, a, d, b);
        }
    }
}

function _accToMesh(acc, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(acc.norm, 3));
    g.setIndex(acc.idx);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
}

// Grow one branch recursively. Builds a curved centreline, emits it as a
// continuous tube, then either forks into thinner children or (at the
// leaves) drops a leaf cluster AND records the tip so fruit can hang
// from it.
function _grow(acc, leafSink, tipSink, start, dir, length, radius, depth, cfg) {
    const segs = cfg.segs;
    const segLen = length / segs;
    const pts = [start.clone()];
    const radii = [radius];
    const d = dir.clone().normalize();
    let pos = start.clone();
    for (let s = 0; s < segs; s++) {
        pos = pos.clone().addScaledVector(d, segLen);
        pts.push(pos.clone());
        radii.push(Math.max(radius * (1 - ((s + 1) / segs) * (1 - cfg.taper)), 0.012));
        // Bend: small random drift + a vertical bias (curve gently
        // upward, or downward for droopy species).
        d.x += (Math.random() - 0.5) * cfg.curve;
        d.z += (Math.random() - 0.5) * cfg.curve;
        d.y += cfg.upBias;
        d.normalize();
    }
    _emitTube(acc, pts, radii, 6);
    const tip = pts[pts.length - 1];

    if (depth <= 0) {
        // Terminal twig → leaf cluster + remember the tip for fruit.
        for (const p of generateCanopyPoints(tip, cfg.clusterRadius, cfg.leavesPerCluster,
            { ySquash: 0.9, shellBias: 0.4 })) leafSink.push(p);
        tipSink.push(tip.clone());
        return;
    }
    // Fork into thinner, shorter children that splay outward + up.
    const cn = cfg.children;
    for (let i = 0; i < cn; i++) {
        const az = (i / cn) * Math.PI * 2 + Math.random() * 0.8;
        const child = d.clone();
        child.x += Math.cos(az) * cfg.splay;
        child.z += Math.sin(az) * cfg.splay;
        child.y += cfg.splay * 0.45;          // children also rise
        child.normalize();
        _grow(acc, leafSink, tipSink, tip.clone(), child,
            length * cfg.lengthFalloff, radius * cfg.radiusFalloff, depth - 1, cfg);
    }
}

/**
 * Build a realistic branch-and-leaf canopy. Boughs grow recursively
 * from `base`, curving and forking, with leaf clusters at the twig
 * tips. Per-species topology is controlled by the optional shaping
 * params (depth, curve, upBias, splay, …).
 *
 * @param {object} opts
 * @param {THREE.Vector3} opts.base   Where branching starts (trunk top).
 * @param {number} opts.spread        Canopy radius (drives splay + leaf cluster size).
 * @param {number} opts.rise          Length of the first-level boughs.
 * @param {number} [opts.branches=5]  Number of primary boughs.
 * @param {number} opts.barkColor
 * @param {number} opts.leafColor
 * @param {number} [opts.boughRadius=0.09]
 * @param {number} [opts.leafSize=0.16]
 * @param {number} [opts.clusterRadius=0.7]
 * @param {number} [opts.leavesPerCluster=70]
 * @param {number} [opts.aspectW=1.0]
 * @param {number} [opts.aspectH=1.0]
 * @param {number} [opts.depth=2]     Fork recursion depth.
 * @param {number} [opts.curve=0.28]  Per-segment random bend.
 * @param {number} [opts.upBias=0.12] Upward curl (negative = droop).
 * @param {number} [opts.splay=0.55]  How widely forks spread.
 * @param {number} [opts.startElevation=0.85] Initial bough rise vs out (1=straight up).
 * @returns {THREE.Group}
 */
export function buildBranchyCanopy(opts) {
    const {
        base, spread, rise,
        branches = 5, barkColor, leafColor,
        boughRadius = 0.09, leafSize = 0.16,
        clusterRadius = 0.7, leavesPerCluster = 70,
        aspectW = 1.0, aspectH = 1.0,
        depth = 2, curve = 0.28, upBias = 0.12, splay = 0.55,
        startElevation = 0.85,
        // Optional fruit, hung from real twig tips (not floating).
        fruitColor, fruitCount = 0, fruitSize = 0.16,
        fruitElongation = 1.0, unripeColor,
    } = opts;

    const group = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: barkColor, roughness: 0.93 });
    const acc = _branchAccumulator();
    const leafSink = [];
    const tipSink = [];

    const cfg = {
        segs: 4,
        taper: 0.55,
        children: 2,
        splay,
        lengthFalloff: 0.74,
        radiusFalloff: 0.56,
        curve,
        upBias,
        clusterRadius,
        leavesPerCluster,
    };

    for (let i = 0; i < branches; i++) {
        const az = (i / branches) * Math.PI * 2 + Math.random() * 0.5;
        // First-level boughs leave the trunk top angled out + up. A
        // higher startElevation makes a tall narrow tree; lower makes a
        // broad spreading one.
        const out = 1 - startElevation;
        const dir = new THREE.Vector3(
            Math.cos(az) * out,
            startElevation,
            Math.sin(az) * out,
        ).normalize();
        _grow(acc, leafSink, tipSink, base.clone(), dir, rise, boughRadius, depth, cfg);
    }

    if (acc.idx.length > 0) group.add(_accToMesh(acc, barkMat));
    group.add(buildLeafCloud(leafSink, {
        leafSize, sizeJitter: 0.5, color: new THREE.Color(leafColor),
        aspectW, aspectH,
    }));

    // Fruit hangs from actual twig tips, nestled just below the foliage
    // — so it reads as growing on the branch, never floating in space.
    if (fruitColor !== undefined && fruitCount > 0 && tipSink.length > 0) {
        const fruitPositions = [];
        for (let i = 0; i < fruitCount; i++) {
            const tip = tipSink[(Math.random() * tipSink.length) | 0];
            fruitPositions.push(new THREE.Vector3(
                tip.x + (Math.random() - 0.5) * 0.22,
                tip.y - 0.10 - Math.random() * 0.14,   // hang below the twig
                tip.z + (Math.random() - 0.5) * 0.22,
            ));
        }
        group.add(buildFruitCluster(fruitPositions, fruitColor, {
            size: fruitSize, elongation: fruitElongation, unripeColor,
        }));
    }

    return group;
}
