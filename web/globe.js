// globe.js — a real, geographically-correct 3D Earth for the start screen.
//
// • Photoreal Earth texture (assets/earth.jpg, NASA-derived equirectangular).
// • Exact national borders from Natural Earth 1:110m (data/geo.js), drawn as
//   crisp lines so the map is precise, never vaguely sketched.
// • One difficulty pin per playable territory, coloured green→red by how hard
//   a food forest is there; click a pin to fly the globe to it and reveal its
//   regions (also pinned, also colour-graded).
//
// Self-contained: createGlobe(container, callbacks) → { dispose, focusCountry,
// setSelectedRegion }. Rotating the *globe group* (not the camera) keeps drag,
// idle-spin, and fly-to on one consistent model.

import * as THREE from "three";
import { WORLD_BORDERS, COUNTRY_RINGS } from "./data/geo.js";
import {
    WORLD_COUNTRIES, COUNTRY_GEO, REGION_INFO, difficultyColor,
} from "./data/world.js";

const R = 1;                       // globe radius (world units)
const D2R = Math.PI / 180;
// Longitude alignment between the texture's UVs and our lat/lon projection.
// three.js SphereGeometry maps texture u=0.5 (lon 0°, prime meridian) to the
// +X axis; with theta=(lon+180)° our point at longitude L lands exactly where
// the equirectangular texture shows longitude L. Verified by screenshot.
const LON_OFFSET = 180;

// lat/lon (degrees) → point on a sphere of radius r, in the globe's local
// frame. Matches the equirectangular earth texture's orientation.
function llToVec3(lat, lon, r = R, out = new THREE.Vector3()) {
    const phi = (90 - lat) * D2R;            // polar angle from +Y (north)
    const theta = (lon + LON_OFFSET) * D2R;  // azimuth
    const sp = Math.sin(phi);
    out.set(
        -r * sp * Math.cos(theta),
        r * Math.cos(phi),
        r * sp * Math.sin(theta),
    );
    return out;
}

