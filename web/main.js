import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let ws = null;
let connected = false;
let playerName = "Farmer";
let selectedAction = null;
let myEntityId = 0;
let selectedGameMode = 0;

let scene, camera, renderer, controls;
let entityMeshes = new Map();
let entityKinds = new Map();
let terrainGroup = null;

const keys = new Set();
let inputSeq = 0;

// Connect screen
document.getElementById("connect-btn").addEventListener("click", () => {
    playerName = document.getElementById("player-name").value || "Farmer";
    const serverUrl = document.getElementById("server-url").value || "ws://localhost:9000";
    document.getElementById("connect-screen").style.display = "none";
    init(serverUrl);
});

document.getElementById("player-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("connect-btn").click();
});

const modeDescriptions = {
    0: "No casualties. Trees disappear when cut. Relaxed pace for all ages.",
    1: "Full felling physics. Falling trees can crush you. Real danger.",
    2: "Clear the eucalyptus in 15 minutes or wildfire burns everything.",
};

document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".mode-btn").forEach(b => {
            b.style.background = "#1a2a1a";
            b.style.color = "#aaa";
            b.style.borderColor = "#444";
            b.classList.remove("active");
        });
        btn.style.background = "#2a5a2a";
        btn.style.color = "#cfc";
        btn.style.borderColor = "#4a4";
        btn.classList.add("active");
        selectedGameMode = parseInt(btn.dataset.mode);
        document.getElementById("mode-desc").textContent = modeDescriptions[selectedGameMode];
    });
});

// Toolbar
document.querySelectorAll("#toolbar button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#toolbar button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedAction = btn.dataset.action;
    });
});

async function init(serverUrl) {
    updateStatus("Loading...");
    initRenderer();
    connectWebSocket(serverUrl);
    requestAnimationFrame(gameLoop);
}

function initRenderer() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 200, 800);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(20, 40, 20);
    camera.lookAt(20, 0, 25);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minDistance = 5;
    controls.maxDistance = 300;

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.5);
    sun.position.set(100, 200, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x404860, 0.6));
    scene.add(new THREE.HemisphereLight(0x87CEEB, 0x4a3a2a, 0.4));

    // Raycaster for click interactions
    renderer.domElement.addEventListener("click", onWorldClick);

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// --- Bincode v2 reader (standard config, variable-length integers) ---

class BincodeReader {
    constructor(buffer) {
        this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.offset = 0;
    }

    readU8() {
        const v = this.view.getUint8(this.offset);
        this.offset += 1;
        return v;
    }

    readBool() {
        return this.readU8() !== 0;
    }

    readVarint() {
        const first = this.readU8();
        if (first < 251) return first;
        if (first === 251) {
            const lo = this.readU8();
            const hi = this.readU8();
            return lo | (hi << 8);
        }
        if (first === 252) {
            const b0 = this.readU8();
            const b1 = this.readU8();
            const b2 = this.readU8();
            const b3 = this.readU8();
            return b0 | (b1 << 8) | (b2 << 16) | ((b3 << 24) >>> 0);
        }
        if (first === 253) {
            const lo = this.readU8() | (this.readU8() << 8) |
                       (this.readU8() << 16) | ((this.readU8() << 24) >>> 0);
            const hi = this.readU8() | (this.readU8() << 8) |
                       (this.readU8() << 16) | ((this.readU8() << 24) >>> 0);
            return lo + hi * 0x100000000;
        }
        throw new Error("Invalid varint prefix: " + first);
    }

    readU16() { return this.readVarint(); }
    readU32() { return this.readVarint(); }
    readU64() { return this.readVarint(); }

    readF32() {
        const v = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return v;
    }

    readString() {
        const len = this.readVarint();
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
        this.offset += len;
        return new TextDecoder().decode(bytes);
    }

    readBytes(n) {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n);
        this.offset += n;
        return bytes;
    }

    remaining() {
        return this.view.byteLength - this.offset;
    }
}

