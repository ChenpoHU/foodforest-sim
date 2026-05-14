import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let ws = null;
let connected = false;
let playerName = "Farmer";
let selectedAction = null;
let myEntityId = 0;
let selectedGameMode = 0;
let selectedRegion = 0;
let selectedPlotSeed = 42;

let scene, camera, renderer, controls;
let entityMeshes = new Map();
let entityKinds = new Map();
let terrainGroup = null;
let terrainMeta = null; // { width, height, depth, data }
let minimapBaseImage = null;
let waterMeshes = [];
let fishGroup = null;

const keys = new Set();
let inputSeq = 0;

// Connect screen
document.getElementById("connect-btn").addEventListener("click", () => {
    playerName = document.getElementById("player-name").value || "Farmer";
    const serverUrl = document.getElementById("server-url").value || "ws://localhost:9000";
    selectedPlotSeed = parseInt(document.getElementById("plot-seed-input").value) || 42;
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

// === World data ===
const WORLD_COUNTRIES = [
    { name: "Portugal", start: 0, count: 7, color: "#4a8a3a",
      cx: 90, cy: 155, regions: [
        "Minho", "Tras-os-Montes", "Beira", "Ribatejo", "Alentejo", "Algarve", "Lisboa"
    ]},
    { name: "France", start: 7, count: 4, color: "#3a6a8a",
      cx: 130, cy: 125, regions: [
        "Provence", "Dordogne", "Loire Valley", "Normandy"
    ]},
    { name: "Spain", start: 11, count: 4, color: "#8a6a3a",
      cx: 105, cy: 150, regions: [
        "Andalusia", "Catalonia", "Galicia", "Basque Country"
    ]},
    { name: "Italy", start: 15, count: 4, color: "#6a8a3a",
      cx: 165, cy: 140, regions: [
        "Tuscany", "Sicily", "Amalfi Coast", "Piedmont"
    ]},
    { name: "Iran", start: 19, count: 4, color: "#8a5a3a",
      cx: 290, cy: 145, regions: [
        "Isfahan", "Shiraz", "Gilan", "Alborz"
    ]},
    { name: "California", start: 23, count: 4, color: "#3a8a6a",
      cx: 625, cy: 140, regions: [
        "Central Valley", "Napa Valley", "Coastal Range", "Sierra Nevada"
    ]},
    { name: "South Africa", start: 27, count: 4, color: "#8a3a5a",
      cx: 215, cy: 260, regions: [
        "Cape Winelands", "Fynbos Coast", "Karoo", "Garden Route"
    ]},
    { name: "Yunnan", start: 31, count: 4, color: "#5a8a3a",
      cx: 430, cy: 155, regions: [
        "Kunming Plateau", "Xishuangbanna", "Dali", "Tiger Leaping Gorge"
    ]},
    { name: "Japan", start: 35, count: 4, color: "#3a5a8a",
      cx: 500, cy: 130, regions: [
        "Hokkaido", "Kanto", "Kansai", "Kyushu"
    ]},
];

let selectedCountryIdx = 0;

function drawWorldMap() {
    const canvas = document.getElementById("world-canvas");
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;

    // Ocean
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0a1a3a");
    grad.addColorStop(0.5, "#0a2a4a");
    grad.addColorStop(1, "#0a1a3a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Simplified continent outlines (filled)
    ctx.fillStyle = "#1a2a1a";
    // Europe
    ctx.beginPath();
    ctx.moveTo(80,80); ctx.lineTo(190,75); ctx.lineTo(200,90); ctx.lineTo(185,120);
    ctx.lineTo(175,115); ctx.lineTo(170,130); ctx.lineTo(180,145); ctx.lineTo(165,160);
    ctx.lineTo(155,150); ctx.lineTo(145,155); ctx.lineTo(140,148);
    ctx.lineTo(130,155); ctx.lineTo(120,150); ctx.lineTo(110,160);
    ctx.lineTo(100,165); ctx.lineTo(88,155); ctx.lineTo(85,165);
    ctx.lineTo(95,170); ctx.lineTo(90,175); ctx.lineTo(80,168);
    ctx.lineTo(75,155); ctx.lineTo(80,130); ctx.lineTo(75,110); ctx.lineTo(80,95);
    ctx.closePath(); ctx.fill();
    // Africa
    ctx.beginPath();
    ctx.moveTo(80,175); ctx.lineTo(110,172); ctx.lineTo(140,175); ctx.lineTo(170,170);
    ctx.lineTo(210,180); ctx.lineTo(240,175); ctx.lineTo(260,190);
    ctx.lineTo(255,220); ctx.lineTo(245,250); ctx.lineTo(230,270);
    ctx.lineTo(215,280); ctx.lineTo(205,275); ctx.lineTo(210,265);
    ctx.lineTo(220,260); ctx.lineTo(210,240);
    ctx.lineTo(195,230); ctx.lineTo(175,245); ctx.lineTo(155,240);
    ctx.lineTo(140,220); ctx.lineTo(120,210); ctx.lineTo(100,200);
    ctx.lineTo(85,185); ctx.closePath(); ctx.fill();
    // Middle East / Iran area
    ctx.beginPath();
    ctx.moveTo(240,120); ctx.lineTo(310,110); ctx.lineTo(330,130);
    ctx.lineTo(320,155); ctx.lineTo(300,165); ctx.lineTo(270,160);
    ctx.lineTo(250,170); ctx.lineTo(240,155); ctx.lineTo(235,140);
    ctx.closePath(); ctx.fill();
    // Asia / China / Japan area
    ctx.beginPath();
    ctx.moveTo(310,70); ctx.lineTo(380,50); ctx.lineTo(460,55); ctx.lineTo(510,80);
    ctx.lineTo(520,100); ctx.lineTo(510,130); ctx.lineTo(490,145);
    ctx.lineTo(460,155); ctx.lineTo(440,165); ctx.lineTo(420,170);
    ctx.lineTo(400,165); ctx.lineTo(380,155); ctx.lineTo(360,150);
    ctx.lineTo(340,140); ctx.lineTo(330,130); ctx.lineTo(320,110);
    ctx.lineTo(310,100); ctx.closePath(); ctx.fill();
    // Japan islands
    ctx.beginPath();
    ctx.moveTo(500,100); ctx.lineTo(515,95); ctx.lineTo(520,110);
    ctx.lineTo(510,130); ctx.lineTo(500,125); ctx.lineTo(505,110);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(495,130); ctx.lineTo(505,135); ctx.lineTo(500,145);
    ctx.lineTo(490,140); ctx.closePath(); ctx.fill();
    // North America (western edge for California)
    ctx.beginPath();
    ctx.moveTo(570,50); ctx.lineTo(690,40); ctx.lineTo(700,80);
    ctx.lineTo(680,100); ctx.lineTo(660,120); ctx.lineTo(640,140);
    ctx.lineTo(620,160); ctx.lineTo(610,170); ctx.lineTo(600,165);
    ctx.lineTo(610,150); ctx.lineTo(620,130); ctx.lineTo(630,110);
    ctx.lineTo(620,90); ctx.lineTo(600,70); ctx.lineTo(580,60);
    ctx.closePath(); ctx.fill();

    // Draw country markers
    for (let i = 0; i < WORLD_COUNTRIES.length; i++) {
        const c = WORLD_COUNTRIES[i];
        const isSelected = (i === selectedCountryIdx);
        ctx.fillStyle = isSelected ? "#fff" : c.color;
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, isSelected ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        if (isSelected) {
            ctx.strokeStyle = c.color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.fillStyle = isSelected ? "#fff" : "#aaa";
        ctx.font = isSelected ? "bold 11px system-ui" : "10px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(c.name, c.cx, c.cy - 10);
    }
}

function selectCountry(idx) {
    selectedCountryIdx = idx;
    const country = WORLD_COUNTRIES[idx];
    selectedRegion = country.start;

    // Update country buttons
    document.querySelectorAll(".country-btn").forEach((b, i) => {
        b.classList.toggle("active", i === idx);
    });

    // Rebuild region buttons
    const regionList = document.getElementById("region-list");
    regionList.innerHTML = "";
    for (let r = 0; r < country.count; r++) {
        const btn = document.createElement("button");
        btn.className = "region-btn" + (r === 0 ? " active" : "");
        btn.textContent = country.regions[r];
        btn.dataset.region = country.start + r;
        btn.addEventListener("click", () => {
            selectedRegion = country.start + r;
            document.querySelectorAll(".region-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
        regionList.appendChild(btn);
    }

    document.getElementById("plot-selector").style.display = "flex";
    drawWorldMap();
}

// Build country buttons
{
    const bar = document.getElementById("country-bar");
    WORLD_COUNTRIES.forEach((c, i) => {
        const btn = document.createElement("button");
        btn.className = "country-btn" + (i === 0 ? " active" : "");
        btn.textContent = c.name;
        btn.addEventListener("click", () => selectCountry(i));
        bar.appendChild(btn);
    });
}

// World canvas click
document.getElementById("world-canvas").addEventListener("click", (e) => {
    const canvas = document.getElementById("world-canvas");
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    let bestDist = 40;
    let bestIdx = -1;
    for (let i = 0; i < WORLD_COUNTRIES.length; i++) {
        const c = WORLD_COUNTRIES[i];
        const dist = Math.sqrt((mx - c.cx) ** 2 + (my - c.cy) ** 2);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0) selectCountry(bestIdx);
});

document.getElementById("plot-seed-input").addEventListener("change", (e) => {
    selectedPlotSeed = parseInt(e.target.value) || 42;
});

// Initialize
selectCountry(0);
drawWorldMap();

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
    scene.fog = new THREE.Fog(0x87CEEB, 300, 1000);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(160, 80, 160);
    camera.lookAt(160, 0, 160);

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
    controls.maxDistance = 500;

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.5);
    sun.position.set(200, 300, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 4096;
    sun.shadow.mapSize.height = 4096;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 800;
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
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

function buildHelloMessage(name, gameMode, regionIndex, plotSeed) {
    const payload = new Uint8Array([
        ...encodeBincodeString(name),
        ...encodeBincodeString("dev-token"),
        ...encodeVarint(1),
        gameMode,
        regionIndex,
        ...encodeVarint(plotSeed),
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
        ws.send(buildHelloMessage(playerName, selectedGameMode, selectedRegion, selectedPlotSeed));
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

    const hud = document.getElementById("player-hud");
    hud.style.display = "block";
    document.getElementById("hud-name").textContent = playerName;
    document.getElementById("hud-stamina").textContent = "Stamina: 100%";
    document.getElementById("hud-hunger").textContent = "Hunger: 0%";
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
        let growthStage = 0;
        const stateTag = r.readVarint();
        if (stateTag === 0) {
            // Active
        } else if (stateTag === 1) {
            growthStage = r.readU8();
            r.readF32();
        } else if (stateTag === 2) {
            r.readU8();
            r.readF32();
        } else if (stateTag === 3) {
            const hasItem = r.readU8();
            if (hasItem === 1) r.readU16();
            r.readU8();
        }

        entityKinds.set(eid, { kind, speciesId, growthStage });

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

    let regionLabel = "Food Forest";
    for (const c of WORLD_COUNTRIES) {
        if (selectedRegion >= c.start && selectedRegion < c.start + c.count) {
            const rIdx = selectedRegion - c.start;
            regionLabel = c.name + " / " + c.regions[rIdx];
            break;
        }
    }
    updateStatus(regionLabel + " — Day " + calDay + " | " +
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

    if (success && message.startsWith("INSPECT|")) {
        showInspectPanel(message);
        return;
    }

    const chatLog = document.getElementById("chat-log");
    const line = document.createElement("div");
    line.style.color = success ? "#8f8" : "#f88";
    line.textContent = (success ? "[OK] " : "[FAIL] ") + message;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function showInspectPanel(data) {
    const parts = data.split("|");
    const panel = document.getElementById("inspect-panel");
    const content = document.getElementById("inspect-content");
    const type = parts[1];
    let html = "";

    if (type === "plant") {
        const name = parts[2], stage = parts[3], health = parts[4], growth = parts[5], cuts = parts[6];
        html = "<div style='color:#6d6; font-size:14px; margin-bottom:6px;'>" + name + "</div>";
        html += "<div>Stage: <span style='color:#cfc'>" + stage + "</span></div>";
        html += "<div>Health: <span style='color:#cfc'>" + health + "</span></div>";
        html += "<div>Growth: <span style='color:#cfc'>" + growth + "</span></div>";
        if (parseInt(cuts) > 0) html += "<div>Cut count: <span style='color:#fa8'>" + cuts + "/3</span></div>";
    } else if (type === "animal") {
        const name = parts[2], behavior = parts[3], hunger = parts[4], energy = parts[5];
        html = "<div style='color:#da6; font-size:14px; margin-bottom:6px;'>" + name + "</div>";
        html += "<div>Behavior: <span style='color:#cfc'>" + behavior + "</span></div>";
        html += "<div>" + hunger + "</div>";
        html += "<div>" + energy + "</div>";
    } else if (type === "player") {
        const name = parts[2], stamina = parts[3], hunger = parts[4];
        html = "<div style='color:#48f; font-size:14px; margin-bottom:6px;'>" + name + "</div>";
        html += "<div>" + stamina + "</div>";
        html += "<div>" + hunger + "</div>";
    }

    content.innerHTML = html;
    panel.style.display = "block";
}

// --- Entity classification ---

function classifyEntity(kind, speciesId) {
    if (kind === "player") return "player";
    if (kind === "animal") {
        if (speciesId === 10) return "chicken";
        if (speciesId === 21) return "deer";
        return "animal";
    }
    if (kind === "npc") return "npc";
    if (kind === "plant") {
        const PLANT_MAP = {
            100: "chestnut", 101: "walnut", 102: "carob", 103: "eucalyptus",
            104: "hazelnut", 105: "almond", 106: "corkoak", 107: "redwood",
            108: "macadamia", 109: "stonepine", 110: "pistachio", 111: "bamboo",
            112: "cherry",
            200: "fig", 201: "pomegranate", 202: "citrus", 203: "olive",
            204: "plum", 205: "avocado", 206: "mulberry", 207: "banana",
            208: "mango", 209: "persimmon",
            300: "rosemary", 301: "lavender", 302: "thyme", 303: "sage",
            304: "rooibos", 305: "protea", 306: "tea",
            400: "comfrey", 401: "basil", 402: "saffron", 403: "shiso",
            500: "clover", 501: "strawberry",
            600: "grapevine",
        };
        if (PLANT_MAP[speciesId]) return PLANT_MAP[speciesId];
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
    11: 0xeeeeff, // Snow
    12: 0xbbddff, // Ice
    13: 0x0a3060, // Ocean
    14: 0x999988, // Gravel
    15: 0x8a3a1a, // RedSoil
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

    terrainMeta = { width, height, depth, data: terrainData };

    function idx(x, y, z) {
        return z * width * height + y * width + x;
    }

    function isAir(x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) return true;
        return terrainData[12 + idx(x, y, z)] === 0;
    }

    // Build heightmap and surface material map for minimap
    const heightMap = new Uint8Array(width * depth);
    const surfaceMap = new Uint8Array(width * depth);
    for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
            for (let y = height - 1; y >= 0; y--) {
                const mat = terrainData[12 + idx(x, y, z)];
                if (mat !== 0) {
                    heightMap[z * width + x] = y;
                    surfaceMap[z * width + x] = mat;
                    break;
                }
            }
        }
    }

    // Collect voxels per material, only render surface voxels
    const voxelsByMat = {};

    for (let z = 0; z < depth; z++) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const mat = terrainData[12 + idx(x, y, z)];
                if (mat === 0) continue;

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

        const baseColor = VOXEL_COLORS[mat] || 0xff00ff;
        const matInt = parseInt(mat);
        const useVariation = (matInt === 1 || matInt === 14);
        const material = new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: (matInt === 4 || matInt === 13) ? 0.2 : 0.9,
            metalness: 0.0,
        });

        if (matInt === 4 || matInt === 8 || matInt === 13) {
            material.transparent = true;
            material.opacity = 0.75;
        }

        const mesh = new THREE.InstancedMesh(boxGeo, material, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const matrix = new THREE.Matrix4();
        const color = new THREE.Color();
        for (let i = 0; i < count; i++) {
            matrix.setPosition(positions[i*3], positions[i*3+1], positions[i*3+2]);
            mesh.setMatrixAt(i, matrix);
            if (useVariation) {
                const hash = (positions[i*3] * 73 + positions[i*3+2] * 37 + positions[i*3+1] * 17) & 0xFF;
                const variation = 0.85 + (hash / 255) * 0.3;
                const r = ((baseColor >> 16) & 0xFF) / 255;
                const g = ((baseColor >> 8) & 0xFF) / 255;
                const b = (baseColor & 0xFF) / 255;
                const tint = (hash % 3);
                color.setRGB(
                    Math.min(1, r * variation * (tint === 0 ? 1.1 : 0.95)),
                    Math.min(1, g * variation * (tint === 1 ? 1.1 : 0.95)),
                    Math.min(1, b * variation * (tint === 2 ? 1.1 : 0.95))
                );
                mesh.setColorAt(i, color);
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (useVariation) mesh.instanceColor.needsUpdate = true;
        terrainGroup.add(mesh);
    }

    // Water surface planes for animated water
    waterMeshes = [];
    const waterPositions = [];
    for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
            const si = z * width + x;
            const mat = surfaceMap[si];
            if (mat === 4 || mat === 13) {
                waterPositions.push(x, heightMap[si], z, mat);
            }
        }
    }
    if (waterPositions.length > 0) {
        const waterGeo = new THREE.PlaneGeometry(1, 1);
        waterGeo.rotateX(-Math.PI / 2);
        const shallowMat = new THREE.MeshStandardMaterial({
            color: 0x3388bb, transparent: true, opacity: 0.6,
            roughness: 0.1, metalness: 0.3,
        });
        const deepMat = new THREE.MeshStandardMaterial({
            color: 0x0a3060, transparent: true, opacity: 0.7,
            roughness: 0.1, metalness: 0.3,
        });
        const shallowCount = waterPositions.filter((_, i) => i % 4 === 3 && waterPositions[i] === 4).length / 1;
        let sc = 0, dc = 0;
        for (let i = 3; i < waterPositions.length; i += 4) {
            if (waterPositions[i] === 4) sc++; else dc++;
        }
        if (sc > 0) {
            const mesh = new THREE.InstancedMesh(waterGeo, shallowMat, sc);
            mesh.receiveShadow = true;
            const m = new THREE.Matrix4();
            let idx = 0;
            for (let i = 0; i < waterPositions.length; i += 4) {
                if (waterPositions[i + 3] !== 4) continue;
                m.setPosition(waterPositions[i], waterPositions[i+1] + 0.55, waterPositions[i+2]);
                mesh.setMatrixAt(idx++, m);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.userData.isWater = true;
            terrainGroup.add(mesh);
            waterMeshes.push(mesh);
        }
        if (dc > 0) {
            const mesh = new THREE.InstancedMesh(waterGeo, deepMat, dc);
            mesh.receiveShadow = true;
            const m = new THREE.Matrix4();
            let idx = 0;
            for (let i = 0; i < waterPositions.length; i += 4) {
                if (waterPositions[i + 3] !== 13) continue;
                m.setPosition(waterPositions[i], waterPositions[i+1] + 0.55, waterPositions[i+2]);
                mesh.setMatrixAt(idx++, m);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.userData.isWater = true;
            terrainGroup.add(mesh);
            waterMeshes.push(mesh);
        }
    }

    // Spawn fish in water areas
    if (fishGroup) scene.remove(fishGroup);
    fishGroup = new THREE.Group();
    const fishMat = new THREE.MeshStandardMaterial({ color: 0xcc8844 });
    const fishMat2 = new THREE.MeshStandardMaterial({ color: 0x88aacc });
    const fishBody = new THREE.ConeGeometry(0.08, 0.4, 4);
    let fishCount = 0;
    for (let i = 0; i < waterPositions.length && fishCount < 200; i += 4) {
        if (waterPositions[i + 3] !== 4) continue;
        if (((waterPositions[i] * 7 + waterPositions[i+2] * 13) & 0x1F) !== 0) continue;
        const fx = waterPositions[i] + (Math.random() - 0.5) * 0.8;
        const fy = waterPositions[i+1] + 0.2;
        const fz = waterPositions[i+2] + (Math.random() - 0.5) * 0.8;
        const fish = new THREE.Mesh(fishBody, fishCount % 2 === 0 ? fishMat : fishMat2);
        fish.position.set(fx, fy, fz);
        fish.rotation.z = Math.PI / 2;
        fish.userData.baseX = fx;
        fish.userData.baseZ = fz;
        fish.userData.phase = Math.random() * Math.PI * 2;
        fish.userData.speed = 0.3 + Math.random() * 0.5;
        fish.userData.radius = 0.5 + Math.random() * 1.5;
        fishGroup.add(fish);
        fishCount++;
    }
    scene.add(fishGroup);

    scene.add(terrainGroup);

    const cx = width / 2;
    const cz = depth / 2;
    camera.position.set(cx + 60, 80, cz + 60);
    controls.target.set(cx, 10, cz);
    controls.update();

    console.log("Terrain rendered: " + Object.entries(voxelsByMat).map(
        ([m, p]) => m + ":" + (p.length/3)
    ).join(", "));

    renderMinimap(width, depth, heightMap, surfaceMap);
}

const MINIMAP_COLORS = {
    1: [136,136,136], // Stone
    2: [107,68,35],   // Soil
    3: [58,122,42],   // Grass
    4: [34,102,170],  // Water
    5: [212,184,150], // Sand
    6: [170,119,68],  // Clay
    7: [85,68,34],    // Mulch
    8: [34,102,136],  // Swale
    9: [102,68,34],   // HugelBed
    10: [26,90,26],   // Canopy
    11: [230,230,245],// Snow
    12: [180,210,240],// Ice
    13: [10,48,96],   // Ocean
    14: [150,150,130],// Gravel
    15: [138,58,26],  // RedSoil
};

const PLOT_SIZE = 80;

function renderMinimap(tw, td, heightMap, surfaceMap) {
    const canvas = document.getElementById("minimap");
    const size = 200;
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    const ctx = canvas.getContext("2d");

    const img = ctx.createImageData(size, size);
    const scaleX = tw / size;
    const scaleZ = td / size;

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const tx = Math.floor(px * scaleX);
            const tz = Math.floor(py * scaleZ);
            const idx = tz * tw + tx;
            const h = heightMap[idx];
            const mat = surfaceMap[idx];
            const base = MINIMAP_COLORS[mat] || [100, 100, 100];
            const shade = 0.6 + (h / 32) * 0.4;
            const oi = (py * size + px) * 4;
            img.data[oi]     = Math.min(255, base[0] * shade);
            img.data[oi + 1] = Math.min(255, base[1] * shade);
            img.data[oi + 2] = Math.min(255, base[2] * shade);
            img.data[oi + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);

    // Draw plot grid lines
    ctx.strokeStyle = "rgba(100,200,100,0.3)";
    ctx.lineWidth = 1;
    const plotPx = PLOT_SIZE / scaleX;
    const plotPz = PLOT_SIZE / scaleZ;
    for (let gx = plotPx; gx < size; gx += plotPx) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, size);
        ctx.stroke();
    }
    for (let gz = plotPz; gz < size; gz += plotPz) {
        ctx.beginPath();
        ctx.moveTo(0, gz);
        ctx.lineTo(size, gz);
        ctx.stroke();
    }

    minimapBaseImage = ctx.getImageData(0, 0, size, size);
}

function updateMinimapPlayer() {
    if (!terrainMeta || !minimapBaseImage) return;
    const canvas = document.getElementById("minimap");
    const size = canvas.width;
    const ctx = canvas.getContext("2d");

    ctx.putImageData(minimapBaseImage, 0, 0);

    // Redraw plot grid
    const scaleX = terrainMeta.width / size;
    const scaleZ = terrainMeta.depth / size;
    ctx.strokeStyle = "rgba(100,200,100,0.3)";
    ctx.lineWidth = 1;
    const plotPx = PLOT_SIZE / scaleX;
    const plotPz = PLOT_SIZE / scaleZ;
    for (let gx = plotPx; gx < size; gx += plotPx) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, size);
        ctx.stroke();
    }
    for (let gz = plotPz; gz < size; gz += plotPz) {
        ctx.beginPath();
        ctx.moveTo(0, gz);
        ctx.lineTo(size, gz);
        ctx.stroke();
    }

    // Draw all entity dots (plants small green, animals orange, players red)
    for (const [eid, obj] of entityMeshes) {
        const px = (obj.position.x / terrainMeta.width) * size;
        const pz = (obj.position.z / terrainMeta.depth) * size;
        const info = entityKinds.get(eid);
        if (!info) continue;
        if (info.kind === "plant") {
            ctx.fillStyle = "rgba(80,200,80,0.4)";
            ctx.fillRect(px - 0.5, pz - 0.5, 1, 1);
        } else if (info.kind === "animal") {
            ctx.fillStyle = "#da6";
            ctx.fillRect(px - 1, pz - 1, 2, 2);
        }
    }

    // Draw other players
    for (const [eid, obj] of entityMeshes) {
        if (eid === myEntityId) continue;
        const info = entityKinds.get(eid);
        if (!info || info.kind !== "player") continue;
        const px = (obj.position.x / terrainMeta.width) * size;
        const pz = (obj.position.z / terrainMeta.depth) * size;
        ctx.fillStyle = "#48f";
        ctx.beginPath();
        ctx.arc(px, pz, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw own player
    const obj = entityMeshes.get(myEntityId);
    if (obj) {
        const px = (obj.position.x / terrainMeta.width) * size;
        const pz = (obj.position.z / terrainMeta.depth) * size;
        ctx.fillStyle = "#ff4444";
        ctx.beginPath();
        ctx.arc(px, pz, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Draw camera view frustum indicator
    const camPx = (controls.target.x / terrainMeta.width) * size;
    const camPz = (controls.target.z / terrainMeta.depth) * size;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(camPx - 15, camPz - 15, 30, 30);

    // Region label
    let label = "Plot " + selectedPlotSeed;
    for (const c of WORLD_COUNTRIES) {
        if (selectedRegion >= c.start && selectedRegion < c.start + c.count) {
            const rIdx = selectedRegion - c.start;
            label = c.name + " / " + c.regions[rIdx];
            break;
        }
    }
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, size - 16, size, 16);
    ctx.fillStyle = "#8f8";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, size / 2, size - 4);
}

// Minimap click to navigate
document.getElementById("minimap").addEventListener("click", (e) => {
    if (!terrainMeta || !connected) return;
    const canvas = document.getElementById("minimap");
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const mz = (e.clientY - rect.top) / rect.height;
    const worldX = mx * terrainMeta.width;
    const worldZ = mz * terrainMeta.depth;

    controls.target.set(worldX, 10, worldZ);
    camera.position.set(worldX + 40, 60, worldZ + 40);
    controls.update();
});
document.getElementById("minimap").style.cursor = "pointer";
document.getElementById("minimap").style.pointerEvents = "all";

// --- World navigation overlay ---

let navSelectedCountry = 0;
let navSelectedRegion = 0;

function openWorldNav() {
    navSelectedCountry = selectedCountryIdx;
    navSelectedRegion = selectedRegion;
    document.getElementById("world-nav-overlay").style.display = "flex";
    buildNavUI();
    drawNavMap();
}

function closeWorldNav() {
    document.getElementById("world-nav-overlay").style.display = "none";
}

function buildNavUI() {
    const bar = document.getElementById("nav-country-bar");
    bar.innerHTML = "";
    WORLD_COUNTRIES.forEach((c, i) => {
        const btn = document.createElement("button");
        btn.className = "country-btn" + (i === navSelectedCountry ? " active" : "");
        btn.textContent = c.name;
        btn.addEventListener("click", () => {
            navSelectedCountry = i;
            navSelectedRegion = c.start;
            buildNavUI();
            drawNavMap();
        });
        bar.appendChild(btn);
    });

    const regionList = document.getElementById("nav-region-list");
    regionList.innerHTML = "";
    const country = WORLD_COUNTRIES[navSelectedCountry];
    for (let r = 0; r < country.count; r++) {
        const btn = document.createElement("button");
        const rIdx = country.start + r;
        btn.className = "region-btn" + (rIdx === navSelectedRegion ? " active" : "");
        btn.textContent = country.regions[r];
        btn.addEventListener("click", () => {
            navSelectedRegion = rIdx;
            buildNavUI();
        });
        regionList.appendChild(btn);
    }
}

function drawNavMap() {
    const canvas = document.getElementById("nav-world-canvas");
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0a1a3a");
    grad.addColorStop(0.5, "#0a2a4a");
    grad.addColorStop(1, "#0a1a3a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#1a2a1a";
    ctx.beginPath();
    ctx.moveTo(80,80); ctx.lineTo(190,75); ctx.lineTo(200,90); ctx.lineTo(185,120);
    ctx.lineTo(175,115); ctx.lineTo(170,130); ctx.lineTo(180,145); ctx.lineTo(165,160);
    ctx.lineTo(155,150); ctx.lineTo(145,155); ctx.lineTo(140,148);
    ctx.lineTo(130,155); ctx.lineTo(120,150); ctx.lineTo(110,160);
    ctx.lineTo(100,165); ctx.lineTo(88,155); ctx.lineTo(85,165);
    ctx.lineTo(95,170); ctx.lineTo(90,175); ctx.lineTo(80,168);
    ctx.lineTo(75,155); ctx.lineTo(80,130); ctx.lineTo(75,110); ctx.lineTo(80,95);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(80,175); ctx.lineTo(110,172); ctx.lineTo(140,175); ctx.lineTo(170,170);
    ctx.lineTo(210,180); ctx.lineTo(240,175); ctx.lineTo(260,190);
    ctx.lineTo(255,220); ctx.lineTo(245,250); ctx.lineTo(230,270);
    ctx.lineTo(215,280); ctx.lineTo(205,275); ctx.lineTo(210,265);
    ctx.lineTo(220,260); ctx.lineTo(210,240);
    ctx.lineTo(195,230); ctx.lineTo(175,245); ctx.lineTo(155,240);
    ctx.lineTo(140,220); ctx.lineTo(120,210); ctx.lineTo(100,200);
    ctx.lineTo(85,185); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(240,120); ctx.lineTo(310,110); ctx.lineTo(330,130);
    ctx.lineTo(320,155); ctx.lineTo(300,165); ctx.lineTo(270,160);
    ctx.lineTo(250,170); ctx.lineTo(240,155); ctx.lineTo(235,140);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(310,70); ctx.lineTo(380,50); ctx.lineTo(460,55); ctx.lineTo(510,80);
    ctx.lineTo(520,100); ctx.lineTo(510,130); ctx.lineTo(490,145);
    ctx.lineTo(460,155); ctx.lineTo(440,165); ctx.lineTo(420,170);
    ctx.lineTo(400,165); ctx.lineTo(380,155); ctx.lineTo(360,150);
    ctx.lineTo(340,140); ctx.lineTo(330,130); ctx.lineTo(320,110);
    ctx.lineTo(310,100); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(500,100); ctx.lineTo(515,95); ctx.lineTo(520,110);
    ctx.lineTo(510,130); ctx.lineTo(500,125); ctx.lineTo(505,110);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(495,130); ctx.lineTo(505,135); ctx.lineTo(500,145);
    ctx.lineTo(490,140); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(570,50); ctx.lineTo(690,40); ctx.lineTo(700,80);
    ctx.lineTo(680,100); ctx.lineTo(660,120); ctx.lineTo(640,140);
    ctx.lineTo(620,160); ctx.lineTo(610,170); ctx.lineTo(600,165);
    ctx.lineTo(610,150); ctx.lineTo(620,130); ctx.lineTo(630,110);
    ctx.lineTo(620,90); ctx.lineTo(600,70); ctx.lineTo(580,60);
    ctx.closePath(); ctx.fill();

    for (let i = 0; i < WORLD_COUNTRIES.length; i++) {
        const c = WORLD_COUNTRIES[i];
        const isSel = (i === navSelectedCountry);
        ctx.fillStyle = isSel ? "#fff" : c.color;
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, isSel ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        if (isSel) {
            ctx.strokeStyle = c.color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.fillStyle = isSel ? "#fff" : "#aaa";
        ctx.font = isSel ? "bold 11px system-ui" : "10px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(c.name, c.cx, c.cy - 10);
    }
}

document.getElementById("nav-world-canvas").addEventListener("click", (e) => {
    const canvas = document.getElementById("nav-world-canvas");
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    let bestDist = 40, bestIdx = -1;
    for (let i = 0; i < WORLD_COUNTRIES.length; i++) {
        const c = WORLD_COUNTRIES[i];
        const dist = Math.sqrt((mx - c.cx) ** 2 + (my - c.cy) ** 2);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0) {
        navSelectedCountry = bestIdx;
        navSelectedRegion = WORLD_COUNTRIES[bestIdx].start;
        buildNavUI();
        drawNavMap();
    }
});

document.getElementById("world-nav-btn").addEventListener("click", openWorldNav);
document.getElementById("nav-cancel-btn").addEventListener("click", closeWorldNav);
document.getElementById("nav-travel-btn").addEventListener("click", () => {
    closeWorldNav();
    travelToRegion(navSelectedRegion, selectedPlotSeed);
});

function travelToRegion(regionIndex, plotSeed) {
    if (!connected) return;
    selectedRegion = regionIndex;
    for (let i = 0; i < WORLD_COUNTRIES.length; i++) {
        const c = WORLD_COUNTRIES[i];
        if (regionIndex >= c.start && regionIndex < c.start + c.count) {
            selectedCountryIdx = i;
            break;
        }
    }

    // Clear current world state
    for (const [eid, obj] of entityMeshes) {
        scene.remove(obj);
    }
    entityMeshes.clear();
    entityKinds.clear();
    if (fishGroup) { scene.remove(fishGroup); fishGroup = null; }
    waterMeshes = [];

    // Reconnect with new region
    ws.close();
    const serverUrl = document.getElementById("server-url").value || "ws://localhost:9000";
    ws = new WebSocket(serverUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
        connected = true;
        ws.send(buildHelloMessage(playerName, selectedGameMode, regionIndex, plotSeed));
    };
    ws.onmessage = (event) => {
        handleServerMessage(new Uint8Array(event.data));
    };
    ws.onclose = () => {
        updateStatus("Disconnected. Refresh to reconnect.");
        connected = false;
    };
    ws.onerror = () => {
        updateStatus("Connection failed.");
    };
    updateStatus("Traveling...");
}

// --- Entity rendering ---

function makeTree(trunkColor, trunkW, trunkH, canopyColor, canopyR, canopyH, canopyY) {
    const group = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(trunkW * 0.6, trunkW, trunkH, 6);
    const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ color: trunkColor }));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);
    const canopyGeo = new THREE.SphereGeometry(canopyR, 8, 6);
    if (canopyH !== canopyR) canopyGeo.scale(1, canopyH / canopyR, 1);
    const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ color: canopyColor }));
    canopy.position.y = canopyY;
    canopy.castShadow = true;
    group.add(canopy);
    return group;
}

function createEntityMesh(category) {
    switch (category) {
        case "player": {
            const group = new THREE.Group();
            const skinMat = new THREE.MeshStandardMaterial({ color: 0xddbb88 });
            const shirtMat = new THREE.MeshStandardMaterial({ color: 0x4488ff });
            const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334455 });
            const shoeMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
            // Torso
            const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.28), shirtMat);
            torso.position.y = 1.1; torso.castShadow = true; group.add(torso);
            // Head
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skinMat);
            head.position.y = 1.65; head.castShadow = true; group.add(head);
            // Eyes
            const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const eyeGeo = new THREE.SphereGeometry(0.035, 4, 4);
            const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
            leftEye.position.set(-0.08, 1.68, 0.18); group.add(leftEye);
            const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
            rightEye.position.set(0.08, 1.68, 0.18); group.add(rightEye);
            // Mouth
            const mouth = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.02, 0.02),
                new THREE.MeshStandardMaterial({ color: 0xaa6655 })
            );
            mouth.position.set(0, 1.58, 0.2); group.add(mouth);
            // Left arm
            const armGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
            const leftArm = new THREE.Mesh(armGeo, skinMat);
            leftArm.position.set(-0.37, 1.0, 0); leftArm.castShadow = true; group.add(leftArm);
            // Right arm
            const rightArm = new THREE.Mesh(armGeo, skinMat);
            rightArm.position.set(0.37, 1.0, 0); rightArm.castShadow = true; group.add(rightArm);
            // Left leg
            const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
            const leftLeg = new THREE.Mesh(legGeo, pantsMat);
            leftLeg.position.set(-0.12, 0.5, 0); leftLeg.castShadow = true; group.add(leftLeg);
            // Right leg
            const rightLeg = new THREE.Mesh(legGeo, pantsMat);
            rightLeg.position.set(0.12, 0.5, 0); rightLeg.castShadow = true; group.add(rightLeg);
            // Shoes
            const shoeGeo = new THREE.BoxGeometry(0.18, 0.08, 0.24);
            const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
            leftShoe.position.set(-0.12, 0.2, 0.04); group.add(leftShoe);
            const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
            rightShoe.position.set(0.12, 0.2, 0.04); group.add(rightShoe);
            return group;
        }
        case "eucalyptus":
            return makeTree(0x8a7a6a, 0.2, 6, 0x5a7a5a, 1.5, 2.1, 7.0);
        case "chestnut":
            return makeTree(0x5c3a1a, 0.3, 4, 0x1a6a1a, 2.5, 2.5, 5.5);
        case "walnut":
            return makeTree(0x4a3018, 0.35, 5, 0x2a5a1a, 2.8, 2.8, 6.5);
        case "carob":
            return makeTree(0x3a2a1a, 0.25, 3, 0x2a4a1a, 2.0, 2.0, 4.5);
        case "fig": {
            const g = makeTree(0x6a5a3a, 0.15, 1.5, 0x3a7a2a, 1.8, 1.2, 2.8);
            const c2 = new THREE.Mesh(
                new THREE.SphereGeometry(1.3, 7, 5),
                new THREE.MeshStandardMaterial({ color: 0x4a8a3a })
            );
            c2.position.set(0.6, 2.4, 0.4);
            c2.castShadow = true;
            g.add(c2);
            return g;
        }
        case "pomegranate":
            return makeTree(0x5a3a2a, 0.12, 1.8, 0x3a6a1a, 1.2, 1.2, 3.0);
        case "citrus":
            return makeTree(0x5a4a2a, 0.15, 1.5, 0x2a7a1a, 1.5, 1.5, 3.0);
        case "olive": {
            const g = makeTree(0x7a6a4a, 0.2, 2.5, 0x6a8a5a, 1.8, 1.2, 3.8);
            const c2 = new THREE.Mesh(
                new THREE.SphereGeometry(1.4, 7, 5),
                new THREE.MeshStandardMaterial({ color: 0x7a9a6a })
            );
            c2.position.set(-0.5, 3.5, 0.3);
            c2.castShadow = true;
            g.add(c2);
            return g;
        }
        case "rosemary": {
            const group = new THREE.Group();
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const spike = new THREE.Mesh(
                    new THREE.ConeGeometry(0.15, 1.0, 4),
                    new THREE.MeshStandardMaterial({ color: 0x3a6a3a })
                );
                spike.position.set(Math.cos(angle) * 0.3, 0.5, Math.sin(angle) * 0.3);
                spike.castShadow = true;
                group.add(spike);
            }
            return group;
        }
        case "lavender": {
            const group = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const angle = (i / 7) * Math.PI * 2;
                const r = 0.2 + Math.random() * 0.15;
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.02, 0.02, 0.7, 3),
                    new THREE.MeshStandardMaterial({ color: 0x4a6a3a })
                );
                stem.position.set(Math.cos(angle) * r, 0.35, Math.sin(angle) * r);
                group.add(stem);
                const flower = new THREE.Mesh(
                    new THREE.ConeGeometry(0.08, 0.25, 4),
                    new THREE.MeshStandardMaterial({ color: 0x8855aa })
                );
                flower.position.set(Math.cos(angle) * r, 0.8, Math.sin(angle) * r);
                group.add(flower);
            }
            return group;
        }
        case "comfrey": {
            const group = new THREE.Group();
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const leaf = new THREE.Mesh(
                    new THREE.ConeGeometry(0.2, 0.6, 4),
                    new THREE.MeshStandardMaterial({ color: 0x3a7a2a })
                );
                leaf.position.set(Math.cos(angle) * 0.25, 0.3, Math.sin(angle) * 0.25);
                leaf.rotation.z = Math.cos(angle) * 0.3;
                leaf.rotation.x = Math.sin(angle) * 0.3;
                group.add(leaf);
            }
            return group;
        }
        case "clover": {
            const group = new THREE.Group();
            const mat = new THREE.MeshStandardMaterial({ color: 0x2a8a2a });
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), mat);
                leaf.position.set(Math.cos(angle) * 0.12, 0.1, Math.sin(angle) * 0.12);
                leaf.scale.y = 0.4;
                group.add(leaf);
            }
            return group;
        }
        case "strawberry": {
            const group = new THREE.Group();
            const leaves = new THREE.Mesh(
                new THREE.SphereGeometry(0.2, 6, 4),
                new THREE.MeshStandardMaterial({ color: 0x3a8a2a })
            );
            leaves.position.y = 0.15;
            leaves.scale.y = 0.5;
            group.add(leaves);
            return group;
        }
        case "grapevine": {
            const group = new THREE.Group();
            const vine = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.08, 2.0, 4),
                new THREE.MeshStandardMaterial({ color: 0x5a4a2a })
            );
            vine.position.y = 1.0;
            group.add(vine);
            const foliage = new THREE.Mesh(
                new THREE.SphereGeometry(0.8, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0x4a7a2a })
            );
            foliage.position.y = 2.0;
            foliage.scale.y = 0.6;
            group.add(foliage);
            return group;
        }
        case "chicken": {
            const group = new THREE.Group();
            const body = new THREE.Mesh(
                new THREE.SphereGeometry(0.25, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0xddaa66 })
            );
            body.position.y = 0.3;
            body.scale.set(1, 0.8, 1.3);
            group.add(body);
            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.12, 5, 4),
                new THREE.MeshStandardMaterial({ color: 0xddaa66 })
            );
            head.position.set(0, 0.5, 0.2);
            group.add(head);
            const comb = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.08, 0.06),
                new THREE.MeshStandardMaterial({ color: 0xcc2222 })
            );
            comb.position.set(0, 0.6, 0.2);
            group.add(comb);
            return group;
        }
        case "deer": {
            const group = new THREE.Group();
            const body = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.3, 0.8, 4, 6),
                new THREE.MeshStandardMaterial({ color: 0x8a6a3a })
            );
            body.position.y = 0.8;
            body.rotation.z = Math.PI / 2;
            body.castShadow = true;
            group.add(body);
            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0x9a7a4a })
            );
            head.position.set(0, 1.1, 0.5);
            group.add(head);
            return group;
        }
        // --- New canopy trees ---
        case "hazelnut":
            return makeTree(0x5a4020, 0.2, 3.5, 0x3a6a1a, 2.0, 2.0, 4.8);
        case "almond":
            return makeTree(0x6a5a3a, 0.15, 3, 0x4a7a3a, 1.8, 1.5, 4.2);
        case "corkoak":
            return makeTree(0x4a3018, 0.35, 5, 0x2a5a1a, 3.0, 2.5, 6.5);
        case "redwood":
            return makeTree(0x6a2a1a, 0.4, 10, 0x1a4a1a, 2.5, 4.0, 11.0);
        case "macadamia":
            return makeTree(0x5a4a2a, 0.25, 4, 0x2a6a2a, 2.2, 2.2, 5.5);
        case "stonepine": {
            const g = new THREE.Group();
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.15, 0.25, 7, 6),
                new THREE.MeshStandardMaterial({ color: 0x5a3a1a })
            );
            trunk.position.y = 3.5; trunk.castShadow = true; g.add(trunk);
            const canopy = new THREE.Mesh(
                new THREE.SphereGeometry(3.0, 8, 6),
                new THREE.MeshStandardMaterial({ color: 0x2a5a2a })
            );
            canopy.position.y = 8; canopy.scale.y = 0.4; canopy.castShadow = true; g.add(canopy);
            return g;
        }
        case "pistachio":
            return makeTree(0x6a5a3a, 0.2, 3, 0x5a7a3a, 2.0, 1.5, 4.2);
        case "bamboo": {
            const g = new THREE.Group();
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const r = 0.3 + Math.random() * 0.3;
                const h = 4 + Math.random() * 4;
                const stalk = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.05, 0.06, h, 4),
                    new THREE.MeshStandardMaterial({ color: 0x6a8a3a })
                );
                stalk.position.set(Math.cos(angle) * r, h / 2, Math.sin(angle) * r);
                stalk.castShadow = true; g.add(stalk);
                const leaves = new THREE.Mesh(
                    new THREE.SphereGeometry(0.4, 5, 4),
                    new THREE.MeshStandardMaterial({ color: 0x4a7a2a })
                );
                leaves.position.set(Math.cos(angle) * r, h - 0.3, Math.sin(angle) * r);
                leaves.scale.y = 0.5; g.add(leaves);
            }
            return g;
        }
        case "cherry":
            return makeTree(0x5a3a2a, 0.2, 4, 0xcc6688, 2.2, 2.0, 5.5);
        // --- New understory ---
        case "plum":
            return makeTree(0x5a3a2a, 0.12, 2, 0x3a6a2a, 1.5, 1.5, 3.2);
        case "avocado":
            return makeTree(0x5a4a2a, 0.2, 3, 0x2a5a1a, 2.0, 2.0, 4.5);
        case "mulberry":
            return makeTree(0x5a3a1a, 0.18, 3, 0x3a7a2a, 2.0, 1.8, 4.2);
        case "banana": {
            const g = new THREE.Group();
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.18, 3, 5),
                new THREE.MeshStandardMaterial({ color: 0x6a8a3a })
            );
            trunk.position.y = 1.5; g.add(trunk);
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const leaf = new THREE.Mesh(
                    new THREE.BoxGeometry(0.2, 0.05, 1.5),
                    new THREE.MeshStandardMaterial({ color: 0x3a8a2a })
                );
                leaf.position.set(Math.cos(angle) * 0.5, 3.2, Math.sin(angle) * 0.5);
                leaf.rotation.y = angle;
                leaf.rotation.x = -0.4; g.add(leaf);
            }
            return g;
        }
        case "mango":
            return makeTree(0x5a4a2a, 0.25, 4, 0x2a6a1a, 2.5, 2.0, 5.5);
        case "persimmon":
            return makeTree(0x5a3a1a, 0.15, 3, 0x4a7a2a, 1.8, 1.8, 4.2);
        // --- New shrubs ---
        case "thyme": {
            const g = new THREE.Group();
            const mat = new THREE.MeshStandardMaterial({ color: 0x4a6a4a });
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const s = new THREE.Mesh(new THREE.SphereGeometry(0.15, 4, 3), mat);
                s.position.set(Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2);
                s.scale.y = 0.5; g.add(s);
            }
            return g;
        }
        case "sage": {
            const g = new THREE.Group();
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const leaf = new THREE.Mesh(
                    new THREE.ConeGeometry(0.18, 0.8, 4),
                    new THREE.MeshStandardMaterial({ color: 0x6a7a6a })
                );
                leaf.position.set(Math.cos(a) * 0.25, 0.4, Math.sin(a) * 0.25);
                g.add(leaf);
            }
            return g;
        }
        case "rooibos": {
            const g = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * Math.PI * 2;
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.02, 0.03, 1.0, 3),
                    new THREE.MeshStandardMaterial({ color: 0x8a4a2a })
                );
                stem.position.set(Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2);
                g.add(stem);
            }
            return g;
        }
        case "protea": {
            const g = new THREE.Group();
            const stem = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.06, 1.0, 4),
                new THREE.MeshStandardMaterial({ color: 0x4a5a3a })
            );
            stem.position.y = 0.5; g.add(stem);
            const flower = new THREE.Mesh(
                new THREE.ConeGeometry(0.3, 0.4, 8),
                new THREE.MeshStandardMaterial({ color: 0xcc4466 })
            );
            flower.position.y = 1.2; flower.rotation.x = Math.PI; g.add(flower);
            return g;
        }
        case "tea": {
            const g = new THREE.Group();
            const bush = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0x3a6a2a })
            );
            bush.position.y = 0.4; bush.scale.y = 0.6; g.add(bush);
            return g;
        }
        // --- New herbs ---
        case "basil": {
            const g = new THREE.Group();
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2;
                const leaf = new THREE.Mesh(
                    new THREE.SphereGeometry(0.12, 4, 3),
                    new THREE.MeshStandardMaterial({ color: 0x2a8a2a })
                );
                leaf.position.set(Math.cos(a) * 0.15, 0.25, Math.sin(a) * 0.15);
                leaf.scale.y = 0.3; g.add(leaf);
            }
            return g;
        }
        case "saffron": {
            const g = new THREE.Group();
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2;
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.01, 0.01, 0.5, 3),
                    new THREE.MeshStandardMaterial({ color: 0x5a7a3a })
                );
                stem.position.set(Math.cos(a) * 0.08, 0.25, Math.sin(a) * 0.08);
                g.add(stem);
                const tip = new THREE.Mesh(
                    new THREE.SphereGeometry(0.05, 4, 3),
                    new THREE.MeshStandardMaterial({ color: 0xaa44aa })
                );
                tip.position.set(Math.cos(a) * 0.08, 0.55, Math.sin(a) * 0.08);
                g.add(tip);
            }
            return g;
        }
        case "shiso": {
            const g = new THREE.Group();
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const leaf = new THREE.Mesh(
                    new THREE.SphereGeometry(0.1, 4, 3),
                    new THREE.MeshStandardMaterial({ color: 0x6a2a4a })
                );
                leaf.position.set(Math.cos(a) * 0.15, 0.2 + i * 0.05, Math.sin(a) * 0.15);
                leaf.scale.y = 0.3; g.add(leaf);
            }
            return g;
        }
        case "animal": {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.3, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0xcc8844 })
            );
            mesh.position.y = 0.3;
            mesh.castShadow = true;
            return mesh;
        }
        default: {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.3, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0xaaaaaa })
            );
            mesh.position.y = 0.3;
            return mesh;
        }
    }
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
        if (eid && selectedAction === "inspect") {
            ws.send(buildActionMessage(encodeInspectAction(eid)));
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
                    "plant-olive": 203,
                    "plant-fig": 200,
                    "plant-lavender": 301,
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

function encodeInspectAction(entityId) {
    return [...encodeVarint(11), ...encodeVarint(entityId)];
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

// --- Water and fish animation ---

function updateWater(time) {
    for (const mesh of waterMeshes) {
        if (mesh.material) {
            mesh.material.opacity = 0.55 + Math.sin(time * 1.5) * 0.1;
        }
    }
    if (fishGroup) {
        for (const fish of fishGroup.children) {
            const t = time * fish.userData.speed + fish.userData.phase;
            fish.position.x = fish.userData.baseX + Math.sin(t) * fish.userData.radius;
            fish.position.z = fish.userData.baseZ + Math.cos(t) * fish.userData.radius;
            fish.rotation.y = t + Math.PI / 2;
        }
    }
}

// --- Game loop ---

let lastTime = performance.now();
let inputTimer = 0;
let minimapTimer = 0;

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
    updateWater(now / 1000);
    minimapTimer += dt;
    if (minimapTimer >= 0.2) {
        minimapTimer = 0;
        updateMinimapPlayer();
    }

    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function updateStatus(text) {
    document.getElementById("status").textContent = text;
}