export function createGlobe(container, callbacks = {}) {
    const onSelectCountry = callbacks.onSelectCountry || (() => {});
    const onSelectRegion = callbacks.onSelectRegion || (() => {});

    // ── Renderer ─────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block; width:100%; height:100%; cursor:grab; touch-action:none;";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 3.05);

    // ── Lighting ─────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.1);
    sun.position.set(-1.5, 0.8, 2.2);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.35);
    rim.position.set(2, -1, -1.5);
    scene.add(rim);

    // ── Starfield (static backdrop, gentle parallax) ─────────────────
    const starGeo = new THREE.BufferGeometry();
    const STAR_N = 1400;
    const starPos = new Float32Array(STAR_N * 3);
    for (let i = 0; i < STAR_N; i++) {
        // random point on a large sphere shell
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(1 - u * u);
        const d = 18 + Math.random() * 24;
        starPos[i * 3] = Math.cos(a) * rr * d;
        starPos[i * 3 + 1] = u * d;
        starPos[i * 3 + 2] = Math.sin(a) * rr * d;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0xbcd0ff, size: 0.13, sizeAttenuation: true, transparent: true, opacity: 0.8 }),
    );
    scene.add(stars);

    // ── The world group (everything that spins together) ─────────────
    const world = new THREE.Group();
    scene.add(world);

    // Earth sphere.
    const earthMat = new THREE.MeshPhongMaterial({
        color: 0x2a3a55, specular: 0x223344, shininess: 14,
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), earthMat);
    world.add(earth);
    new THREE.TextureLoader().load("./assets/earth.jpg?v=globe1", (tex) => {
        if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;
        earthMat.map = tex;
        earthMat.color.setHex(0xffffff);
        earthMat.needsUpdate = true;
    });

    // Atmosphere — additive back-side shell for a soft blue rim.
    const atmoMat = new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { glow: { value: new THREE.Color(0x4ea3ff) } },
        vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
        fragmentShader: `varying vec3 vN; uniform vec3 glow; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(glow, 1.0) * clamp(i,0.0,1.0);}`,
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.18, 64, 64), atmoMat);
    world.add(atmosphere);

    // ── Borders: exact Natural Earth coastlines/boundaries ───────────
    function ringsToSegments(rings, r) {
        const pts = [];
        const v = new THREE.Vector3();
        for (const ring of rings) {
            for (let i = 0; i + 1 < ring.length; i++) {
                llToVec3(ring[i][1], ring[i][0], r, v); pts.push(v.x, v.y, v.z);
                llToVec3(ring[i + 1][1], ring[i + 1][0], r, v); pts.push(v.x, v.y, v.z);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
        return g;
    }
    const borders = new THREE.LineSegments(
        ringsToSegments(WORLD_BORDERS, R * 1.001),
        new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.28 }),
    );
    world.add(borders);

    // Highlighted-country outlines (brighter), grouped by name so we can
    // emphasise the selected one.
    const countryOutlines = {};
    for (const [name, rings] of Object.entries(COUNTRY_RINGS)) {
        const ln = new THREE.LineSegments(
            ringsToSegments(rings, R * 1.0025),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0 }),
        );
        world.add(ln);
        countryOutlines[name] = ln;
    }

    // Faint graticule (lat/lon grid) for a precise "map" read.
    const grat = [];
    const gv = new THREE.Vector3();
    for (let lat = -60; lat <= 60; lat += 30) {
        for (let lon = -180; lon < 180; lon += 4) {
            llToVec3(lat, lon, R * 1.0005, gv); grat.push(gv.x, gv.y, gv.z);
            llToVec3(lat, lon + 4, R * 1.0005, gv); grat.push(gv.x, gv.y, gv.z);
        }
    }
    for (let lon = -180; lon < 180; lon += 30) {
        for (let lat = -88; lat < 88; lat += 4) {
            llToVec3(lat, lon, R * 1.0005, gv); grat.push(gv.x, gv.y, gv.z);
            llToVec3(lat + 4, lon, R * 1.0005, gv); grat.push(gv.x, gv.y, gv.z);
        }
    }
    const gratGeo = new THREE.BufferGeometry();
    gratGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(grat), 3));
    world.add(new THREE.LineSegments(gratGeo, new THREE.LineBasicMaterial({ color: 0x6fb0ff, transparent: true, opacity: 0.07 })));

    // ── Pins ─────────────────────────────────────────────────────────
    // A pin = a glowing colored head + a short stem standing off the
    // surface, oriented along the local normal. Territory pins reference a
    // country index; region pins reference a global region index.
    const UP = new THREE.Vector3(0, 1, 0);
    const _q = new THREE.Quaternion();
    const _n = new THREE.Vector3();

    function makePin(lat, lon, hex, scale, userData) {
        const pin = new THREE.Group();
        const stemLen = 0.10 * scale;
        const headR = 0.045 * scale;
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.008 * scale, 0.004 * scale, stemLen, 6),
            new THREE.MeshBasicMaterial({ color: hex }),
        );
        stem.position.y = stemLen / 2;
        pin.add(stem);
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(headR, 16, 12),
            new THREE.MeshBasicMaterial({ color: hex }),
        );
        head.position.y = stemLen;
        head.userData = userData;          // raycast target carries the data
        pin.add(head);
        // soft halo disc behind the head
        const halo = new THREE.Mesh(
            new THREE.CircleGeometry(headR * 2.1, 18),
            new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
        );
        halo.position.y = stemLen;
        pin.add(halo);

        llToVec3(lat, lon, R, _n);
        pin.position.copy(_n);
        _n.normalize();
        pin.quaternion.copy(_q.setFromUnitVectors(UP, _n));
        pin.userData = { head, halo, stem, headR, baseScale: scale, ...userData };
        return pin;
    }

    function makeLabel(text) {
        const pad = 16, fs = 44;
        const c = document.createElement("canvas");
        const cx = c.getContext("2d");
        cx.font = `bold ${fs}px system-ui, sans-serif`;
        const w = Math.ceil(cx.measureText(text).width) + pad * 2;
        c.width = w; c.height = fs + pad * 2;
        cx.font = `bold ${fs}px system-ui, sans-serif`;
        cx.fillStyle = "rgba(8,14,22,0.82)";
        roundRect(cx, 0, 0, c.width, c.height, 14); cx.fill();
        cx.strokeStyle = "rgba(150,210,255,0.55)"; cx.lineWidth = 2;
        roundRect(cx, 1, 1, c.width - 2, c.height - 2, 13); cx.stroke();
        cx.fillStyle = "#eaf6ff"; cx.textBaseline = "middle"; cx.textAlign = "center";
        cx.fillText(text, c.width / 2, c.height / 2 + 2);
        const tex = new THREE.CanvasTexture(c);
        if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
        spr.scale.set(c.width / c.height * 0.16, 0.16, 1);
        spr.userData.aspect = c.width / c.height;
        return spr;
    }
    function roundRect(cx, x, y, w, h, r) {
        cx.beginPath();
        cx.moveTo(x + r, y);
        cx.arcTo(x + w, y, x + w, y + h, r);
        cx.arcTo(x + w, y + h, x, y + h, r);
        cx.arcTo(x, y + h, x, y, r);
        cx.arcTo(x, y, x + w, y, r);
        cx.closePath();
    }

    // Territory pins + labels.
    const territoryPins = [];
    const pinHeads = [];               // raycast set
    const labels = [];                 // {sprite, anchor(Vector3 local), kind}
    WORLD_COUNTRIES.forEach((c, idx) => {
        const geo = COUNTRY_GEO[c.name];
        if (!geo) return;
        const hex = difficultyColor(geo.stars).hex;
        const pin = makePin(geo.lat, geo.lon, hex, 1.0, { kind: "country", countryIdx: idx, name: c.name });
        world.add(pin);
        territoryPins.push(pin);
        pinHeads.push(pin.userData.head);

        const label = makeLabel(c.name);
        const anchor = llToVec3(geo.lat, geo.lon, R + 0.17);
        label.position.copy(anchor);
        label.userData.kind = "country";
        label.userData.countryIdx = idx;
        label.userData.anchor = anchor.clone();
        label.material.opacity = 0;
        world.add(label);
        labels.push(label);
        pin.userData.label = label;
    });

    // Region pins (created on demand when a country is focused).
    let regionPins = [];
    let regionLabels = [];
    function clearRegionPins() {
        for (const p of regionPins) { world.remove(p); disposeObj(p); }
        for (const l of regionLabels) { world.remove(l); l.material.map?.dispose(); l.material.dispose(); }
        regionPins = []; regionLabels = [];
        // remove region heads from the raycast set
        for (let i = pinHeads.length - 1; i >= 0; i--) {
            if (pinHeads[i].userData.kind === "region") pinHeads.splice(i, 1);
        }
    }
    function buildRegionPins(countryIdx) {
        clearRegionPins();
        const c = WORLD_COUNTRIES[countryIdx];
        for (let r = 0; r < c.count; r++) {
            const name = c.regions[r];
            const info = REGION_INFO[name];
            if (!info) continue;
            const hex = difficultyColor(info.stars).hex;
            const gIdx = c.start + r;
            const pin = makePin(info.lat, info.lon, hex, 0.62, { kind: "region", regionIdx: gIdx, name });
            world.add(pin);
            regionPins.push(pin);
            pinHeads.push(pin.userData.head);

            const label = makeLabel(name);
            const anchor = llToVec3(info.lat, info.lon, R + 0.11);
            label.position.copy(anchor);
            label.userData.kind = "region";
            label.userData.regionIdx = gIdx;
            label.userData.anchor = anchor.clone();
            label.material.opacity = 0;
            world.add(label);
            regionLabels.push(label);
            pin.userData.label = label;
        }
    }

    // ── Orientation: drag, idle spin, fly-to ─────────────────────────
    let idleSpin = true;
    let targetQuat = null;             // when set, slerp toward it
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    const _qy = new THREE.Quaternion();
    const _qx = new THREE.Quaternion();
    const AXIS_Y = new THREE.Vector3(0, 1, 0);
    const AXIS_X = new THREE.Vector3(1, 0, 0);

    function orientationFor(lat, lon) {
        // Quaternion that brings (lat,lon) to face the camera (+Z) with
        // north kept roughly up.
        const target = llToVec3(lat, lon, 1).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(target, new THREE.Vector3(0, 0, 1));
        const upAfter = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const roll = Math.atan2(upAfter.x, upAfter.y);
        const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll);
        return qz.multiply(q);
    }

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered = null;

    function pointerNDC(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    function pickHead(e) {
        pointerNDC(e);
        ray.setFromCamera(ndc, camera);
        // only near-side, visible heads
        const hits = ray.intersectObjects(pinHeads.filter(h => h.visible), false);
        return hits.length ? hits[0].object : null;
    }

    function onDown(e) {
        dragging = true; moved = 0;
        lastX = e.clientX; lastY = e.clientY;
        idleSpin = false; targetQuat = null;
        renderer.domElement.style.cursor = "grabbing";
        renderer.domElement.setPointerCapture?.(e.pointerId);
    }
    function onMove(e) {
        if (dragging) {
            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            moved += Math.abs(dx) + Math.abs(dy);
            const k = 0.005;
            _qy.setFromAxisAngle(AXIS_Y, dx * k);
            _qx.setFromAxisAngle(AXIS_X, dy * k);
            world.quaternion.premultiply(_qy).premultiply(_qx);
            return;
        }
        // hover
        const head = pickHead(e);
        if (head !== (hovered && hovered.userData.head)) {
            setHover(head ? head.parent : null);
        }
        renderer.domElement.style.cursor = head ? "pointer" : "grab";
    }
    function onUp(e) {
        if (dragging && moved < 6) {
            const head = pickHead(e);
            if (head) selectPin(head.parent);
        }
        dragging = false;
        renderer.domElement.style.cursor = "grab";
    }
    function onWheel(e) {
        e.preventDefault();
        camera.position.z = Math.max(1.9, Math.min(4.2, camera.position.z + Math.sign(e.deltaY) * 0.16));
    }

    function setHover(pin) {
        if (hovered === pin) return;
        if (hovered && hovered !== selectedPin) hovered.userData.label.material.opacity = 0;
        hovered = pin;
        if (hovered) hovered.userData.label.material.opacity = 1;
    }

    let selectedPin = null;
    let selectedCountryIdx = -1;

    function selectPin(pin) {
        const d = pin.userData;
        if (d.kind === "country") {
            focusCountry(d.countryIdx, true);
            onSelectCountry(d.countryIdx);
        } else if (d.kind === "region") {
            setSelectedRegion(d.regionIdx);
            onSelectRegion(d.regionIdx);
        }
    }

    // Public: focus a country (fly-to + region pins + outline emphasis).
    function focusCountry(idx, animate = true) {
        selectedCountryIdx = idx;
        const c = WORLD_COUNTRIES[idx];
        const geo = COUNTRY_GEO[c.name];
        idleSpin = false;
        if (geo) {
            targetQuat = animate ? orientationFor(geo.lat, geo.lon) : null;
            if (!animate) world.quaternion.copy(orientationFor(geo.lat, geo.lon));
        }
        // emphasise outline of the focused country, dim others
        for (const [name, ln] of Object.entries(countryOutlines)) {
            ln.material.opacity = (name === c.name) ? 0.9 : 0.0;
            if (name === c.name) ln.material.color.setHex(difficultyColor(geo?.stars || 3).hex);
        }
        // Drill-in: hide this country's own pin + label so its big name
        // ("Spain") can't collide with a region name ("Galicia"). Its
        // regions take over the area and the side panel still names it.
        // Other countries stay pinned so you can jump straight to them.
        territoryPins.forEach((p, i) => {
            p.userData.hidden = (i === idx);
            p.userData.label.material.opacity = 0;
        });
        selectedPin = null;
        buildRegionPins(idx);
        camera._zoomTarget = 2.55;     // ease camera slightly closer
    }

    // Public: mark a region selected (highlight its pin + keep its label
    // up through subsequent hovers via selectedPin).
    let selectedRegionIdx = -1;
    function setSelectedRegion(gIdx) {
        selectedRegionIdx = gIdx;
        selectedPin = null;
        for (const p of regionPins) {
            const on = p.userData.regionIdx === gIdx;
            p.userData.label.material.opacity = on ? 1 : 0;
            if (on) selectedPin = p;
        }
    }

    // ── Per-frame ────────────────────────────────────────────────────
    const camDir = new THREE.Vector3();
    const wp = new THREE.Vector3();
    let raf = 0, running = true;

    function frame() {
        if (!running) return;
        raf = requestAnimationFrame(frame);

        if (idleSpin && !dragging) {
            _qy.setFromAxisAngle(AXIS_Y, 0.0016);
            world.quaternion.premultiply(_qy);
        }
        if (targetQuat) {
            world.quaternion.slerp(targetQuat, 0.12);
            if (world.quaternion.angleTo(targetQuat) < 0.002) targetQuat = null;
        }
        if (camera._zoomTarget) {
            camera.position.z += (camera._zoomTarget - camera.position.z) * 0.08;
            if (Math.abs(camera._zoomTarget - camera.position.z) < 0.01) camera._zoomTarget = 0;
        }
        stars.rotation.y += 0.0002;

        // Occlusion: hide pins/labels on the far hemisphere; scale hovered.
        camDir.copy(camera.position).normalize();
        const allPins = territoryPins.concat(regionPins);
        for (const p of allPins) {
            p.getWorldPosition(wp);
            const facing = wp.normalize().dot(camDir);   // >0 → near side
            const vis = facing > 0.02 && !p.userData.hidden;
            p.visible = vis;
            const head = p.userData.head;
            const target = (p === hovered ? 1.4 : 1.0) * (selectedRegionIdx === p.userData.regionIdx && p.userData.kind === "region" ? 1.35 : 1.0);
            p.scale.lerp(_tmpScale.setScalar(vis ? target : 0.001), 0.25);
            head.visible = vis;
        }
        for (const l of labels.concat(regionLabels)) {
            if (l.material.opacity <= 0.001) continue;
            l.getWorldPosition(wp);
            const facing = wp.clone().normalize().dot(camDir);
            l.visible = facing > 0.05;
        }

        renderer.render(scene, camera);
    }
    const _tmpScale = new THREE.Vector3();

    // ── Resize ───────────────────────────────────────────────────────
    function resize() {
        const w = container.clientWidth || 1, h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // ── Wire events ──────────────────────────────────────────────────
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", () => { dragging = false; setHover(null); });
    el.addEventListener("wheel", onWheel, { passive: false });

    frame();

    // ── Teardown ─────────────────────────────────────────────────────
    function disposeObj(obj) {
        obj.traverse?.((o) => {
            o.geometry?.dispose?.();
            if (o.material) {
                (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
                    m.map?.dispose?.(); m.dispose?.();
                });
            }
        });
    }
    function dispose() {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("wheel", onWheel);
        disposeObj(scene);
        earthMat.map?.dispose?.();
        renderer.dispose();
        el.remove();
    }

    return { dispose, focusCountry, setSelectedRegion };
}