// --- Bincode v2 encoder helpers ---

function encodeVarint(value) {
    if (value < 251) return [value];
    if (value <= 0xFFFF) return [251, value & 0xFF, (value >> 8) & 0xFF];
    if (value <= 0xFFFFFFFF) return [252, value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF];
    throw new Error("varint > u32 not implemented for encoder");
}

function encodeZigzagVarint(value) {
    const zigzag = (value << 1) ^ (value >> 31);
    return encodeVarint(zigzag >>> 0);
}

function encodeF32(value) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    return [...new Uint8Array(buf)];
}

function encodeBincodeString(str) {
    const bytes = new TextEncoder().encode(str);
    return [...encodeVarint(bytes.length), ...bytes];
}

function buildFramedMessage(msgType, payloadBytes) {
    const frame = new Uint8Array(6 + payloadBytes.length);
    const view = new DataView(frame.buffer);
    view.setUint16(0, msgType, true);
    view.setUint32(2, payloadBytes.length, true);
    frame.set(payloadBytes, 6);
    return frame;
}

function buildHelloMessage(name, gameMode) {
    const payload = new Uint8Array([
        ...encodeBincodeString(name),
        ...encodeBincodeString("dev-token"),
        ...encodeVarint(1),
        gameMode,
    ]);
    return buildFramedMessage(0x0001, payload);
}

function buildInputMessage(mx, mz, yaw, jump, sprint) {
    inputSeq++;
    const buf = new ArrayBuffer(64);
    const parts = [
        ...encodeVarint(inputSeq),
        ...encodeVarint(0), // tick (client doesn't track server tick yet)
    ];
    const payload = new Uint8Array(parts.length + 12 + 1 + 1);
    payload.set(parts, 0);
    let o = parts.length;
    const view = new DataView(payload.buffer);
    view.setFloat32(o, mx, true); o += 4;
    view.setFloat32(o, mz, true); o += 4;
    view.setFloat32(o, yaw, true); o += 4;
    payload[o++] = jump ? 1 : 0;
    payload[o++] = sprint ? 1 : 0;
    return buildFramedMessage(0x0002, payload.slice(0, o));
}

function buildActionMessage(actionKind) {
    inputSeq++;
    const seqBytes = encodeVarint(inputSeq);
    const payload = new Uint8Array([...seqBytes, ...actionKind]);
    return buildFramedMessage(0x0003, payload);
}

function buildChatMessage(text) {
    const payload = new Uint8Array(encodeBincodeString(text));
    return buildFramedMessage(0x0004, payload);
}

// --- WebSocket ---

function connectWebSocket(url) {
    updateStatus("Connecting to " + url + "...");
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        updateStatus("Connected! Sending hello...");
        connected = true;
        ws.send(buildHelloMessage(playerName, selectedGameMode));
    };

    ws.onmessage = (event) => {
        handleServerMessage(new Uint8Array(event.data));
    };

    ws.onclose = () => {
        updateStatus("Disconnected. Refresh to reconnect.");
        connected = false;
    };

    ws.onerror = () => {
        updateStatus("Connection failed. Is the server running on " + url + "?");
    };
}

// --- Message handling ---

function handleServerMessage(data) {
    if (data.length < 6) return;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const msgType = view.getUint16(0, true);
    const payloadLen = view.getUint32(2, true);
    const payload = data.slice(6, 6 + payloadLen);

    switch (msgType) {
        case 0x0101: handleWelcome(payload); break;
        case 0x0102: handleWorldState(payload); break;
        case 0x010D: handleBatchUpdate(payload); break;
        case 0x010A: handleChat(payload); break;
        case 0x0104: handleEntityDespawn(payload); break;
        case 0x010B: break; // pong
        case 0x010C: handleActionResult(payload); break;
        default:
            console.log("Unknown msg 0x" + msgType.toString(16), payloadLen, "bytes");
    }
}

function handleWelcome(payload) {
    const r = new BincodeReader(payload);
    myEntityId = r.readU64();
    const playerId = r.readU64();
    const shardId = r.readU32();
    const tick = r.readU64();
    const tickRate = r.readU32();
    updateStatus("Welcome! Entity " + myEntityId + " | Tick " + tick + " | " + tickRate + "Hz");
    console.log("Welcome: entity=" + myEntityId + " player=" + playerId + " shard=" + shardId);
}

function handleWorldState(payload) {
    const r = new BincodeReader(payload);
    const tick = r.readU64();

    // Calendar
    const calTick = r.readU64();
    const calDay = r.readU32();
    const calSeason = r.readU8();
    const calYear = r.readU32();

    // Weather
    const temp = r.readF32();
    const rain = r.readF32();
    const wind = r.readF32();
    const clouds = r.readF32();
    const sunlight = r.readF32();

    // Entities
    const entityCount = r.readVarint();
    console.log("WorldState: " + entityCount + " entities, day " + calDay + " season " + calSeason);

    for (let i = 0; i < entityCount; i++) {
        const eid = r.readU64();
        const kindTag = r.readVarint();
        let kind = "unknown";
        let speciesId = 0;

        if (kindTag === 0) {
            kind = "player";
        } else if (kindTag === 1) {
            speciesId = r.readU16();
            kind = "plant";
        } else if (kindTag === 2) {
            speciesId = r.readU16();
            kind = "animal";
        } else if (kindTag === 3) {
            r.readU8(); // role
            kind = "npc";
        } else if (kindTag === 4) {
            r.readU16(); // item_id
            kind = "item";
        }

        const px = r.readF32();
        const py = r.readF32();
        const pz = r.readF32();
        const rot = r.readF32();

        // EntityState enum
        const stateTag = r.readVarint();
        if (stateTag === 0) {
            // Active - no extra fields
        } else if (stateTag === 1) {
            // PlantGrowth { stage: u8, health: f32 }
            r.readU8();
            r.readF32();
        } else if (stateTag === 2) {
            // AnimalBehavior { behavior: u8, hunger: f32 }
            r.readU8();
            r.readF32();
        } else if (stateTag === 3) {
            // PlayerVisible { held_item: Option<u16>, animation: u8 }
            const hasItem = r.readU8();
            if (hasItem === 1) r.readU16();
            r.readU8();
        }

        entityKinds.set(eid, { kind, speciesId });

        // Determine visual category
        let category = classifyEntity(kind, speciesId);
        createOrUpdateEntity(eid, px, py, pz, rot, category);
    }

    // Terrain bytes (Vec<u8> = varint len + raw bytes)
    const terrainLen = r.readVarint();
    console.log("Terrain: " + terrainLen + " bytes");

    if (terrainLen >= 12) {
        const terrainData = r.readBytes(terrainLen);
        renderTerrain(terrainData);
    }

    updateStatus("Portugal Food Forest — Day " + calDay + " | " +
        ["Spring", "Summer", "Autumn", "Winter"][calSeason] +
        " | " + temp.toFixed(1) + "C | " + entityCount + " entities");
}

function handleBatchUpdate(payload) {
    try {
        const r = new BincodeReader(payload);
        const tick = r.readU64();
        const count = r.readVarint();

        for (let i = 0; i < count; i++) {
            const eid = r.readU64();
            const px = r.readF32();
            const py = r.readF32();
            const pz = r.readF32();
            const rot = r.readF32();
            const flags = r.readU8();

            const info = entityKinds.get(eid);
            let category = "unknown";
            if (info) {
                category = classifyEntity(info.kind, info.speciesId);
            } else if (eid === myEntityId) {
                category = "player";
                entityKinds.set(eid, { kind: "player", speciesId: 0 });
            }

            createOrUpdateEntity(eid, px, py, pz, rot, category);

            const isFalling = (flags & 0x08) !== 0;
            const isCollapsed = (flags & 0x10) !== 0;
            const isDead = (flags & 0x20) !== 0;
            const isBurning = (flags & 0x40) !== 0;

            if (isFalling || isCollapsed || isDead) {
                const obj = entityMeshes.get(eid);
                if (obj) {
                    const progress = (isCollapsed || isDead) ? 1.0 : 0.5;
                    obj.rotation.x = -Math.PI / 2 * progress;
                }
            }

            if (isBurning) {
                addFlameEffect(eid);
            }
        }
    } catch (e) {
    }
}

function handleChat(payload) {
    const r = new BincodeReader(payload);
    const sender = r.readU64();
    const senderName = r.readString();
    const message = r.readString();

    const chatLog = document.getElementById("chat-log");
    const line = document.createElement("div");
    line.textContent = senderName + ": " + message;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function handleEntityDespawn(payload) {
    const r = new BincodeReader(payload);
    const eid = r.readU64();
    removeFlameEffect(eid);
    const obj = entityMeshes.get(eid);
    if (obj) {
        scene.remove(obj);
        entityMeshes.delete(eid);
    }
    entityKinds.delete(eid);
}

function handleActionResult(payload) {
    const r = new BincodeReader(payload);
    const seq = r.readU32();
    const success = r.readBool();
    const hasMsg = r.readU8();
    let message = "";
    if (hasMsg === 1) message = r.readString();

    const chatLog = document.getElementById("chat-log");
    const line = document.createElement("div");
    line.style.color = success ? "#8f8" : "#f88";
    line.textContent = (success ? "[OK] " : "[FAIL] ") + message;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// --- Entity classification ---

function classifyEntity(kind, speciesId) {
    if (kind === "player") return "player";
    if (kind === "animal") return "animal";
    if (kind === "npc") return "npc";
    if (kind === "plant") {
        if (speciesId === 103) return "eucalyptus";
        if (speciesId >= 100 && speciesId < 300) return "tree";
        if (speciesId >= 300 && speciesId < 400) return "shrub";
        if (speciesId >= 400 && speciesId < 600) return "herb";
        return "tree";
    }
    return "unknown";
}

// --- Terrain rendering ---

const VOXEL_COLORS = {
    1: 0x888888, // Stone
    2: 0x6B4423, // Soil
    3: 0x3a7a2a, // Grass
    4: 0x2266aa, // Water
    5: 0xd4b896, // Sand
    6: 0xaa7744, // Clay
    7: 0x554422, // Mulch
    8: 0x226688, // Swale
    9: 0x664422, // HugelBed
    10: 0x1a5a1a, // Canopy
};

function renderTerrain(terrainData) {
    if (terrainGroup) {
        scene.remove(terrainGroup);
    }
    terrainGroup = new THREE.Group();

    const dv = new DataView(terrainData.buffer, terrainData.byteOffset, terrainData.byteLength);
    const width = dv.getUint32(0, true);
    const height = dv.getUint32(4, true);
    const depth = dv.getUint32(8, true);

    console.log("Terrain dimensions: " + width + "x" + height + "x" + depth);

    // Collect voxels per material, only render surface voxels
    const voxelsByMat = {};

    function idx(x, y, z) {
        return z * width * height + y * width + x;
    }

    function isAir(x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) return true;
        return terrainData[12 + idx(x, y, z)] === 0;
    }

    for (let z = 0; z < depth; z++) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const mat = terrainData[12 + idx(x, y, z)];
                if (mat === 0) continue; // air

                // Only render if at least one face is exposed
                if (!isAir(x-1,y,z) && !isAir(x+1,y,z) &&
                    !isAir(x,y-1,z) && !isAir(x,y+1,z) &&
                    !isAir(x,y,z-1) && !isAir(x,y,z+1)) continue;

                if (!voxelsByMat[mat]) voxelsByMat[mat] = [];
                voxelsByMat[mat].push(x, y, z);
            }
        }
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    for (const [mat, positions] of Object.entries(voxelsByMat)) {
        const count = positions.length / 3;
        if (count === 0) continue;

        const color = VOXEL_COLORS[mat] || 0xff00ff;
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.9,
            metalness: 0.0,
        });

        const mesh = new THREE.InstancedMesh(boxGeo, material, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const matrix = new THREE.Matrix4();
        for (let i = 0; i < count; i++) {
            matrix.setPosition(positions[i*3], positions[i*3+1], positions[i*3+2]);
            mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        terrainGroup.add(mesh);
    }

    scene.add(terrainGroup);

    // Move camera to look at terrain center
    const cx = width / 2;
    const cy = height / 2;
    const cz = depth / 2;
    camera.position.set(cx + 30, cy + 40, cz + 30);
    controls.target.set(cx, cy * 0.3, cz);
    controls.update();

    console.log("Terrain rendered: " + Object.entries(voxelsByMat).map(
        ([m, p]) => m + ":" + (p.length/3)
    ).join(", "));
}

// --- Entity rendering ---

const ENTITY_DEFS = {
    player:     { color: 0x4488ff, geo: "capsule", scale: [0.8, 1.4, 0.8] },
    tree:       { color: 0x1a6a1a, geo: "tree",    scale: [2, 6, 2] },
    eucalyptus: { color: 0x5a7a5a, geo: "eucalyptus", scale: [2, 8, 2] },
    shrub:      { color: 0x3a8a2a, geo: "cone",    scale: [1.2, 2.5, 1.2] },
    herb:       { color: 0x5a9a3a, geo: "cone",    scale: [0.4, 0.8, 0.4] },
    animal:     { color: 0xcc8844, geo: "sphere",  scale: [0.6, 0.6, 0.6] },
    npc:        { color: 0x8844cc, geo: "capsule", scale: [0.8, 1.4, 0.8] },
    unknown:    { color: 0xffffff, geo: "sphere",  scale: [0.5, 0.5, 0.5] },
};

const geoCache = {};

function getGeometry(type) {
    if (geoCache[type]) return geoCache[type];
    switch (type) {
        case "capsule":
            geoCache[type] = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
            break;
        case "cone":
            geoCache[type] = new THREE.ConeGeometry(0.5, 1, 8);
            break;
        case "sphere":
            geoCache[type] = new THREE.SphereGeometry(0.5, 8, 6);
            break;
        case "tree":
            // Trunk + canopy group merged into a single buffer geometry
            geoCache[type] = new THREE.ConeGeometry(1, 4, 8);
            break;
        default:
            geoCache[type] = new THREE.BoxGeometry(1, 1, 1);
    }
    return geoCache[type];
}

function createEntityMesh(category) {
    const def = ENTITY_DEFS[category] || ENTITY_DEFS.unknown;

    if (category === "eucalyptus") {
        const group = new THREE.Group();
        const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 6, 6);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 3.0;
        trunk.castShadow = true;
        group.add(trunk);
        const canopyGeo = new THREE.SphereGeometry(1.5, 8, 6);
        canopyGeo.scale(1.0, 1.4, 1.0);
        const canopyMat = new THREE.MeshStandardMaterial({ color: 0x5a7a5a });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = 7.0;
        canopy.castShadow = true;
        group.add(canopy);
        return group;
    }

    if (category === "tree") {
        const group = new THREE.Group();
        const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3, 6);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1a });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.5;
        trunk.castShadow = true;
        group.add(trunk);
        const canopyGeo = new THREE.SphereGeometry(2, 8, 6);
        const canopyMat = new THREE.MeshStandardMaterial({ color: def.color });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = 4.5;
        canopy.castShadow = true;
        group.add(canopy);
        return group;
    }

    const geo = getGeometry(def.geo);
    const mat = new THREE.MeshStandardMaterial({ color: def.color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(...def.scale);
    mesh.castShadow = true;
    return mesh;
}

function createOrUpdateEntity(eid, x, y, z, rot, category) {
    let obj = entityMeshes.get(eid);

    if (!obj) {
        obj = createEntityMesh(category);
        obj.userData.entityId = eid;
        obj.userData.category = category;
        scene.add(obj);
        entityMeshes.set(eid, obj);
    }

    obj.position.set(x, y, z);
    if (obj.rotation) obj.rotation.y = rot;

    // Track own player for camera
    if (eid === myEntityId) {
        controls.target.set(x, y + 2, z);
    }
}

// --- Click interaction ---

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onWorldClick(event) {
    if (!selectedAction || !connected) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check entity hits
    const objects = [];
    entityMeshes.forEach(obj => {
        if (obj.isGroup) {
            obj.children.forEach(c => objects.push(c));
        } else {
            objects.push(obj);
        }
    });

    const hits = raycaster.intersectObjects(objects, true);

    if (hits.length > 0) {
        let hitObj = hits[0].object;
        while (hitObj.parent && !hitObj.userData.entityId && hitObj.parent !== scene) {
            hitObj = hitObj.parent;
        }

        const eid = hitObj.userData.entityId;
        if (eid && selectedAction === "harvest") {
            ws.send(buildActionMessage(encodeHarvestAction(eid)));
            return;
        }
        if (eid && selectedAction === "cut-tree") {
            ws.send(buildActionMessage(encodeCutTreeAction(eid)));
            return;
        }
    }

    // Hit terrain — plant/build at that position
    if (terrainGroup) {
        const terrainHits = raycaster.intersectObject(terrainGroup, true);
        if (terrainHits.length > 0) {
            const point = terrainHits[0].point;
            const ix = Math.round(point.x);
            const iy = Math.round(point.y);
            const iz = Math.round(point.z);

            if (selectedAction.startsWith("plant-")) {
                const speciesMap = {
                    "plant-chestnut": 100,
                    "plant-fig": 200,
                    "plant-rosemary": 300,
                    "plant-comfrey": 400,
                    "plant-clover": 500,
                };
                const sid = speciesMap[selectedAction] || 100;
                const actionPayload = encodePlantAction(sid);
                ws.send(buildActionMessage(actionPayload));
            } else if (selectedAction === "water") {
                const actionPayload = encodeWaterAction(ix, iy, iz);
                ws.send(buildActionMessage(actionPayload));
            } else if (selectedAction === "build-swale") {
                const actionPayload = encodeSwaleAction(ix, iy, iz);
                ws.send(buildActionMessage(actionPayload));
            } else if (selectedAction === "build-hugel") {
                const actionPayload = encodeHugelAction(ix, iy, iz);
                ws.send(buildActionMessage(actionPayload));
            }
        }
    }
}

// ActionKind bincode encoders (enum variant index as varint, then fields)
function encodePlantAction(speciesId) {
    return [...encodeVarint(0), ...encodeVarint(speciesId)]; // PlantSeed { species_id }
}

function encodeHarvestAction(entityId) {
    // Harvest { entity_id: EntityId(u64) }
    return [...encodeVarint(1), ...encodeVarint(entityId)];
}

function encodeWaterAction(x, y, z) {
    return [
        ...encodeVarint(3),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
        3, // radius
    ];
}

function encodeSwaleAction(x, y, z) {
    return [
        ...encodeVarint(4),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
        0, // direction
    ];
}

function encodeHugelAction(x, y, z) {
    return [
        ...encodeVarint(5),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
}

function encodeCutTreeAction(entityId) {
    return [...encodeVarint(10), ...encodeVarint(entityId)];
}

// --- Input ---

document.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "Enter") {
        const chatInput = document.getElementById("chat-input");
        if (document.activeElement === chatInput) {
            if (chatInput.value.trim()) {
                if (connected) ws.send(buildChatMessage(chatInput.value.trim()));
                chatInput.value = "";
            }
            chatInput.blur();
        } else {
            chatInput.focus();
        }
        e.preventDefault();
    }
});

document.addEventListener("keyup", (e) => keys.delete(e.code));

let wasMoving = false;

function sendInput() {
    if (!connected) return;

    const chatInput = document.getElementById("chat-input");
    if (document.activeElement === chatInput) return;

    let mx = 0, mz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) mz = -1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) mz = 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx = -1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx = 1;

    const jump = keys.has("Space");
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");

    const isMoving = mx !== 0 || mz !== 0 || jump;
    if (!isMoving && !wasMoving) return;
    wasMoving = isMoving;

    const len = Math.sqrt(mx*mx + mz*mz);
    if (len > 0) { mx /= len; mz /= len; }

    const yaw = Math.atan2(mx, -mz);
    const msg = buildInputMessage(mx, mz, yaw, jump, sprint);
    ws.send(msg);
}

// --- Flame effect ---

const flameEntities = new Map();

function addFlameEffect(eid) {
    if (flameEntities.has(eid)) return;
    const obj = entityMeshes.get(eid);
    if (!obj) return;

    const flameGroup = new THREE.Group();

    const flameCount = 6;
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8 });
    const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 });
    const flameGeo = new THREE.ConeGeometry(0.3, 1.2, 5);
    const flameGeo2 = new THREE.ConeGeometry(0.2, 0.8, 5);

    const flames = [];
    for (let i = 0; i < flameCount; i++) {
        const angle = (i / flameCount) * Math.PI * 2;
        const r = 0.4 + Math.random() * 0.3;
        const flame = new THREE.Mesh(flameGeo, flameMat.clone());
        flame.position.set(Math.cos(angle) * r, 1.0 + Math.random() * 2.0, Math.sin(angle) * r);
        flame.userData.baseY = flame.position.y;
        flame.userData.phase = Math.random() * Math.PI * 2;
        flame.userData.speed = 2 + Math.random() * 3;
        flameGroup.add(flame);
        flames.push(flame);

        const inner = new THREE.Mesh(flameGeo2, flameMat2.clone());
        inner.position.set(Math.cos(angle) * r * 0.5, flame.position.y + 0.5, Math.sin(angle) * r * 0.5);
        inner.userData.baseY = inner.position.y;
        inner.userData.phase = Math.random() * Math.PI * 2;
        inner.userData.speed = 3 + Math.random() * 3;
        flameGroup.add(inner);
        flames.push(inner);
    }

    const light = new THREE.PointLight(0xff6600, 3, 15);
    light.position.y = 3;
    flameGroup.add(light);
    flameGroup.userData.light = light;
    flameGroup.userData.flames = flames;

    obj.add(flameGroup);
    flameEntities.set(eid, flameGroup);
}

function removeFlameEffect(eid) {
    const flame = flameEntities.get(eid);
    if (!flame) return;
    if (flame.parent) flame.parent.remove(flame);
    flameEntities.delete(eid);
}

function updateFlames(time) {
    for (const [eid, flameGroup] of flameEntities) {
        if (!entityMeshes.has(eid)) {
            if (flameGroup.parent) flameGroup.parent.remove(flameGroup);
            flameEntities.delete(eid);
            continue;
        }
        const flames = flameGroup.userData.flames;
        for (const f of flames) {
            f.position.y = f.userData.baseY + Math.sin(time * f.userData.speed + f.userData.phase) * 0.4;
            const scale = 0.7 + Math.sin(time * f.userData.speed * 1.5 + f.userData.phase) * 0.3;
            f.scale.set(scale, 0.8 + Math.random() * 0.4, scale);
            f.material.opacity = 0.5 + Math.sin(time * f.userData.speed + f.userData.phase * 2) * 0.3;
        }
        const light = flameGroup.userData.light;
        if (light) {
            light.intensity = 2 + Math.sin(time * 5) * 1.5;
        }
    }
}

// --- Game loop ---

let lastTime = performance.now();
let inputTimer = 0;

function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    inputTimer += dt;
    if (inputTimer >= 0.05) {
        inputTimer = 0;
        sendInput();
    }

    updateFlames(now / 1000);

    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function updateStatus(text) {
    document.getElementById("status").textContent = text;
}
