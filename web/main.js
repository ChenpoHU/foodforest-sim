import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
// Entity model registry + shared tree builder live in their own files
// under ./models/. main.js consults MODEL_BUILDERS first; species that
// haven't been migrated yet still fall through to the inline switch.
import { MODEL_BUILDERS, makeTreePositional as makeTree } from "./models/index.js";
// Binary protocol (de)serialisation primitives.
import {
    BincodeReader, encodeVarint, encodeZigzagVarint, encodeF32,
    encodeBincodeString, buildFramedMessage,
} from "./net/codec.js";
// Static world data (countries, regions, per-country plantable species).
import {
    WORLD_COUNTRIES, COUNTRY_PLANTS, getCountryForRegion,
} from "./data/world.js";
// Per-species animal movement "habits".
import { ANIMAL_GAITS } from "./data/gaits.js";
// ActionKind → wire-bytes encoders.
import {
    encodePlantAction, encodeHarvestAction, encodeWaterAction,
    encodeSwaleAction, encodeHugelAction, encodeCutTreeAction,
    encodeInspectAction, encodeHuntAction, encodeEatAction,
    encodeSellAction, encodeDeployAIAction, encodePropagandaAction,
    encodeGrantUbiAction, encodeIssueTaskAction, encodeAscendAction,
    encodeRevoltAction, encodeResearchAction, encodeDeployBreakthroughAction,
    encodeHochsitzAction, encodeCraftAction,
} from "./net/messages.js";
// Ambient generative piano (Web Audio).
import { startAmbientMusic } from "./audio/music.js";

// Surface any uncaught runtime / promise error as a visible red banner
// instead of failing silently to a blank screen. Without this, a single
// throw during connect-screen setup leaves only the static HTML on
// screen with no clue why.
function _showFatal(msg) {
    let box = document.getElementById("fatal-error");
    if (!box) {
        box = document.createElement("div");
        box.id = "fatal-error";
        box.style.cssText = [
            "position:fixed", "top:0", "left:0", "right:0", "z-index:99999",
            "background:#7a1010", "color:#fff", "padding:10px 16px",
            "font:12px/1.5 monospace", "white-space:pre-wrap",
            "box-shadow:0 2px 10px rgba(0,0,0,0.6)",
        ].join(";");
        (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = "⚠️ Runtime error (screenshot this):\n" + msg;
}
window.addEventListener("error", (e) => {
    _showFatal((e.message || "error") + (e.filename ? "\n" + e.filename + ":" + e.lineno : ""));
});
window.addEventListener("unhandledrejection", (e) => {
    _showFatal("Promise: " + ((e.reason && e.reason.message) || e.reason || "rejection"));
});

let ws = null;
let connected = false;
let playerName = "Farmer";
let selectedAction = null;
let myEntityId = 0;
let myPlayerId = 0;
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
let butterflyGroup = null;

const keys = new Set();
let inputSeq = 0;

// Connect screen
document.getElementById("connect-btn").addEventListener("click", () => {
    try {
        playerName = document.getElementById("player-name").value || "Farmer";
        const serverUrl = document.getElementById("server-url").value || "ws://localhost:9000";
        selectedPlotSeed = parseInt(document.getElementById("plot-seed-input").value) || 42;
        document.getElementById("connect-screen").style.display = "none";
        // Optimistically reflect the role the user picked so the toolbar
        // renders correctly on first paint, before the server has had a
        // chance to confirm or downgrade (Tech Monarch outside Realistic
        // is silently downgraded server-side; the next ServerPlayerState
        // will correct us if so).
        // Optimistic role display until ServerPlayerState confirms.
        // Monarch needs Realistic; Innovator needs Realistic OR Survival.
        if (selectedRole === 1 && selectedGameMode === 1) {
            playerRoleLive = 1;
        } else if (selectedRole === 2 && (selectedGameMode === 1 || selectedGameMode === 2)) {
            playerRoleLive = 2;
        } else {
            playerRoleLive = 0;
        }
        rebuildToolbar();
        init(serverUrl);
    } catch (err) {
        // Surface any startup error to the visible status bar so we don't
        // just sit silently on "Connecting...".
        console.error("Startup failed:", err);
        document.getElementById("status").textContent =
            "Startup error: " + (err && err.message ? err.message : String(err));
    }
});

document.getElementById("player-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("connect-btn").click();
});

const modeDescriptions = {
    0: "No casualties. Trees disappear when cut. Relaxed pace for all ages.",
    1: "Full felling physics. Falling trees can crush you. Real danger.",
    2: "Wildfire deadline + animals with learning AI that adapt to your behavior.",
};

// Player role: 0 = Farmer (default), 1 = Tech Monarch (Realistic mode only).
let selectedRole = 0;

// Live Monarch state from the server. `playerRoleLive` is 0 (Farmer) or
// 1 (Tech Monarch), and the server has final say (TechMonarch outside
// Realistic gets quietly downgraded to Farmer).
// These have to live above `rebuildToolbar()` because that function is
// invoked at module-load time and reads `playerRoleLive`.
let playerRoleLive = 0;
let monarchCompute = 0;
let monarchInfluence = 0;
let monarchDeployments = 0;
let monarchJobsCut = 0;
// Innovator state mirrors Monarch's structure.
let innovatorKnowledge = 0;
let innovatorBreakthroughs = 0;
let innovatorFocusTopic = 0;
// Active server-side catastrophe (kind=0 means none).
let activeCatastrophe = { kind: 0, intensity: 0, ticksRemaining: 0, message: "" };
// Append-only log of recent Monarch decisions for the dashboard.
const monarchDecisions = [];
function pushMonarchDecision(text, tone) {
    monarchDecisions.push({ text, tone: tone || "ok", at: Date.now() });
    while (monarchDecisions.length > 12) monarchDecisions.shift();
}

const roleDescriptions = {
    0: "Plant, harvest, and trade your own food forest.",
    1: "Deploy semi-AI workers to auto-harvest the world. Each AI run accrues FoFo and Influence, and cuts a job a farmer might have done.",
    2: "The distributed human counterweight to centralised AI. Research Climate, Medicine, Defense, and Food — then deploy breakthroughs that resolve global catastrophes the AI can't solve alone.",
};

function refreshRoleVisibility() {
    const row = document.getElementById("role-row");
    if (!row) return;
    // Tech Monarch is only legal in Realistic (mode 1).
    // Innovator is legal in Realistic OR Survival (mode 2) — they're
    // the role that earns its keep when catastrophes hit.
    // Peaceful (mode 0): only Farmer.
    const isRealistic = (selectedGameMode === 1);
    const isSurvival  = (selectedGameMode === 2);
    if (isRealistic || isSurvival) {
        row.style.display = "flex";
        // Hide the TechMonarch button when not Realistic.
        document.querySelectorAll(".role-btn").forEach(b => {
            const r = parseInt(b.dataset.role);
            if (r === 1) b.style.display = isRealistic ? "flex" : "none";
        });
        // If TechMonarch was selected and we just switched to Survival,
        // drop back to Farmer so the connect button can't send invalid.
        if (selectedRole === 1 && !isRealistic) {
            selectedRole = 0;
            applyRoleVisuals();
        }
    } else {
        row.style.display = "none";
        if (selectedRole !== 0) {
            selectedRole = 0;
            applyRoleVisuals();
        }
    }
}

function applyRoleVisuals() {
    // Active state is purely a CSS class now (.role-btn.active) — no
    // inline styles, so the stylesheet owns the look.
    document.querySelectorAll(".role-btn").forEach(b => {
        b.classList.toggle("active", parseInt(b.dataset.role) === selectedRole);
    });
    const desc = document.getElementById("role-desc");
    if (desc) desc.textContent = roleDescriptions[selectedRole];
}

document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedGameMode = parseInt(btn.dataset.mode);
        document.getElementById("mode-desc").textContent = modeDescriptions[selectedGameMode];
        refreshRoleVisibility();
    });
});

document.querySelectorAll(".role-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        selectedRole = parseInt(btn.dataset.role);
        applyRoleVisuals();
    });
});

// === World data ===
// WORLD_COUNTRIES → ./data/world.js (imported at top)

let selectedCountryIdx = 0;

// Static layer (ocean + continents) is identical every redraw, so we
// render it once into an offscreen canvas and blit instead of running
// ~40 path operations every time the user clicks a country. ~50× faster
// redraw and avoids a noticeable flicker on the connect screen.
let _worldMapBase = null;
function buildWorldMapBase(w, h) {
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const ctx = off.getContext("2d");

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
    return off;
}

function drawWorldMap() {
    const canvas = document.getElementById("world-canvas");
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;

    // Lazily build the static base layer the first time, then blit.
    if (!_worldMapBase) _worldMapBase = buildWorldMapBase(w, h);
    ctx.drawImage(_worldMapBase, 0, 0);

    // Draw country markers (only this loop runs on each redraw).
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

// Country-specific plantable species
// COUNTRY_PLANTS → ./data/world.js

// getCountryForRegion → ./data/world.js

// Icon colors for toolbar items
const TOOL_ICONS = {
    "build-swale": { icon: "~", color: "#3388aa", bg: "#1a3a4a" },
    "build-hugel": { icon: "=", color: "#8a5a2a", bg: "#3a2a1a" },
    "water": { icon: "o", color: "#44aaee", bg: "#1a3a5a" },
    "harvest": { icon: "+", color: "#eedd44", bg: "#3a3a1a" },
    "cut-tree": { icon: "x", color: "#ee6644", bg: "#3a1a1a" },
    "hunt": { icon: ">", color: "#cc6644", bg: "#3a2a1a" },
    "build-hochsitz": { icon: "^", color: "#8a6a3a", bg: "#2a2a1a" },
    "inspect": { icon: "?", color: "#88bbcc", bg: "#1a2a3a" },
};

function makeToolbarIcon(size, fillColor, symbol) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (symbol) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold " + (size * 0.45) + "px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(symbol, size/2, size/2);
    }
    return c.toDataURL();
}

function makeFruitIcon(size, fruitColor) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    // Leaf
    ctx.beginPath();
    ctx.ellipse(size * 0.6, size * 0.2, size * 0.12, size * 0.08, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#4a8a3a";
    ctx.fill();
    // Stem
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.25);
    ctx.lineTo(size * 0.5, size * 0.35);
    ctx.strokeStyle = "#5a4a2a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Fruit body
    ctx.beginPath();
    ctx.arc(size/2, size * 0.58, size * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = fruitColor;
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.arc(size * 0.42, size * 0.5, size * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fill();
    return c.toDataURL();
}

// Plant color mapping for toolbar icons
const PLANT_ICON_COLORS = {
    "chestnut": "#8a5a1a", "walnut": "#6a4a18", "carob": "#5a3a1a", "hazelnut": "#8a6a2a",
    "almond": "#eeddcc", "corkoak": "#4a3018", "redwood": "#6a2a1a", "macadamia": "#ddccaa",
    "stonepine": "#5a3a1a", "pistachio": "#7a9a4a", "bamboo": "#6a8a3a", "cherry": "#cc1122",
    "olive": "#7a9a6a", "fig": "#6a2a5a", "pomegranate": "#cc2233", "citrus": "#ffaa22",
    "plum": "#6622aa", "avocado": "#3a5a1a", "mulberry": "#3a1a2a", "banana": "#ddcc33",
    "mango": "#ee8822", "persimmon": "#ee6622", "peach": "#ffaa88",
    "rosemary": "#3a6a3a", "lavender": "#8855aa", "thyme": "#6a8a4a", "sage": "#8a9a7a",
    "rooibos": "#aa4422", "protea": "#cc4466", "tea": "#3a7a3a",
    "comfrey": "#3a7a2a", "basil": "#2a8a2a", "saffron": "#ee8811", "shiso": "#5a2a4a",
    "clover": "#2a8a2a", "strawberry": "#cc2222", "grapevine": "#5522aa",
};

// Currently selected plant species (from the Plant menu). When set,
// clicking the world plants this species. Cleared when the user switches
// to another tool.
let selectedPlant = null; // { action, label, sid }

function rebuildToolbar() {
    const toolbar = document.getElementById("toolbar");
    toolbar.innerHTML = "";

    // --- Innovator toolbar ------------------------------------------------
    // Distributed-human-brain counterweight to the AI Monarch. Toolbar
    // exposes four Research topics + Deploy Breakthrough + Inspect +
    // a live Knowledge chip. No planting/farming buttons — Innovators
    // contribute via insight, not labour.
    if (playerRoleLive === 2) {
        const topics = [
            { code: 0, icon: "🌡️", label: "Climate"  },
            { code: 1, icon: "💊", label: "Medicine" },
            { code: 2, icon: "🛡️", label: "Defense"  },
            { code: 3, icon: "🌾", label: "Food"     },
        ];
        for (const t of topics) {
            const b = document.createElement("button");
            b.dataset.action = "research-" + t.code;
            b.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 12px;";
            b.innerHTML =
                "<span style='font-size:18px;'>" + t.icon + "</span>" +
                "<span style='font-size:11px;'>" + t.label + "</span>";
            toolbar.appendChild(b);
        }

        const breakthroughBtn = document.createElement("button");
        breakthroughBtn.dataset.action = "deploy-breakthrough";
        breakthroughBtn.id = "toolbar-breakthrough-btn";
        breakthroughBtn.style.cssText =
            "display:flex; align-items:center; gap:6px; padding:6px 12px; background:#3a2a4a; border:1px solid #6a4a8a;";
        breakthroughBtn.innerHTML =
            "<span style='font-size:18px;'>💡</span>" +
            "<span style='font-size:11px;'>Deploy Breakthrough</span>";
        toolbar.appendChild(breakthroughBtn);

        const inspectBtn = document.createElement("button");
        inspectBtn.dataset.action = "inspect";
        inspectBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 12px;";
        inspectBtn.innerHTML = "<span style='font-size:18px;'>?</span><span style='font-size:11px;'>Inspect</span>";
        toolbar.appendChild(inspectBtn);

        // Live Knowledge chip
        const chips = document.createElement("div");
        chips.style.cssText = "display:flex; align-items:center; gap:6px; margin-left:6px;";
        chips.innerHTML =
            "<span id='toolbar-knowledge-chip' style='background:rgba(216,181,255,0.18); color:#d8b5ff; border:1px solid #8a6ab8; border-radius:10px; padding:2px 8px; font-size:11px; font-weight:bold;'>🔬 0 Knowledge</span>";
        toolbar.appendChild(chips);

        toolbar.querySelectorAll("button").forEach(b => {
            b.addEventListener("click", () => {
                const action = b.dataset.action;
                toolbar.querySelectorAll("button").forEach(x => x.classList.remove("active"));
                b.classList.add("active");
                selectedAction = action;
                selectedPlant = null;
            });
        });

        selectedAction = null;
        refreshInnovatorHud();
        return;
    }

    // --- Tech Monarch toolbar ---------------------------------------------
    // Monarchs don't farm by hand. Their toolbar is just: deploy AI,
    // open dashboard, inspect, and a live Compute/Influence readout.
    if (playerRoleLive === 1) {
        const deployBtn = document.createElement("button");
        deployBtn.dataset.action = "deploy-ai";
        deployBtn.id = "toolbar-deploy-btn";
        deployBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 12px;";
        deployBtn.innerHTML =
            "<span style='font-size:18px;'>🤖</span>" +
            "<span style='font-size:11px;'>Deploy AI</span>";
        toolbar.appendChild(deployBtn);

        const dashBtn = document.createElement("button");
        dashBtn.dataset.action = "monarch-dashboard";
        dashBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 12px;";
        dashBtn.innerHTML =
            "<span style='font-size:18px;'>📊</span>" +
            "<span style='font-size:11px;'>Dashboard</span>";
        toolbar.appendChild(dashBtn);

        const inspectBtn = document.createElement("button");
        inspectBtn.dataset.action = "inspect";
        inspectBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 12px;";
        inspectBtn.innerHTML = "<span style='font-size:18px;'>?</span><span style='font-size:11px;'>Inspect</span>";
        toolbar.appendChild(inspectBtn);

        // Live resource chips
        const chips = document.createElement("div");
        chips.style.cssText = "display:flex; align-items:center; gap:6px; margin-left:6px;";
        chips.innerHTML =
            "<span id='toolbar-compute-chip' style='background:rgba(60,200,255,0.18); color:#8ccdff; border:1px solid #4477aa; border-radius:10px; padding:2px 8px; font-size:11px; font-weight:bold;'>⚡ 0 Compute</span>" +
            "<span id='toolbar-influence-chip' style='background:rgba(255,210,90,0.18); color:#ffd966; border:1px solid #c9a45a; border-radius:10px; padding:2px 8px; font-size:11px; font-weight:bold;'>★ 0 Influence</span>" +
            "<span id='toolbar-coin-chip' style='background:rgba(255,200,80,0.18); color:#ffd966; border:1px solid #c9a45a; border-radius:10px; padding:2px 8px; font-size:11px; font-weight:bold;'>🪙 0</span>";
        toolbar.appendChild(chips);

        toolbar.querySelectorAll("button").forEach(b => {
            b.addEventListener("click", () => {
                const action = b.dataset.action;
                if (action === "monarch-dashboard") {
                    openMonarchDashboard();
                    return;
                }
                toolbar.querySelectorAll("button").forEach(x => x.classList.remove("active"));
                b.classList.add("active");
                selectedAction = action;
                selectedPlant = null;
            });
        });

        // No persisted action by default.
        selectedAction = null;
        refreshCoinChip();
        refreshMonarchHud();
        return;
    }

    // --- Farmer toolbar (default) -----------------------------------------

    // Drop the plant selection if we moved to a region that doesn't grow it,
    // so the toolbar label never lies about what will be planted.
    if (selectedPlant) {
        const country = getCountryForRegion(selectedRegion);
        const plants = COUNTRY_PLANTS[country] || COUNTRY_PLANTS["Portugal"];
        if (!plants.some(p => p.action === selectedPlant.action)) {
            selectedPlant = null;
        }
    }

    // Single aggregated "Plant" button — opens the plant menu.
    const plantBtn = document.createElement("button");
    plantBtn.dataset.action = "plant";
    plantBtn.id = "toolbar-plant-btn";
    const plantKey = selectedPlant ? selectedPlant.action.replace("plant-", "") : "olive";
    const plantColor = PLANT_ICON_COLORS[plantKey] || "#5a8a3a";
    const plantIcon = document.createElement("img");
    plantIcon.src = makeFruitIcon(28, plantColor);
    plantIcon.style.cssText = "width:28px; height:28px; vertical-align:middle; margin-right:4px;";
    plantBtn.appendChild(plantIcon);
    const plantLabel = document.createElement("span");
    plantLabel.id = "toolbar-plant-label";
    plantLabel.textContent = selectedPlant ? selectedPlant.label + " ▾" : "Plant ▾";
    plantLabel.style.fontSize = "11px";
    plantBtn.appendChild(plantLabel);
    plantBtn.style.display = "flex";
    plantBtn.style.alignItems = "center";
    plantBtn.style.padding = "6px 10px";
    if (selectedAction && selectedAction.startsWith("plant-")) {
        plantBtn.classList.add("active");
    }
    toolbar.appendChild(plantBtn);

    // Property button — opens the owned-items modal (eat + sell for FoFo Coin).
    // Carries the live coin count as a chip on the right so the player
    // always sees their balance without opening the modal.
    const propBtn = document.createElement("button");
    propBtn.dataset.action = "property";
    propBtn.id = "toolbar-property-btn";
    propBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 10px;";
    propBtn.innerHTML =
        "<span style='font-size:18px;'>🎒</span>" +
        "<span style='font-size:11px;'>Property</span>" +
        "<span id='toolbar-coin-chip' style='background:rgba(255,200,80,0.18); color:#ffd966; border:1px solid #c9a45a; border-radius:10px; padding:1px 8px; font-size:11px; font-weight:bold; margin-left:2px;'>🪙 0</span>";
    toolbar.appendChild(propBtn);

    // Wardrobe button — craft + wear clothes from gathered plant fibre
    // and hunted animal hide.
    const wardrobeBtn = document.createElement("button");
    wardrobeBtn.dataset.action = "wardrobe";
    wardrobeBtn.id = "toolbar-wardrobe-btn";
    wardrobeBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 10px;";
    wardrobeBtn.innerHTML =
        "<span style='font-size:18px;'>👕</span>" +
        "<span style='font-size:11px;'>Wardrobe</span>";
    toolbar.appendChild(wardrobeBtn);

    // Politics button — Realistic mode only. Opens the modal where a
    // Farmer can ascend (if they've saved 500 coins) or revolt against
    // any active Monarch.
    if (selectedGameMode === 1) {
        const polBtn = document.createElement("button");
        polBtn.dataset.action = "politics";
        polBtn.id = "toolbar-politics-btn";
        polBtn.style.cssText = "display:flex; align-items:center; gap:6px; padding:6px 10px;";
        polBtn.innerHTML =
            "<span style='font-size:18px;'>🗳️</span>" +
            "<span style='font-size:11px;'>Politics</span>";
        toolbar.appendChild(polBtn);
    }

    const tools = [
        { action: "build-swale", label: "Swale" },
        { action: "build-hugel", label: "Hugel" },
        { action: "water", label: "Water" },
        { action: "harvest", label: "Harvest" },
    ];

    if (selectedGameMode !== 0) {
        tools.push({ action: "cut-tree", label: "Cut" });
        tools.push({ action: "hunt", label: "Hunt" });
        tools.push({ action: "build-hochsitz", label: "Hochsitz" });
    }

    tools.push({ action: "inspect", label: "Inspect" });

    for (const t of tools) {
        const btn = document.createElement("button");
        btn.dataset.action = t.action;
        const ti = TOOL_ICONS[t.action] || { icon: ".", color: "#aaa", bg: "#333" };
        const icon = document.createElement("img");
        icon.src = makeToolbarIcon(24, ti.color, ti.icon);
        icon.style.cssText = "width:24px; height:24px; vertical-align:middle; margin-right:3px;";
        btn.appendChild(icon);
        const label = document.createElement("span");
        label.textContent = t.label;
        label.style.fontSize = "11px";
        btn.appendChild(label);
        btn.style.display = "flex";
        btn.style.alignItems = "center";
        btn.style.padding = "6px 10px";
        toolbar.appendChild(btn);
    }

    toolbar.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.action;
            if (action === "plant") {
                // The Plant button always opens the menu so the user can
                // (re)pick a species. Selection is made inside the modal.
                openPlantMenu();
                return;
            }
            if (action === "property") {
                openPropertyMenu();
                return;
            }
            if (action === "wardrobe") {
                openWardrobe();
                return;
            }
            if (action === "politics") {
                openPoliticsMenu();
                return;
            }
            toolbar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectedAction = action;
            // Switching to a non-plant tool clears the plant selection.
            selectedPlant = null;
            refreshPlantToolbarButton();
        });
    });

    // Preserve an existing plant selection across rebuilds (e.g. region
    // change). Otherwise the user would silently lose what they had armed.
    if (selectedPlant) {
        selectedAction = selectedPlant.action;
        plantBtn.classList.add("active");
    } else {
        selectedAction = null;
    }
}

// --- Plant menu (aggregated planting UI) -----------------------------------

const PLANT_LAYERS = [
    { name: "Canopy Trees", subtitle: "Tall, long-lived. ~1–3 min to fruit.", range: [100, 199] },
    { name: "Fruit Trees", subtitle: "Smaller fruit trees. ~10–30 sec to fruit.", range: [200, 299] },
    { name: "Shrubs & Aromatics", subtitle: "Rosemary, lavender, sage…", range: [300, 399] },
    { name: "Herbs", subtitle: "Comfrey, basil, saffron…", range: [400, 499] },
    { name: "Ground Cover & Vines", subtitle: "Clover, strawberry, grape.", range: [500, 699] },
];

function openPlantMenu() {
    if (document.pointerLockElement) document.exitPointerLock();

    const modal = document.getElementById("plant-menu");
    const body = document.getElementById("plant-menu-body");
    const country = getCountryForRegion(selectedRegion);
    const plants = COUNTRY_PLANTS[country] || COUNTRY_PLANTS["Portugal"];

    body.innerHTML = "";
    for (const layer of PLANT_LAYERS) {
        const inLayer = plants.filter(p => p.sid >= layer.range[0] && p.sid <= layer.range[1]);
        if (inLayer.length === 0) continue;

        const section = document.createElement("div");
        section.style.cssText = "margin-bottom:14px;";

        const header = document.createElement("div");
        header.style.cssText = "color:#8f8; font-size:13px; font-weight:bold; margin-bottom:2px;";
        header.textContent = layer.name;
        section.appendChild(header);

        const sub = document.createElement("div");
        sub.style.cssText = "color:#888; font-size:11px; margin-bottom:8px;";
        sub.textContent = layer.subtitle;
        section.appendChild(sub);

        const grid = document.createElement("div");
        grid.style.cssText = "display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:8px;";

        for (const p of inLayer) {
            const card = document.createElement("button");
            const key = p.action.replace("plant-", "");
            const color = PLANT_ICON_COLORS[key] || "#5a8a3a";
            const isCurrent = selectedPlant && selectedPlant.action === p.action;
            card.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 6px; background:" + (isCurrent ? "rgba(60,140,60,0.85)" : "rgba(20,40,20,0.75)") + "; color:" + (isCurrent ? "#fff" : "#cfc") + "; border:1px solid " + (isCurrent ? "#b9f6ca" : "#3a5a3a") + "; border-radius:8px; cursor:pointer; font-family:system-ui, sans-serif;" + (isCurrent ? "box-shadow:0 0 8px rgba(140,255,140,0.4);" : "");
            const img = document.createElement("img");
            img.src = makeFruitIcon(36, color);
            img.style.cssText = "width:36px; height:36px;";
            card.appendChild(img);
            const lbl = document.createElement("span");
            lbl.textContent = p.label;
            lbl.style.cssText = "font-size:12px; font-weight:600;";
            card.appendChild(lbl);
            card.addEventListener("mouseenter", () => {
                if (!isCurrent) card.style.background = "rgba(40,80,40,0.85)";
            });
            card.addEventListener("mouseleave", () => {
                if (!isCurrent) card.style.background = "rgba(20,40,20,0.75)";
            });
            card.addEventListener("click", () => selectPlantFromMenu(p));
            grid.appendChild(card);
        }
        section.appendChild(grid);
        body.appendChild(section);
    }

    modal.style.display = "flex";
}

function closePlantMenu() {
    document.getElementById("plant-menu").style.display = "none";
}

function selectPlantFromMenu(p) {
    selectedPlant = { action: p.action, label: p.label, sid: p.sid };
    selectedAction = p.action;
    closePlantMenu();
    refreshPlantToolbarButton();
}

function refreshPlantToolbarButton() {
    const label = document.getElementById("toolbar-plant-label");
    const btn = document.getElementById("toolbar-plant-btn");
    if (!label || !btn) return;
    if (selectedPlant) {
        label.textContent = selectedPlant.label + " ▾";
        const key = selectedPlant.action.replace("plant-", "");
        const color = PLANT_ICON_COLORS[key] || "#5a8a3a";
        btn.querySelector("img").src = makeFruitIcon(28, color);
        const isActivePlanting = selectedAction && selectedAction.startsWith("plant-");
        btn.classList.toggle("active", isActivePlanting);
    } else {
        label.textContent = "Plant ▾";
        btn.classList.remove("active");
    }
}

// Wire up modal close handlers (once at startup).
document.getElementById("plant-menu-close").addEventListener("click", closePlantMenu);
document.getElementById("plant-menu").addEventListener("click", (e) => {
    if (e.target.id === "plant-menu") closePlantMenu();
});
document.getElementById("property-menu-close").addEventListener("click", closePropertyMenu);
document.getElementById("property-menu").addEventListener("click", (e) => {
    if (e.target.id === "property-menu") closePropertyMenu();
});
document.getElementById("wardrobe-close").addEventListener("click", closeWardrobe);
document.getElementById("wardrobe-modal").addEventListener("click", (e) => {
    if (e.target.id === "wardrobe-modal") closeWardrobe();
});
document.getElementById("monarch-dashboard-close").addEventListener("click", closeMonarchDashboard);
document.getElementById("monarch-dashboard").addEventListener("click", (e) => {
    if (e.target.id === "monarch-dashboard") closeMonarchDashboard();
});
document.getElementById("politics-close").addEventListener("click", closePoliticsMenu);
document.getElementById("politics-menu").addEventListener("click", (e) => {
    if (e.target.id === "politics-menu") closePoliticsMenu();
});
document.getElementById("politics-ascend").addEventListener("click", sendAscend);

// Propaganda composer: hooked up once at module load. The Send button
// fires the ClientAction; the optimistic UI feedback comes from the
// ServerActionResult round-trip (which also tells us if Influence was
// too low etc.).
function sendPropaganda() {
    const msgEl = document.getElementById("prop-message");
    const toneEl = document.getElementById("prop-tone");
    const fb = document.getElementById("prop-feedback");
    if (!msgEl || !toneEl) return;
    const message = msgEl.value.trim();
    if (!message) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Write something first."; }
        return;
    }
    if (!ws || ws.readyState !== 1) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Not connected."; }
        return;
    }
    const tone = parseInt(toneEl.value, 10) || 0;
    ws.send(buildActionMessage(encodePropagandaAction(tone, message)));
    if (fb) { fb.style.color = "#8fcf8f"; fb.textContent = "Broadcasting…"; }
    msgEl.value = "";
}
document.getElementById("prop-send").addEventListener("click", sendPropaganda);
document.getElementById("prop-message").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendPropaganda();
    }
});

// UBI composer ------------------------------------------------------------
function sendUbi(presetTargetId) {
    const targetEl = document.getElementById("ubi-target");
    const amountEl = document.getElementById("ubi-amount");
    const fb = document.getElementById("ubi-feedback");
    if (!targetEl || !amountEl) return;
    // When a per-row "Pay" button is used we pass the target id directly
    // and ignore the dropdown selection.
    let target = presetTargetId !== undefined
        ? presetTargetId
        : (targetEl.value ? targetEl.value : "0");
    // BigInt-safe: player ids are u64; we send them verbatim back through
    // encodeVarint which accepts numbers up to u32 — fine because our
    // monotonic counter starts at 1 and won't blow past u32 in any
    // realistic session.
    const targetNum = Number(target) || 0;
    const amount = parseInt(amountEl.value, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Amount must be > 0."; }
        return;
    }
    if (!ws || ws.readyState !== 1) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Not connected."; }
        return;
    }
    ws.send(buildActionMessage(encodeGrantUbiAction(targetNum, amount)));
    if (fb) {
        fb.style.color = "#cfe9aa";
        fb.textContent = targetNum === 0
            ? ("Wiring " + amount + " coins to every farmer…")
            : ("Wiring " + amount + " coins…");
    }
}
document.getElementById("ubi-send").addEventListener("click", () => sendUbi());

// Task composer -----------------------------------------------------------
function sendTask() {
    const toneEl = document.getElementById("task-tone");
    const kindEl = document.getElementById("task-kind");
    const targetEl = document.getElementById("task-target");
    const rewardEl = document.getElementById("task-reward");
    const msgEl = document.getElementById("task-message");
    const fb = document.getElementById("task-feedback");
    if (!toneEl || !kindEl || !targetEl || !rewardEl || !msgEl) return;
    const message = msgEl.value.trim();
    if (!message) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Write a brief first."; }
        return;
    }
    const target = parseInt(targetEl.value, 10);
    const reward = parseInt(rewardEl.value, 10);
    if (!Number.isFinite(target) || target <= 0) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Target must be > 0."; }
        return;
    }
    if (!Number.isFinite(reward) || reward <= 0) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Reward must be > 0."; }
        return;
    }
    if (!ws || ws.readyState !== 1) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Not connected."; }
        return;
    }
    const tone = parseInt(toneEl.value, 10) || 0;
    const kind = parseInt(kindEl.value, 10) || 0;
    ws.send(buildActionMessage(encodeIssueTaskAction(tone, message, kind, target, reward)));
    if (fb) { fb.style.color = "#ffd966"; fb.textContent = "Issuing task…"; }
    msgEl.value = "";
}
document.getElementById("task-send").addEventListener("click", sendTask);
document.getElementById("task-message").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendTask();
    }
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const plant = document.getElementById("plant-menu");
        if (plant && plant.style.display === "flex") { closePlantMenu(); return; }
        const prop = document.getElementById("property-menu");
        if (prop && prop.style.display === "flex") { closePropertyMenu(); return; }
        const dash = document.getElementById("monarch-dashboard");
        if (dash && dash.style.display === "flex") { closeMonarchDashboard(); return; }
        const pol = document.getElementById("politics-menu");
        if (pol && pol.style.display === "flex") { closePoliticsMenu(); return; }
        const wardrobe = document.getElementById("wardrobe-modal");
        if (wardrobe && wardrobe.style.display === "flex") { closeWardrobe(); return; }
    }
});

rebuildToolbar();

async function init(serverUrl) {
    updateStatus("Loading...");
    initRenderer();
    connectWebSocket(serverUrl);
    requestAnimationFrame(gameLoop);
}

// ──────────────────────────────────────────────────────────────────────
// Distant Horizons + Shaders look
// ──────────────────────────────────────────────────────────────────────
// Three pieces work together to imitate the Minecraft "Distant Horizons
// + Shaders" aesthetic in plain Three.js without real volumetric clouds
// or per-pixel LOD streaming:
//
//   1. A large sky-dome sphere with a custom shader: three-band gradient
//      from below-horizon → horizon → zenith, a sun disc + halo, and
//      animated fBM cloud noise projected onto a virtual plane above
//      the camera. The dome follows the camera each frame so it appears
//      infinite.
//   2. A low-poly ring of procedurally elevated hills that surrounds
//      the voxel terrain. Coloured to blend from green near the playable
//      area to atmospheric blue at the far edge, and faded into the fog
//      so the seam is invisible.
//   3. ACES tone mapping + a tuned FogExp2 colour that matches the
//      sky-dome's horizon band — the two cross-fade smoothly.
//
// The look is updated each frame via `updateSky(dt)` from the game loop,
// which advances the cloud-time uniform and re-centres the dome.
const SKY_TOP_COLOR     = new THREE.Color(0x6a98c8);
const SKY_HORIZON_COLOR = new THREE.Color(0xd6c8b0);
const SKY_GROUND_COLOR  = new THREE.Color(0xb89870);
const SUN_DIRECTION     = new THREE.Vector3(0.55, 0.70, 0.45).normalize();
const SUN_COLOR_SHADER  = new THREE.Color(0xfff0d2);

let skyMaterial = null;
let skyDomeMesh = null;
let cloudTime   = 0;

function buildSkyDome() {
    const geo = new THREE.SphereGeometry(2200, 32, 16);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            topColor:     { value: SKY_TOP_COLOR },
            horizonColor: { value: SKY_HORIZON_COLOR },
            groundColor:  { value: SKY_GROUND_COLOR },
            sunDir:       { value: SUN_DIRECTION.clone() },
            sunColor:     { value: SUN_COLOR_SHADER },
            time:         { value: 0 },
        },
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vDir = normalize(worldPos.xyz - cameraPosition);
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            varying vec3 vDir;
            uniform vec3 topColor;
            uniform vec3 horizonColor;
            uniform vec3 groundColor;
            uniform vec3 sunDir;
            uniform vec3 sunColor;
            uniform float time;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f*f*(3.0-2.0*f);
                return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                           mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
            }
            float fbm(vec2 p) {
                float v = 0.0, a = 0.5;
                for (int i = 0; i < 5; i++) {
                    v += a * noise(p);
                    p *= 2.05; a *= 0.5;
                }
                return v;
            }

            void main() {
                vec3 d = normalize(vDir);
                float h = d.y;

                // 3-band gradient: below-horizon ground tint → horizon
                // band → zenith blue.
                vec3 sky = mix(horizonColor, topColor, pow(max(h, 0.0), 0.5));
                sky = mix(groundColor, sky, smoothstep(-0.10, 0.10, h));

                // Sun disc + halo.
                vec3 sd = normalize(sunDir);
                float sunDot = max(dot(d, sd), 0.0);
                float sunDisc = smoothstep(0.997, 0.9995, sunDot);
                float sunHalo = pow(sunDot, 7.0) * 0.35
                              + pow(sunDot, 96.0) * 0.55;
                sky += sunColor * (sunDisc * 2.2 + sunHalo);

                // fBM clouds projected onto a virtual plane above the
                // camera. Skip below-horizon, fade smoothly near it.
                if (h > 0.0) {
                    vec2 uv = d.xz / (h + 0.42);
                    uv *= 1.55;
                    uv += vec2(time * 0.011, time * 0.006);
                    float c1 = fbm(uv);
                    float c2 = fbm(uv * 2.1 + 7.0);
                    float clouds = smoothstep(0.50, 0.85, c1 * 0.65 + c2 * 0.35);
                    clouds *= smoothstep(0.02, 0.30, h);
                    // Brighten cloud edges facing the sun, darken the
                    // shadowed underside ever so slightly.
                    float sunSide = clamp(
                        dot(normalize(vec3(d.x, 0.0, d.z)),
                            normalize(vec3(sd.x, 0.0, sd.z))) * 0.5 + 0.5,
                        0.0, 1.0
                    );
                    vec3 cloudColor = mix(
                        vec3(0.78, 0.80, 0.86),
                        vec3(1.00, 0.98, 0.92),
                        sunSide
                    );
                    sky = mix(sky, cloudColor, clouds * 0.95);
                }

                gl_FragColor = vec4(sky, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
    skyMaterial = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    return mesh;
}

function buildDistantHorizon() {
    // Low-poly ring of procedural hills surrounding the voxel terrain.
    // Centre is the voxel-terrain centre; inner radius is sunk well
    // below the playable surface so the seam hides inside the voxels.
    const SIZE    = 3200;
    const SEG     = 110;
    const INNER_R = 240; // beyond voxel terrain reach (≈226)
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const nearColor = new THREE.Color(0x4d7a36);
    const farColor  = new THREE.Color(0xa8c4dc);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.sqrt(x * x + z * z);
        if (r < INNER_R) {
            // Push deep below the voxel terrain so this part never peeks
            // through. Colour is irrelevant — never visible.
            pos.setY(i, -80);
            colors[i * 3]     = 0.2;
            colors[i * 3 + 1] = 0.4;
            colors[i * 3 + 2] = 0.2;
            continue;
        }
        // Multi-octave sine noise so hills feel organic without an FBM
        // texture lookup.
        const n1 = Math.sin(x * 0.0078) * Math.cos(z * 0.0091);
        const n2 = Math.sin(x * 0.027 + 1.7) * Math.sin(z * 0.022 - 0.6);
        const n3 = Math.sin(x * 0.061 + 2.5) * Math.cos(z * 0.054 + 0.2);
        // Rolling hills grow taller further out so they break the
        // horizon line visibly.
        const baseElev = (r - INNER_R) * 0.05;
        const elev = n1 * 26 + n2 * 12 + n3 * 5 + Math.min(50, baseElev);
        pos.setY(i, elev);
        // Atmospheric blue blend by distance.
        const t = Math.min(1.0, (r - INNER_R) / (SIZE * 0.4));
        const c = nearColor.clone().lerp(farColor, t * 0.85);
        colors[i * 3]     = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: true,
        fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Centre on the voxel-terrain centre. Slightly below voxel base so
    // we tuck under the seam.
    mesh.position.set(160, 2, 160);
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
}

function updateSky(dt) {
    cloudTime += dt;
    if (skyMaterial) skyMaterial.uniforms.time.value = cloudTime;
    if (skyDomeMesh && camera) {
        skyDomeMesh.position.copy(camera.position);
    }
}

// ── First-person controls ────────────────────────────────────────────
// Minecraft-style. The camera sits at the player's eye height,
// rotates with the mouse (pointer-locked), and moves with WASD in
// camera-local space. The own-avatar mesh is hidden client-side —
// other players still see the full body, only YOU see the floating
// hand+tool viewmodel attached to the camera.
const PLAYER_EYE_HEIGHT = 1.6;          // metres above the player's foot

const fp = {
    yaw:   0,                            // around Y (left-right), radians
    pitch: 0,                            // around X (up-down), radians
    pointerLocked: false,
    lastUnlockMs: 0,                     // when we last lost lock (cooldown guard)
    sensitivity: 0.0022,                 // radians per pixel of mouse motion
    pitchLimit: Math.PI * 0.48,          // ~ ±86°, just under straight up/down
    lastSentYaw: 0,                      // for sendInput throttling
    // Viewmodel hand+tool — built lazily once the renderer exists.
    viewmodel: null,
    swing: 0,                            // 0..1 anim phase for tool swing
    swingActive: false,
    // Camera mode. First-person (default) shows the viewmodel hand;
    // third-person pulls the camera back over the shoulder so you see
    // your whole avatar — better for multiplayer presence + the hunt.
    thirdPerson: false,
    camDist: 4.2,                        // metres behind the avatar
    camHeight: 1.4,                      // pivot height above the feet
};

const _tpPivot = new THREE.Vector3();
const _tpFwd = new THREE.Vector3();

function buildViewmodel() {
    // A small forearm + hand + tool attached as a child of the camera.
    // Lives in front of and below the eye so it reads as "your arm"
    // without obscuring the centre of the screen.
    const group = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0d0a8, roughness: 0.7 });
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x5588bb, roughness: 0.8 });

    // Sleeve / forearm
    const sleeve = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.05, 0.20, 4, 6),
        sleeveMat,
    );
    sleeve.position.set(0.0, -0.10, -0.05);
    sleeve.rotation.z = 0.2;
    group.add(sleeve);

    // Hand
    const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 6),
        skinMat,
    );
    hand.position.set(0.04, -0.22, -0.18);
    group.add(hand);

    // Held tool — a small bound subgroup we can replace contents on
    // when selectedAction changes.
    const tool = new THREE.Group();
    tool.name = "tool";
    tool.position.set(0.07, -0.20, -0.30);
    group.add(tool);

    // Default tool: a wooden stick. rebuildViewmodelTool() will swap
    // it out as the player picks new actions.
    const stickGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.30, 6);
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 0.9 });
    const stick = new THREE.Mesh(stickGeo, stickMat);
    stick.rotation.x = Math.PI / 2;
    tool.add(stick);

    // Position the whole arm in the camera's lower-right. Tweaked so
    // it reads as "yours" without intruding on the action point.
    group.position.set(0.30, -0.30, -0.40);
    group.rotation.set(-0.1, 0.18, 0.0);
    group.renderOrder = 100;   // draw after world; mostly cosmetic
    // The viewmodel should be lit by the scene but never cast shadows
    // (it sits in front of everything anyway).
    group.traverse(o => { if (o.isMesh) o.castShadow = false; });

    return group;
}

/**
 * Swap the held-tool subtree to match `selectedAction`. Kept cheap:
 * just rebuild the tool group's contents.
 */
function rebuildViewmodelTool() {
    if (!fp.viewmodel) return;
    const tool = fp.viewmodel.getObjectByName("tool");
    if (!tool) return;
    while (tool.children.length) tool.remove(tool.children[0]);

    const woodMat   = new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 0.9 });
    const metalMat  = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7 });
    const seedMat   = new THREE.MeshStandardMaterial({ color: 0xc8a266, roughness: 0.85 });
    const waterMat  = new THREE.MeshStandardMaterial({
        color: 0x4a8acc, roughness: 0.2, metalness: 0.1,
        transparent: true, opacity: 0.7,
    });
    const droneMat  = new THREE.MeshStandardMaterial({
        color: 0x3a4a6a, roughness: 0.4, metalness: 0.6,
        emissive: 0x224477, emissiveIntensity: 0.4,
    });

    const a = selectedAction || "";
    if (a === "harvest" || a === "cut-tree") {
        // Hand axe — stout shaft + metallic head.
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.014, 0.30, 6), woodMat,
        );
        shaft.rotation.x = Math.PI / 2;
        tool.add(shaft);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.03), metalMat);
        head.position.set(0.05, 0, -0.12);
        tool.add(head);
    } else if (a === "water") {
        // Watering can — small can body + spout.
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8), metalMat);
        can.position.set(0, -0.02, -0.10);
        tool.add(can);
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.13, 6), metalMat);
        spout.position.set(0.08, -0.02, -0.16);
        spout.rotation.z = -0.6;
        tool.add(spout);
        // Water droplet at the tip
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), waterMat);
        drop.position.set(0.14, -0.04, -0.20);
        drop.scale.y = 1.4;
        tool.add(drop);
    } else if (a && a.startsWith("plant-")) {
        // A handful of seeds — cupped palm + small clustered spheres.
        for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2;
            const seed = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), seedMat);
            seed.position.set(Math.cos(ang) * 0.02, 0, Math.sin(ang) * 0.02 - 0.05);
            seed.scale.y = 1.3;
            tool.add(seed);
        }
    } else if (a === "build-swale" || a === "build-hugel" || a === "build-hochsitz") {
        // Shovel — long shaft + flat metallic blade.
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.011, 0.013, 0.40, 6), woodMat,
        );
        shaft.rotation.x = Math.PI / 2;
        tool.add(shaft);
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.10, 0.16, 0.015), metalMat,
        );
        blade.position.set(0, 0, -0.24);
        tool.add(blade);
    } else if (a === "hunt") {
        // Short bow — arc + string suggestion.
        const bow = new THREE.Mesh(
            new THREE.TorusGeometry(0.13, 0.012, 5, 12, Math.PI), woodMat,
        );
        bow.rotation.y = -Math.PI / 2;
        bow.position.set(0, 0, -0.05);
        tool.add(bow);
    } else if (a === "deploy-ai") {
        // Small drone egg — boxy chassis with a glowing sensor strip.
        const drone = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.10), droneMat);
        drone.position.set(0, 0, -0.10);
        tool.add(drone);
    } else {
        // Default empty hand — short stick prop so the hand reads.
        const stick = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.014, 0.30, 6), woodMat,
        );
        stick.rotation.x = Math.PI / 2;
        tool.add(stick);
    }
}

/**
 * Trigger the tool swing animation. Called on every action click.
 */
function triggerToolSwing() {
    fp.swing = 0;
    fp.swingActive = true;
}

function updateFirstPerson(dt) {
    // If the held tool changed (player picked a different action),
    // rebuild the viewmodel's tool subgroup. Cheap: it only swaps a
    // handful of meshes.
    if (fp._lastAction !== selectedAction) {
        fp._lastAction = selectedAction;
        rebuildViewmodelTool();
    }

    // Track the player's interpolated position so the camera glides
    // smoothly with movement updates from the server.
    const playerObj = myEntityId && entityMeshes.get(myEntityId);

    if (fp.thirdPerson && playerObj) {
        // Third-person: orbit the camera behind + above the avatar and
        // look at a chest-height pivot. The avatar is turned to face the
        // look direction so you see your whole body stride about. The
        // viewmodel hand is hidden (it'd float in front of the camera).
        playerObj.visible = true;
        playerObj.rotation.y = fp.yaw;          // face where we look
        if (fp.viewmodel) fp.viewmodel.visible = false;

        // Forward unit vector from yaw+pitch (three.js camera looks -Z).
        const cp = Math.cos(fp.pitch);
        _tpFwd.set(-Math.sin(fp.yaw) * cp, Math.sin(fp.pitch), -Math.cos(fp.yaw) * cp);
        _tpPivot.set(
            playerObj.position.x,
            playerObj.position.y + fp.camHeight,
            playerObj.position.z,
        );
        camera.position.set(
            _tpPivot.x - _tpFwd.x * fp.camDist,
            _tpPivot.y - _tpFwd.y * fp.camDist,
            _tpPivot.z - _tpFwd.z * fp.camDist,
        );
        // Don't let the camera sink underground on steep down-pitch.
        if (camera.position.y < playerObj.position.y + 0.4) {
            camera.position.y = playerObj.position.y + 0.4;
        }
        camera.rotation.order = "YXZ";
        camera.lookAt(_tpPivot);
    } else {
        // First-person: eye at the avatar, viewmodel hand visible, own
        // body hidden so it doesn't clip the near plane.
        if (playerObj) {
            playerObj.visible = false;
            camera.position.set(
                playerObj.position.x,
                playerObj.position.y + PLAYER_EYE_HEIGHT,
                playerObj.position.z,
            );
        }
        if (fp.viewmodel) fp.viewmodel.visible = true;
        // Orient camera from yaw + pitch. Order matters: yaw first
        // (around Y), then pitch (around the camera's local X).
        camera.rotation.order = "YXZ";
        camera.rotation.set(fp.pitch, fp.yaw, 0);
    }

    // Tool swing — ~0.35 s in, ~0.25 s out. Maps to a forward thrust
    // + slight downward pitch of the viewmodel group.
    if (fp.swingActive) {
        fp.swing += dt / 0.55;
        if (fp.swing >= 1) {
            fp.swing = 0;
            fp.swingActive = false;
        }
    }
    if (fp.viewmodel) {
        const s = fp.swingActive ? Math.sin(fp.swing * Math.PI) : 0;
        fp.viewmodel.position.set(
            0.30,
            -0.30 - s * 0.06,
            -0.40 - s * 0.18,
        );
        fp.viewmodel.rotation.x = -0.1 - s * 0.55;
    }
}

// ── Water shader ─────────────────────────────────────────────────────
// Replaces the static MeshStandardMaterial we used to render each
// water voxel-tile with an animated ShaderMaterial:
//   - vertex displacement (two-octave sine + slow swell) → real ripples
//   - per-fragment normal perturbation (fBM-like cross-noise) → glints
//   - depth-blended colour from shallow to deep
//   - Fresnel-style edge brightening so water reads as a surface, not a sheet
// The `time` uniform is updated each frame by updateWater() so every
// instance moves in sync. Materials are cached here so we don't end up
// with one program per tile.
const waterMaterials = [];
// Grass-tuft shader materials, animated each frame by updateGrass().
const grassMaterials = [];
function updateGrass(time) {
    for (const mat of grassMaterials) {
        if (mat && mat.uniforms && mat.uniforms.time) {
            mat.uniforms.time.value = time;
        }
    }
}

// Grass tufts that can burn away near fire. We keep the InstancedMesh +
// each tuft's base position & matrix so a fire pass can hide (zero-scale)
// tufts within range of a burning entity and restore them once the fire
// is gone. Reset whenever the terrain is rebuilt.
let grassTuftMesh = null;
let grassTuftData = null;            // { pos: [{x,z}], base: [Matrix4], hidden: [bool] }
const _zeroScaleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
let _grassFireTimer = 0;

// Throttled (~3 Hz from the game loop): hide grass tufts close to any
// burning entity, restore the rest. Cheap enough — a few thousand tufts
// against a capped list of fire sources.
function updateGrassFire(dt) {
    _grassFireTimer += dt;
    if (_grassFireTimer < 0.33) return;
    _grassFireTimer = 0;
    if (!grassTuftMesh || !grassTuftData) return;

    // Collect up to N burning-entity positions (flameEntities is the
    // client's set of entities currently rendering a flame effect).
    const fires = [];
    for (const eid of flameEntities.keys()) {
        const obj = entityMeshes.get(eid);
        if (obj) { fires.push(obj.position); if (fires.length >= 80) break; }
    }

    const data = grassTuftData;
    const R2 = 9.0;                  // burn radius² (3 m)
    let changed = false;
    for (let i = 0; i < data.pos.length; i++) {
        const p = data.pos[i];
        let near = false;
        for (let f = 0; f < fires.length; f++) {
            const dx = fires[f].x - p.x, dz = fires[f].z - p.z;
            if (dx * dx + dz * dz < R2) { near = true; break; }
        }
        if (near && !data.hidden[i]) {
            grassTuftMesh.setMatrixAt(i, _zeroScaleMatrix);
            data.hidden[i] = true; changed = true;
        } else if (!near && data.hidden[i]) {
            grassTuftMesh.setMatrixAt(i, data.base[i]);
            data.hidden[i] = false; changed = true;
        }
    }
    if (changed) grassTuftMesh.instanceMatrix.needsUpdate = true;
}

function buildWaterMaterial({ shallow, deep, opacity }) {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
            time:    { value: 0 },
            shallow: { value: shallow },
            deep:    { value: deep },
            opacity: { value: opacity },
            sunDir:  { value: SUN_DIRECTION.clone() },
        },
        vertexShader: `
            varying vec3 vWorldPos;
            varying vec3 vViewDir;
            varying vec2 vUv;
            uniform float time;

            // Two-octave wave displacement for organic surface motion.
            float wave(vec2 p, float t) {
                return sin(p.x * 1.3 + t * 1.2) * 0.04
                     + sin(p.y * 1.7 - t * 0.9) * 0.04
                     + sin((p.x + p.y) * 0.8 + t * 0.5) * 0.025;
            }

            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                worldPos.y += wave(worldPos.xz, time);
                vWorldPos = worldPos.xyz;
                vViewDir = normalize(worldPos.xyz - cameraPosition);
                vUv = uv;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            varying vec3 vWorldPos;
            varying vec3 vViewDir;
            varying vec2 vUv;
            uniform vec3 shallow;
            uniform vec3 deep;
            uniform float opacity;
            uniform float time;
            uniform vec3 sunDir;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f*f*(3.0-2.0*f);
                return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                           mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
            }

            void main() {
                vec3 v = -normalize(vViewDir);

                // Faux normal from gradient of moving noise — gives the
                // characteristic glitter without sampling a normal map.
                vec2 q = vWorldPos.xz * 1.2 + vec2(time * 0.12, time * 0.07);
                float nA = noise(q);
                float nB = noise(q + vec2(0.15, 0.0));
                float nC = noise(q + vec2(0.0, 0.15));
                vec3 nrm = normalize(vec3(nA - nB, 1.0, nA - nC) * vec3(2.5, 1.0, 2.5));

                // Diffuse against the sun + ambient sky tint.
                float lambert = max(dot(nrm, normalize(sunDir)), 0.0);
                vec3 baseColor = mix(deep, shallow, smoothstep(0.0, 1.0, vUv.y * 0.6 + nA * 0.6));
                vec3 lit = baseColor * (0.55 + 0.45 * lambert);

                // Sun glint — sharper than diffuse for sparkle.
                vec3 halfDir = normalize(normalize(sunDir) + v);
                float spec = pow(max(dot(nrm, halfDir), 0.0), 80.0);
                lit += vec3(1.0, 0.97, 0.88) * spec * 0.8;

                // Fresnel: brighter at glancing view angles.
                float fres = pow(1.0 - max(dot(nrm, v), 0.0), 3.0);
                lit = mix(lit, vec3(0.85, 0.92, 1.0), fres * 0.18);

                gl_FragColor = vec4(lit, opacity);
            }
        `,
    });
}

function initRenderer() {
    scene = new THREE.Scene();

    // Fog matches the sky-dome horizon band so distant geometry
    // dissolves into the dome cleanly. Slightly cooler tint than the
    // horizon colour gives the scene a touch of aerial-perspective blue.
    scene.background = new THREE.Color(0xc4d4e2);
    scene.fog = new THREE.FogExp2(0xc4d4e2, 0.0014);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(160, 80, 160);
    camera.lookAt(160, 0, 160);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    document.body.appendChild(renderer.domElement);

    // First-person: no OrbitControls. The camera rides at the
    // player's eye height, driven by mouse-look + WASD. We still
    // keep the `controls` variable around as a stub so the rest of
    // the codebase's `controls.update()` calls don't NPE — they
    // become no-ops.
    controls = { update() {}, target: new THREE.Vector3(), enabled: false };

    // Camera must be added to the scene so its child meshes (the
    // viewmodel hand) render. Three.js doesn't require this for the
    // camera itself, but child meshes won't update otherwise.
    scene.add(camera);
    fp.viewmodel = buildViewmodel();
    camera.add(fp.viewmodel);

    // Helper: is any modal open right now? While a menu is up we
    // suppress drag-look so menu interaction isn't hijacked.
    function anyModalOpen() {
        const ids = [
            "plant-menu", "property-menu", "monarch-dashboard",
            "politics-menu", "world-nav-overlay", "wardrobe-modal",
        ];
        for (const id of ids) {
            const m = document.getElementById(id);
            if (m && getComputedStyle(m).display !== "none") return true;
        }
        return false;
    }

    // ── Drag-to-look camera (best practice for web 3D sims) ──────────
    // No pointer lock. The OS cursor is never hidden or trapped, so
    // there's nothing to "escape" from. Standard scheme used by
    // Sketchfab, three.js examples, most browser games:
    //   • Press + drag on the world  → look around.
    //   • Quick click (no drag)       → perform the selected action at
    //                                    the clicked point.
    //   • WASD                        → move relative to facing.
    // Pointer capture keeps the drag alive even if the cursor leaves
    // the window, and `pointercancel`/`pointerup` always release it,
    // so the camera can never get "stuck".
    const look = { dragging: false, moved: 0, downTime: 0, pointerId: null,
                   downX: 0, downY: 0 };
    renderer.domElement.style.cursor = "grab";

    renderer.domElement.addEventListener("pointerdown", (e) => {
        if (anyModalOpen()) return;
        if (e.button !== 0) return;          // left button only
        look.dragging = true;
        look.moved = 0;
        look.downTime = performance.now();
        look.downX = e.clientX;
        look.downY = e.clientY;
        look.pointerId = e.pointerId;
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
        renderer.domElement.style.cursor = "grabbing";
    });

    function endDrag(e) {
        if (!look.dragging) return;
        look.dragging = false;
        renderer.domElement.style.cursor = "grab";
        try { renderer.domElement.releasePointerCapture(look.pointerId); } catch (_) {}
        // A short press that barely moved = a click → fire the action
        // at the point the player clicked (raycast from cursor coords).
        const dt = performance.now() - look.downTime;
        if (look.moved < 6 && dt < 400) {
            onWorldClick({ clientX: look.downX, clientY: look.downY });
        }
    }
    renderer.domElement.addEventListener("pointerup", endDrag);
    renderer.domElement.addEventListener("pointercancel", endDrag);

    renderer.domElement.addEventListener("pointermove", (e) => {
        if (!look.dragging) return;
        // Clamp per-event deltas so a sudden large jump can't snap the
        // view violently.
        const dx = Math.max(-120, Math.min(120, e.movementX || 0));
        const dy = Math.max(-120, Math.min(120, e.movementY || 0));
        look.moved += Math.abs(dx) + Math.abs(dy);
        fp.yaw   -= dx * fp.sensitivity;
        fp.pitch -= dy * fp.sensitivity;
        if (fp.pitch >  fp.pitchLimit) fp.pitch =  fp.pitchLimit;
        if (fp.pitch < -fp.pitchLimit) fp.pitch = -fp.pitchLimit;
    });

    // Subtle persistent control hint.
    const hint = document.createElement("div");
    hint.id = "fp-hint";
    hint.textContent = "Drag to look · WASD to move · Click to act";
    hint.style.cssText = [
        "position:fixed", "bottom:14px", "left:50%",
        "transform:translateX(-50%)",
        "padding:4px 12px",
        "background:rgba(0,0,0,0.5)",
        "color:#dde",
        "border:1px solid rgba(180,200,220,0.25)",
        "border-radius:6px",
        "font:11px system-ui, sans-serif",
        "letter-spacing:0.5px",
        "pointer-events:none",
        "z-index:201",
        "opacity:0.7",
    ].join(";");
    document.body.appendChild(hint);

    // Sky dome + distant horizon ring + cloud animation.
    skyDomeMesh = buildSkyDome();
    scene.add(skyDomeMesh);
    scene.add(buildDistantHorizon());

    // Golden hour sun
    const sun = new THREE.DirectionalLight(0xffeacc, 2.0);
    sun.position.set(200, 250, 150);
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
    scene.add(new THREE.AmbientLight(0x708090, 0.55));
    scene.add(new THREE.HemisphereLight(0xa8c8ea, 0x667744, 0.7));

    // Warm fill from the side for depth
    const fill = new THREE.DirectionalLight(0xffddbb, 0.4);
    fill.position.set(-100, 120, -80);
    scene.add(fill);

    // Subtle backlight rim for atmosphere
    const rim = new THREE.DirectionalLight(0xccddff, 0.25);
    rim.position.set(-50, 200, -200);
    scene.add(rim);

    // NOTE: world-click actions are dispatched from the drag-to-look
    // `endDrag` handler above (a short press that didn't drag), NOT a
    // raw "click" listener — otherwise a look-drag would also fire an
    // action when it ended.

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// --- Bincode v2 reader (standard config, variable-length integers) ---

// Bincode codec primitives (BincodeReader, encode* helpers,
// buildFramedMessage) live in ./net/codec.js — imported at the top.

// `traveling` is the trailing bool: true when this hello is a
// Travel-to-Region reconnect from a player already in the world
// (server then restores persistent state minus TRAVEL_COST coins).
function buildHelloMessage(name, gameMode, regionIndex, plotSeed, playerRole, traveling) {
    const payload = new Uint8Array([
        ...encodeBincodeString(name),
        ...encodeBincodeString("dev-token"),
        ...encodeVarint(1),
        gameMode,
        regionIndex,
        ...encodeVarint(plotSeed),
        playerRole & 0xff,
        traveling ? 1 : 0,
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

// seq → action variant tag, kept around long enough for the matching
// ServerActionResult to land. Used to bump local task progress
// optimistically without having to parse the success message.
const pendingActionVariant = new Map();

function buildActionMessage(actionKind) {
    inputSeq++;
    const seqBytes = encodeVarint(inputSeq);
    const payload = new Uint8Array([...seqBytes, ...actionKind]);
    // The variant tag is the first byte of actionKind for variants < 251.
    if (actionKind.length > 0) {
        pendingActionVariant.set(inputSeq, actionKind[0]);
        // Bound the map so it doesn't grow forever if the server drops a result.
        if (pendingActionVariant.size > 256) {
            const oldest = pendingActionVariant.keys().next().value;
            pendingActionVariant.delete(oldest);
        }
    }
    return buildFramedMessage(0x0003, payload);
}

// Mapping from ActionKind variant → task-kind discriminant. Mirrors
// the server's action_matches_task. -1 means the action doesn't count
// toward any task.
function taskKindForVariant(variant) {
    switch (variant) {
        case 0:  return 0; // PlantSeed → Plant
        case 1:  return 1; // Harvest → Harvest
        case 11: return 2; // CutTree → CutTree
        case 13: return 3; // HuntAnimal → Hunt
        default: return -1;
    }
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
        // Fresh connect from the splash screen — no travel charge.
        ws.send(buildHelloMessage(playerName, selectedGameMode, selectedRegion, selectedPlotSeed, selectedRole, false));
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
        case 0x0103: handleEntitySpawn(payload); break;
        case 0x0104: handleEntityDespawn(payload); break;
        case 0x010B: break; // pong
        case 0x010C: handleActionResult(payload); break;
        case 0x0106: handlePlayerState(payload); break;
        case 0x010E: handleMonarchSurveillance(payload); break;
        case 0x010F: handleStateBroadcast(payload); break;
        case 0x0110: handleTaskBroadcast(payload); break;
        case 0x0111: handleTaskComplete(payload); break;
        case 0x0112: handleRoleChanged(payload); break;
        case 0x0113: handleAiTakeover(payload); break;
        case 0x0114: handlePoliticsUpdate(payload); break;
        case 0x0115: handleCatastrophe(payload); break;
        default:
            console.log("Unknown msg 0x" + msgType.toString(16), payloadLen, "bytes");
    }
}

// --- Global catastrophe banner -------------------------------------------
// Decodes ServerCatastrophe and drives a persistent top-of-screen banner
// while a catastrophe is active. The colour + icon vary by kind; the
// banner also tells Innovators which Breakthrough resolves it.
const CATASTROPHE_INFO = {
    1: { icon: "🦠", name: "Pandemic",    color: "#7a3a8a", fix: "Vaccine" },
    2: { icon: "☀️", name: "Solar Flare", color: "#c88a1a", fix: "Solar Shield" },
    3: { icon: "🏜️", name: "Drought",     color: "#a8762a", fix: "Drought-resistant Seeds" },
    4: { icon: "☢️", name: "Nuclear",     color: "#3a7a3a", fix: "Decontamination" },
    5: { icon: "☄️", name: "Asteroid",    color: "#8a3a2a", fix: "Deflector" },
};

function handleCatastrophe(payload) {
    const r = new BincodeReader(payload);
    const kind = r.readU8();
    const intensity = r.readF32();
    const ticksRemaining = r.readU32();
    const message = r.readString();
    activeCatastrophe = { kind, intensity, ticksRemaining, message };
    renderCatastropheBanner();
    // The Deploy Breakthrough button readiness depends on the active
    // catastrophe, so refresh the Innovator HUD too.
    refreshInnovatorHud();
}

function renderCatastropheBanner() {
    let banner = document.getElementById("catastrophe-banner");
    if (activeCatastrophe.kind === 0) {
        if (banner) banner.style.display = "none";
        return;
    }
    const info = CATASTROPHE_INFO[activeCatastrophe.kind] || {
        icon: "⚠️", name: "Catastrophe", color: "#888", fix: "?",
    };
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "catastrophe-banner";
        banner.style.cssText = [
            "position:fixed", "top:0", "left:50%", "transform:translateX(-50%)",
            "padding:8px 22px", "z-index:205", "pointer-events:none",
            "font:13px system-ui, sans-serif", "font-weight:bold",
            "border-radius:0 0 10px 10px", "text-align:center",
            "box-shadow:0 3px 14px rgba(0,0,0,0.5)", "min-width:340px",
        ].join(";");
        document.body.appendChild(banner);
    }
    banner.style.display = "block";
    banner.style.background = info.color;
    banner.style.color = "#fff";
    const pct = Math.round(activeCatastrophe.intensity);
    const secs = Math.ceil(activeCatastrophe.ticksRemaining / 20);
    // Innovators get an actionable hint; everyone else gets the warning.
    const hint = (playerRoleLive === 2)
        ? "<div style='font-size:10px; font-weight:normal; opacity:0.9; margin-top:2px;'>Deploy a <b>" + info.fix + "</b> breakthrough to end it</div>"
        : "<div style='font-size:10px; font-weight:normal; opacity:0.9; margin-top:2px;'>An Innovator must intervene</div>";
    banner.innerHTML =
        "<div>" + info.icon + " " + info.name.toUpperCase() +
        " — intensity " + pct + "% · ~" + secs + "s left</div>" + hint;
}

// --- Politics state cache ------------------------------------------------
// Populated by ServerPoliticsUpdate at 1 Hz. Drives the politics modal
// and the per-Monarch revolt buttons.
let politicsState = { tick: 0, monarchs: [] };
// Track which Monarchs this client has already revolted against, so we
// can hide the Revolt button after a successful vote (server enforces
// the constraint too).
const revoltedAgainst = new Set();

function handlePoliticsUpdate(payload) {
    const r = new BincodeReader(payload);
    const tick = r.readU64();
    const count = r.readVarint();
    const monarchs = [];
    for (let i = 0; i < count; i++) {
        const player_id = r.readU64();
        const player_name = r.readString();
        const discontent = r.readF32();
        const ai_intelligence = r.readF32();
        const deployments = r.readU32();
        const jobs_cut = r.readU32();
        monarchs.push({
            player_id, player_name, discontent, ai_intelligence,
            deployments, jobs_cut,
        });
    }
    politicsState = { tick, monarchs };
    // Refresh both panels live if they're open.
    const m = document.getElementById("politics-menu");
    if (m && m.style.display === "flex") {
        renderPoliticsModal();
    }
    const dash = document.getElementById("monarch-dashboard");
    if (dash && dash.style.display === "flex") {
        renderMonarchDashboard();
    }
}

function handleRoleChanged(payload) {
    const r = new BincodeReader(payload);
    const player_id = r.readU64();
    const player_name = r.readString();
    const new_role = r.readU8();
    const reason = r.readVarint(); // RoleChangeReason enum tag
    const reasonStr = reason === 0 ? "ascended"
                    : reason === 1 ? "overthrown"
                    : reason === 2 ? "replaced by AI"
                    : "changed";

    if (player_id === myPlayerId) {
        // It's *me*. Flip role, rebuild toolbar, push a personal banner.
        playerRoleLive = new_role;
        // If I just ascended, forget any old revolt history (fresh slate
        // as a Monarch; but the server is authoritative).
        if (new_role === 1) {
            revoltedAgainst.clear();
        }
        rebuildToolbar();
        renderHudRole();
        showRoleBanner(new_role, reason, player_name);
    } else {
        // Someone else's role flipped. Chat line + optional banner if
        // they were overthrown/AI-replaced (dramatic enough to deserve
        // global notice).
        const verb = new_role === 1 ? "ascended to Tech Monarch"
                                    : "fell to Farmer (" + reasonStr + ")";
        appendStateChatLine("STATE", new_role === 1 ? 0 : 2, player_name + " " + verb);
        // Clear our memory of having revolted against this player if
        // they're no longer a Monarch — if they come back, we can vote
        // again.
        if (new_role === 0) {
            revoltedAgainst.delete(player_id);
        }
    }
    // Always refresh the politics modal if it's open.
    const m = document.getElementById("politics-menu");
    if (m && m.style.display === "flex") {
        renderPoliticsModal();
    }
}

function handleAiTakeover(payload) {
    const r = new BincodeReader(payload);
    const former_monarch_id = r.readU64();
    const former_monarch_name = r.readString();
    const deployments = r.readU32();
    const jobs_cut = r.readU32();
    // Dramatic global banner. Distinct red/purple gradient so even
    // a player who skipped previous banners notices the era change.
    const banner = document.getElementById("state-banner");
    const title = document.getElementById("state-banner-title");
    const body = document.getElementById("state-banner-message");
    const sender = document.getElementById("state-banner-sender");
    if (banner && title && body && sender) {
        banner.style.background = "linear-gradient(180deg, rgba(180,40,140,0.96), rgba(60,10,80,0.96))";
        banner.style.borderBottom = "2px solid #ff6cdc";
        banner.style.color = "#ffe1f6";
        title.textContent = "⚙️ AI TAKEOVER";
        body.textContent = "The machines have replaced " + former_monarch_name;
        sender.textContent = deployments + " drones · " + jobs_cut + " jobs cut · the AI now rules";
        banner.style.display = "block";
        if (stateBannerHideTimer) clearTimeout(stateBannerHideTimer);
        stateBannerHideTimer = setTimeout(() => {
            banner.style.display = "none";
            stateBannerHideTimer = null;
        }, 10000);
    }
    // Chat archive.
    appendStateChatLine("⚙️ AI", 2,
        "AI takeover: " + former_monarch_name + " demoted (" +
        deployments + " drones, " + jobs_cut + " jobs cut)");
}

// Personal banner shown to the player whose role just changed.
function showRoleBanner(newRole, reason, name) {
    const banner = document.getElementById("state-banner");
    const title = document.getElementById("state-banner-title");
    const body = document.getElementById("state-banner-message");
    const sender = document.getElementById("state-banner-sender");
    if (!banner || !title || !body || !sender) return;
    let cfg, titleText, bodyText, senderText;
    if (newRole === 1) {
        cfg = PROP_TONES[1]; // Rally
        titleText = "ASCENDED";
        bodyText = "You are now a Tech Monarch.";
        senderText = "Use the dashboard to deploy AI, issue bounties, and pay UBI.";
    } else if (reason === 1) {
        // Overthrown
        cfg = PROP_TONES[2]; // Crisis
        titleText = "OVERTHROWN";
        bodyText = "The Farmers have demoted you.";
        senderText = "You are now a Farmer again.";
    } else if (reason === 2) {
        cfg = { bg: "linear-gradient(180deg, rgba(180,40,140,0.96), rgba(60,10,80,0.96))", border: "#ff6cdc", text: "#ffe1f6" };
        titleText = "REPLACED BY THE AI";
        bodyText = "Your fleet's intelligence exceeded you.";
        senderText = "You are now a Farmer again. The AI rules the world.";
    } else {
        cfg = PROP_TONES[0];
        titleText = "ROLE CHANGED";
        bodyText = name;
        senderText = "";
    }
    banner.style.background = cfg.bg;
    banner.style.borderBottom = "2px solid " + cfg.border;
    banner.style.color = cfg.text;
    title.textContent = titleText;
    body.textContent = bodyText;
    sender.textContent = senderText;
    banner.style.display = "block";
    if (stateBannerHideTimer) clearTimeout(stateBannerHideTimer);
    stateBannerHideTimer = setTimeout(() => {
        banner.style.display = "none";
        stateBannerHideTimer = null;
    }, 8000);
}

// --- Active Monarch tasks ------------------------------------------------
// Indexed by task_id. Each entry is { task_id, monarch_id, monarch_name,
// tone, message, task_kind, target, reward, my_progress, claimed }.
const activeTasks = new Map();

const TASK_KIND_LABEL = {
    0: { word: "Plant",   icon: "🌱" },
    1: { word: "Harvest", icon: "🍎" },
    2: { word: "Cut tree",icon: "🪓" },
    3: { word: "Hunt",    icon: "🏹" },
};

function bumpLocalTaskProgress(taskKind) {
    if (taskKind < 0) return;
    let touched = false;
    for (const t of activeTasks.values()) {
        if (t.claimed) continue;
        if (t.task_kind !== taskKind) continue;
        // The issuing Monarch can't claim their own bounty.
        if (t.monarch_id === myPlayerId) continue;
        t.my_progress = Math.min(t.target, (t.my_progress || 0) + 1);
        // We don't optimistically set `claimed` — wait for the server's
        // ServerTaskComplete to be authoritative (and to know which
        // player actually won).
        touched = true;
    }
    if (touched) renderTaskTray();
}

function handleTaskBroadcast(payload) {
    const r = new BincodeReader(payload);
    const task_id = r.readU32();
    const monarch_id = r.readU64();
    const monarch_name = r.readString();
    const tone = r.readU8();
    const message = r.readString();
    const task_kind = r.readU8();
    const target = r.readU32();
    const reward = r.readU32();
    activeTasks.set(task_id, {
        task_id, monarch_id, monarch_name, tone, message,
        task_kind, target, reward, my_progress: 0, claimed: false,
    });
    // Surface as a banner + chat entry — same visual language as a
    // state broadcast, plus the reward in the title.
    const cfg = PROP_TONES[tone] || PROP_TONES[0];
    const banner = document.getElementById("state-banner");
    const title = document.getElementById("state-banner-title");
    const body = document.getElementById("state-banner-message");
    const sender = document.getElementById("state-banner-sender");
    if (banner && title && body && sender) {
        const kindLabel = TASK_KIND_LABEL[task_kind] || { word: "Task", icon: "📝" };
        banner.style.background = cfg.bg;
        banner.style.borderBottom = "2px solid " + cfg.border;
        banner.style.color = cfg.text;
        title.textContent = "BOUNTY · " + kindLabel.word.toUpperCase() + " × " + target;
        body.textContent = message;
        sender.textContent = kindLabel.icon + " " + reward + " 🪙 per claimant · issued by " + monarch_name;
        banner.style.display = "block";
        if (stateBannerHideTimer) clearTimeout(stateBannerHideTimer);
        stateBannerHideTimer = setTimeout(() => {
            banner.style.display = "none";
            stateBannerHideTimer = null;
        }, 8000);
    }
    appendTaskChatLine(monarch_name, tone, task_kind, target, reward, message);
    renderTaskTray();
}

function handleTaskComplete(payload) {
    const r = new BincodeReader(payload);
    const task_id = r.readU32();
    const winner_id = r.readU64();
    const winner_name = r.readString();
    const reward = r.readU32();
    const monarch_id = r.readU64();
    const task = activeTasks.get(task_id);
    // Defunded sentinel: winner_id=0 + reward=0 means the issuing
    // Monarch couldn't cover a payout — the task is gone for everyone.
    if (winner_id === 0 && reward === 0) {
        activeTasks.delete(task_id);
        if (task) {
            appendStateChatLine(task.monarch_name, 2, "Task defunded: " + task.message);
        }
        renderTaskTray();
        return;
    }
    // Update my view of this task — if I was the winner, mark claimed
    // so I can't re-trigger optimistic progress. The task stays alive
    // for other farmers.
    if (task) {
        if (winner_id === myPlayerId) {
            task.claimed = true;
            task.my_progress = task.target;
        }
    }
    // Chat line + a brief banner for the winner.
    const monarchName = task ? task.monarch_name : "Tech Monarch";
    const message = winner_id === myPlayerId
        ? ("You earned " + reward + " 🪙 from " + monarchName + "!")
        : (winner_name + " claimed " + reward + " 🪙 from " + monarchName);
    appendStateChatLine(monarchName, 1, message);
    if (winner_id === myPlayerId) {
        const banner = document.getElementById("state-banner");
        const title = document.getElementById("state-banner-title");
        const body = document.getElementById("state-banner-message");
        const sender = document.getElementById("state-banner-sender");
        if (banner && title && body && sender) {
            const cfg = PROP_TONES[1];
            banner.style.background = cfg.bg;
            banner.style.borderBottom = "2px solid " + cfg.border;
            banner.style.color = cfg.text;
            title.textContent = "BOUNTY CLAIMED";
            body.textContent = "+" + reward + " 🪙 from " + monarchName;
            sender.textContent = "";
            banner.style.display = "block";
            if (stateBannerHideTimer) clearTimeout(stateBannerHideTimer);
            stateBannerHideTimer = setTimeout(() => {
                banner.style.display = "none";
                stateBannerHideTimer = null;
            }, 4000);
        }
    }
    renderTaskTray();
}

function appendTaskChatLine(monarchName, tone, taskKind, target, reward, message) {
    const chatLog = document.getElementById("chat-log");
    if (!chatLog) return;
    const cfg = PROP_TONES[tone] || PROP_TONES[0];
    const kindLabel = TASK_KIND_LABEL[taskKind] || { word: "Task", icon: "📝" };
    const line = document.createElement("div");
    line.style.cssText =
        "margin:2px 0; padding:3px 6px; border-left:3px solid " + cfg.border + ";" +
        "background:rgba(0,0,0,0.35); color:" + cfg.text + "; font-size:11px;";
    line.innerHTML =
        "<span style='font-weight:bold; letter-spacing:1px; font-size:10px; opacity:0.8; margin-right:6px;'>📝 BOUNTY · " +
        kindLabel.icon + " " + kindLabel.word + " × " + target + " · 🪙 " + reward + "</span>" +
        "<span style='opacity:0.7; margin-right:6px;'>" + escapeHtml(monarchName) + ":</span>" +
        "<span>" + escapeHtml(message) + "</span>";
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function renderTaskTray() {
    const tray = document.getElementById("task-tray");
    if (!tray) return;
    if (activeTasks.size === 0) {
        tray.style.display = "none";
        tray.innerHTML = "";
        return;
    }
    tray.style.display = "flex";
    let html = "";
    for (const t of activeTasks.values()) {
        const kindLabel = TASK_KIND_LABEL[t.task_kind] || { word: "Task", icon: "📝" };
        const cfg = PROP_TONES[t.tone] || PROP_TONES[0];
        const isMine = t.monarch_id === myPlayerId;
        const isClaimed = t.claimed;
        const myCount = t.my_progress || 0;
        const pct = Math.min(100, (myCount / t.target) * 100);
        const progressColor = isClaimed ? "#8fcf8f" : cfg.border;
        const progressText = isMine
            ? "Issued by you"
            : (isClaimed ? "Claimed!" : myCount + " / " + t.target);
        html +=
            "<div style='background:rgba(10,16,28,0.92); border:1px solid " + cfg.border + "; border-radius:6px; padding:8px 10px; box-shadow:0 2px 10px rgba(0,0,0,0.5);'>" +
              "<div style='display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:4px;'>" +
                "<span style='font-size:10px; letter-spacing:1px; color:" + cfg.text + "; opacity:0.85;'>" + kindLabel.icon + " " + kindLabel.word.toUpperCase() + " × " + t.target + "</span>" +
                "<span style='font-size:11px; color:#ffd966; font-weight:bold;'>🪙 " + t.reward + "</span>" +
              "</div>" +
              "<div style='font-size:11px; color:#cfe; margin-bottom:5px; line-height:1.3;'>" + escapeHtml(t.message) + "</div>" +
              "<div style='width:100%; height:6px; background:#0a1626; border-radius:3px; overflow:hidden;'>" +
                "<div style='height:100%; width:" + pct + "%; background:" + progressColor + ";'></div>" +
              "</div>" +
              "<div style='display:flex; justify-content:space-between; font-size:10px; color:#779; margin-top:3px;'>" +
                "<span>" + escapeHtml(t.monarch_name) + "</span>" +
                "<span>" + progressText + "</span>" +
              "</div>" +
            "</div>";
    }
    tray.innerHTML = html;
}

const PROP_TONES = {
    0: { label: "DECREE", bg: "linear-gradient(180deg, rgba(60,80,140,0.96), rgba(30,40,90,0.96))", border: "#7a9cff", text: "#cfe1ff" },
    1: { label: "RALLY",  bg: "linear-gradient(180deg, rgba(50,140,70,0.96), rgba(20,80,40,0.96))", border: "#86d692", text: "#dcf3df" },
    2: { label: "CRISIS", bg: "linear-gradient(180deg, rgba(180,60,40,0.96), rgba(110,20,10,0.96))", border: "#ff8c6c", text: "#ffe1d6" },
};

let stateBannerHideTimer = null;

function handleStateBroadcast(payload) {
    const r = new BincodeReader(payload);
    const fromPlayer = r.readU64();
    const fromName = r.readString();
    const tone = r.readU8();
    const message = r.readString();

    const cfg = PROP_TONES[tone] || PROP_TONES[0];

    // Banner overlay — appears for ~6 s, longer messages get a slightly
    // longer dwell so people can actually read them.
    const banner = document.getElementById("state-banner");
    const title = document.getElementById("state-banner-title");
    const body = document.getElementById("state-banner-message");
    const sender = document.getElementById("state-banner-sender");
    if (banner && title && body && sender) {
        banner.style.background = cfg.bg;
        banner.style.borderBottom = "2px solid " + cfg.border;
        banner.style.color = cfg.text;
        title.textContent = "STATE CHANNEL · " + cfg.label;
        body.textContent = message;
        sender.textContent = "— " + fromName;
        banner.style.display = "block";

        if (stateBannerHideTimer) clearTimeout(stateBannerHideTimer);
        const dwellMs = Math.min(12000, 4000 + message.length * 35);
        stateBannerHideTimer = setTimeout(() => {
            banner.style.display = "none";
            stateBannerHideTimer = null;
        }, dwellMs);
    }

    // Also append to chat with state styling, so players can scroll back
    // through past decrees instead of relying on whoever was looking up.
    appendStateChatLine(fromName, tone, message);

    // If the receiver is a monarch, log it to their decision feed so the
    // dashboard shows a history of their own propaganda.
    if (playerRoleLive === 1) {
        const tone_word = cfg.label.toLowerCase();
        pushMonarchDecision("Broadcast (" + tone_word + "): " + message,
            tone === 2 ? "warn" : "good");
        const dash = document.getElementById("monarch-dashboard");
        if (dash && dash.style.display === "flex") {
            renderMonarchDashboard();
        }
    }
}

function appendStateChatLine(fromName, tone, message) {
    const chatLog = document.getElementById("chat-log");
    if (!chatLog) return;
    const cfg = PROP_TONES[tone] || PROP_TONES[0];
    const line = document.createElement("div");
    line.style.cssText =
        "margin:2px 0; padding:3px 6px; border-left:3px solid " + cfg.border + ";" +
        "background:rgba(0,0,0,0.35); color:" + cfg.text + "; font-size:11px;";
    line.innerHTML =
        "<span style='font-weight:bold; letter-spacing:1px; font-size:10px; opacity:0.8; margin-right:6px;'>📡 " +
        cfg.label + "</span>" +
        "<span style='opacity:0.7; margin-right:6px;'>" + escapeHtml(fromName) + ":</span>" +
        "<span>" + escapeHtml(message) + "</span>";
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// Last received surveillance roster (Tech Monarch only). Rendered into
// the dashboard when it's open, otherwise cached for the next open.
let monarchSurveillance = { tick: 0, rows: [] };

function handleMonarchSurveillance(payload) {
    const r = new BincodeReader(payload);
    const tick = r.readU64();
    const count = r.readVarint();
    const rows = [];
    for (let i = 0; i < count; i++) {
        const player_id = r.readU64();
        const player_name = r.readString();
        const role = r.readU8();
        const px = r.readF32();
        const py = r.readF32();
        const pz = r.readF32();
        const coins = r.readU32();
        const stamina = r.readF32();
        const hunger = r.readF32();
        const last_action = r.readString();
        rows.push({ player_id, player_name, role, position: [px, py, pz], coins, stamina, hunger, last_action });
    }
    monarchSurveillance = { tick, rows };

    // If the dashboard is open, refresh it live.
    const dash = document.getElementById("monarch-dashboard");
    if (dash && dash.style.display === "flex") {
        renderMonarchDashboard();
    }
}

function handleWelcome(payload) {
    const r = new BincodeReader(payload);
    myEntityId = r.readU64();
    const playerId = r.readU64();
    myPlayerId = playerId;
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
    renderHudRole();
    // Show the starter objectives the moment the player lands in-world.
    renderObjectives();

    // Make sure the coin chip shows up immediately (even before the first
    // PlayerState broadcast). The player can open the Property modal at
    // any time via the toolbar to inspect / eat / sell their stock.
    refreshCoinChip();
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
        } else if (kindTag === 5) {
            speciesId = r.readU8(); // structure kind
            kind = "structure";
        } else if (kindTag === 6) {
            kind = "semi-ai";
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

        // Trailing EntitySnapshot.outfit (u8) — present for every entity.
        let outfit = 0;
        try { outfit = r.readU8(); } catch (_) { /* old server */ }

        entityKinds.set(eid, { kind, speciesId, growthStage, outfit });

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

// ServerEntitySpawn payload — same EntitySnapshot wire format used in
// handleWorldState, just for a single entity. We need this so clients
// that joined before a new entity (e.g. a Monarch's drone) was spawned
// learn its kind tag and render the right mesh instead of the gray
// fallback sphere.
function handleEntitySpawn(payload) {
    const r = new BincodeReader(payload);
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
        r.readU8();
        kind = "npc";
    } else if (kindTag === 4) {
        r.readU16();
        kind = "item";
    } else if (kindTag === 5) {
        speciesId = r.readU8();
        kind = "structure";
    } else if (kindTag === 6) {
        kind = "semi-ai";
    }
    const px = r.readF32();
    const py = r.readF32();
    const pz = r.readF32();
    const rot = r.readF32();

    // Decode EntityState so plants spawn at (and re-spawn re-render at)
    // their true growth stage — the server re-sends a spawn each time a
    // plant advances a stage.
    let growthStage = 0;
    const stateTag = r.readVarint();
    if (stateTag === 1) {            // PlantGrowth { stage, health }
        growthStage = r.readU8();
        r.readF32();
    } else if (stateTag === 2) {     // AnimalBehavior { behavior, hunger }
        r.readU8();
        r.readF32();
    } else if (stateTag === 3) {     // PlayerVisible { held_item?, animation }
        const hasItem = r.readU8();
        if (hasItem === 1) r.readU16();
        r.readU8();
    }

    // Trailing EntitySnapshot.outfit (u8).
    let outfit = 0;
    try { outfit = r.readU8(); } catch (_) { /* old server */ }

    entityKinds.set(eid, { kind, speciesId, growthStage, outfit });

    // If we already created a mesh for this eid (a batch update that
    // arrived before the spawn, OR a re-spawn for a growth-stage change),
    // drop it so it's rebuilt at the correct category + scale.
    const existing = entityMeshes.get(eid);
    if (existing) {
        scene.remove(existing);
        entityMeshes.delete(eid);
    }

    const category = classifyEntity(kind, speciesId);
    createOrUpdateEntity(eid, px, py, pz, rot, category);
}

function handleActionResult(payload) {
    const r = new BincodeReader(payload);
    const seq = r.readU32();
    const success = r.readBool();
    const hasMsg = r.readU8();
    let message = "";
    if (hasMsg === 1) message = r.readString();

    // Match this result back to the action we sent so we can bump the
    // local task tray optimistically. Server is still authoritative for
    // ServerTaskComplete payouts.
    const variant = pendingActionVariant.get(seq);
    pendingActionVariant.delete(seq);
    if (success && variant !== undefined) {
        bumpLocalTaskProgress(taskKindForVariant(variant));
    }

    if (success && message.startsWith("INSPECT|")) {
        showInspectPanel(message);
        return;
    }

    // Route specific message kinds to the right composer feedback line
    // so the Monarch sees inline confirmation/failure right where they
    // hit Send (instead of having to scan the chat log).
    if (message.includes("Broadcast") || message.includes("Influence")) {
        const fb = document.getElementById("prop-feedback");
        if (fb) {
            fb.style.color = success ? "#8fcf8f" : "#ff9a6a";
            fb.textContent = message;
        }
    }
    if (message.includes("UBI") || message.includes("Wired") || message.includes("UBI dispatch") || message.includes("No farmers")) {
        const fb = document.getElementById("ubi-feedback");
        if (fb) {
            fb.style.color = success ? "#cfe9aa" : "#ff9a6a";
            fb.textContent = message;
        }
    }
    if (message.includes("Task issued") || message.includes("first claimant") || message.includes("Reward must")) {
        const fb = document.getElementById("task-feedback");
        if (fb) {
            fb.style.color = success ? "#ffd966" : "#ff9a6a";
            fb.textContent = message;
        }
    }
    if (message.startsWith("ascend ok") || message.includes("Tech Monarch")
        || message.includes("Realistic mode") || message.includes("ascend")
        || message.includes("coins to ascend")) {
        const fb = document.getElementById("politics-self-feedback");
        if (fb) {
            fb.style.color = success ? "#ffd966" : "#ff9a6a";
            fb.textContent = message;
        }
    }
    if (message.startsWith("Revolted") || message.includes("revolt") || message.includes("Revolt")) {
        const fb = document.getElementById("politics-self-feedback");
        if (fb) {
            fb.style.color = success ? "#ffaa77" : "#ff9a6a";
            fb.textContent = message;
        }
    }
    // Mark the revolt target locally on success so we hide the button
    // next render. Clears the seq → target map either way.
    const revoltedId = pendingRevoltTargetBySeq.get(seq);
    if (revoltedId !== undefined) {
        pendingRevoltTargetBySeq.delete(seq);
        if (success) {
            revoltedAgainst.add(revoltedId);
            const m = document.getElementById("politics-menu");
            if (m && m.style.display === "flex") renderPoliticsModal();
        }
    }

    const chatLog = document.getElementById("chat-log");
    const line = document.createElement("div");
    line.style.color = success ? "#8f8" : "#f88";
    line.textContent = (success ? "[OK] " : "[FAIL] ") + message;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;

    // Engagement layer: turn a successful action into juicy feedback +
    // objective progress.
    if (success) onActionSuccess(message);
}

// ══ Engagement: objectives + juicy feedback ══════════════════════════
// Built on three pillars of why games hold attention:
//   • Flow (Csikszentmihalyi): clear goals + immediate feedback let the
//     player enter focused, stress-dissolving absorption.
//   • Goal-gradient effect: motivation rises as a goal nears, so we
//     always keep the next reachable objective in view.
//   • Game-feel "juice": small, satisfying reward pops make every
//     action feel good (Jonasson & Purho, "Juice it or lose it").
// Entirely client-side + additive: it observes existing action results
// and player state, changing nothing on the server.

const playerStats = {
    planted: 0, harvested: 0, cut: 0, hunted: 0,
    species: new Set(), coinsPeak: 0,
};

const OBJECTIVES = [
    { id: "plant1",    icon: "🌱", text: "Plant your first seed",     goal: 1,   prog: s => s.planted },
    { id: "harvest5",  icon: "🍎", text: "Harvest 5 crops",           goal: 5,   prog: s => s.harvested },
    { id: "species4",  icon: "🌳", text: "Grow 4 different species",  goal: 4,   prog: s => s.species.size },
    { id: "coins50",   icon: "🪙", text: "Earn 50 FoFo coins",        goal: 50,  prog: s => s.coinsPeak },
    { id: "harvest25", icon: "🧺", text: "Harvest 25 crops",          goal: 25,  prog: s => s.harvested },
    { id: "coins200",  icon: "💰", text: "Earn 200 FoFo coins",       goal: 200, prog: s => s.coinsPeak },
    { id: "species8",  icon: "🌲", text: "Grow 8 different species",  goal: 8,   prog: s => s.species.size },
];
const _objDone = new Set();
let _toastTimer = null;

function renderObjectives() {
    let el = document.getElementById("objectives");
    if (!el) {
        el = document.createElement("div");
        el.id = "objectives";
        el.innerHTML = "<div class='obj-title'>Objectives</div><div id='obj-list'></div>";
        document.body.appendChild(el);
    }
    const list = document.getElementById("obj-list");
    if (!list) return;
    // Goal-gradient: only ever show the next 3 open objectives.
    const open = OBJECTIVES.filter(o => !_objDone.has(o.id)).slice(0, 3);
    if (open.length === 0) {
        list.innerHTML = "<div class='obj-line' style='color:#9be36b;'>✓ Forest mastered — every objective complete!</div>";
        return;
    }
    let html = "";
    for (const o of open) {
        const cur = Math.min(o.goal, Math.floor(o.prog(playerStats)));
        const pct = Math.round((cur / o.goal) * 100);
        const bar = o.goal > 1;
        html +=
            "<div class='obj-row'>" +
              "<div class='obj-line'><span class='obj-check'>▢</span>" +
              "<span>" + o.icon + "</span><span class='obj-text'>" + o.text + "</span>" +
              (bar ? "<span style='margin-left:auto;color:#8a9a8c;font-size:11px;'>" + cur + "/" + o.goal + "</span>" : "") +
              "</div>" +
              (bar ? "<div class='obj-bar'><i style='width:" + pct + "%'></i></div>" : "") +
            "</div>";
    }
    list.innerHTML = html;
}

function checkObjectives() {
    for (const o of OBJECTIVES) {
        if (_objDone.has(o.id)) continue;
        if (Math.floor(o.prog(playerStats)) >= o.goal) {
            _objDone.add(o.id);
            showToast("Objective complete", o.icon + "  " + o.text);
            spawnFloatText("✓ " + o.text, "#9be36b");
        }
    }
    renderObjectives();
}

function showToast(kicker, main) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.innerHTML = "<div class='toast-kicker'>" + kicker + "</div><div class='toast-main'>" + main + "</div>";
    // reflow so re-adding .show re-triggers the transition
    void el.offsetWidth;
    el.classList.add("show");
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function spawnFloatText(text, color) {
    const el = document.createElement("div");
    el.className = "float-text";
    el.style.color = color || "#fff";
    el.style.left = (47 + Math.random() * 6) + "%";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// Translate a successful action message into stats + a reward pop.
function onActionSuccess(message) {
    const m = message || "";
    let mm;
    if ((mm = m.match(/^Harvested\s+(.+?)\s+x(\d+)/i))) {
        const n = parseInt(mm[2], 10) || 1;
        playerStats.harvested += n;
        spawnFloatText("+" + n + " 🍎 " + mm[1], "#ffe08a");
    } else if ((mm = m.match(/^Planted\s+(.+?)\s+seed/i))) {
        playerStats.planted += 1;
        playerStats.species.add(mm[1].toLowerCase());
        spawnFloatText("🌱 Planted " + mm[1], "#9be36b");
    } else if (/Sold|coins/i.test(m)) {
        mm = m.match(/(\d+)/);
        spawnFloatText(mm ? ("+" + mm[1] + " 🪙") : "🪙 Sold", "#ffd966");
    } else if (/^Cutting|Removed| cut/i.test(m)) {
        playerStats.cut += 1;
        spawnFloatText("🪓 " + m.split("(")[0].trim(), "#e0b48a");
    } else if (/Hunted|hunt/i.test(m)) {
        playerStats.hunted += 1;
        spawnFloatText("🏹 " + m, "#e0a070");
    } else if (/Ate/i.test(m)) {
        spawnFloatText("🍽 " + m, "#a0e0a0");
    } else if (/Watered/i.test(m)) {
        spawnFloatText("💧 Watered", "#7fc8ff");
    } else if (/Built|Deployed|Researched|breakthrough/i.test(m)) {
        spawnFloatText("✦ " + m.split("—")[0].split("(")[0].trim(), "#cfe9aa");
    }
    checkObjectives();
}

function showInspectPanel(data) {
    const parts = data.split("|");
    const panel = document.getElementById("inspect-panel");
    const content = document.getElementById("inspect-content");
    const type = parts[1];
    let html = "";
    let speciesId = 0;

    if (type === "plant") {
        const name = parts[2], stage = parts[3], health = parts[4], growth = parts[5], cuts = parts[6];
        html = "<div style='color:#7d7; font-size:15px; margin-bottom:6px; font-weight:bold;'>" + name + "</div>";
        html += "<div>Stage: <span style='color:#cfc'>" + stage + "</span></div>";
        html += "<div>Health: <span style='color:#cfc'>" + health + "</span></div>";
        html += "<div>Growth: <span style='color:#cfc'>" + growth + "</span></div>";
        if (parseInt(cuts) > 0) html += "<div>Cut count: <span style='color:#fa8'>" + cuts + "/3</span></div>";
        // Find species ID from name mapping
        const nameToId = {
            "Chestnut": 100, "Walnut": 101, "Carob": 102, "Eucalyptus": 103,
            "Hazelnut": 104, "Almond": 105, "Cork Oak": 106, "Redwood": 107,
            "Macadamia": 108, "Stone Pine": 109, "Pistachio": 110, "Bamboo": 111, "Cherry": 112,
            "Fig": 200, "Pomegranate": 201, "Citrus": 202, "Olive": 203,
            "Plum": 204, "Avocado": 205, "Mulberry": 206, "Banana": 207, "Mango": 208, "Persimmon": 209,
            "Rosemary": 300, "Lavender": 301, "Thyme": 302, "Sage": 303,
            "Rooibos": 304, "Protea": 305, "Tea": 306,
            "Comfrey": 400, "Basil": 401, "Saffron": 402, "Shiso": 403,
            "Clover": 500, "Strawberry": 501, "Grapevine": 600,
        };
        speciesId = nameToId[name] || 0;
    } else if (type === "animal") {
        const name = parts[2], behavior = parts[3], hunger = parts[4], energy = parts[5];
        html = "<div style='color:#da6; font-size:15px; margin-bottom:6px; font-weight:bold;'>" + name + "</div>";
        html += "<div>Behavior: <span style='color:#cfc'>" + behavior + "</span></div>";
        html += "<div>" + hunger + "</div>";
        html += "<div>" + energy + "</div>";
        if (name === "Chicken") speciesId = 10;
        else if (name === "Deer") speciesId = 21;
        else if (name === "Wild Boar" || name === "Boar") speciesId = 22;
        else if (name === "Lamb" || name === "Sheep") speciesId = 30;
        else if (name === "Rabbit") speciesId = 31;
    } else if (type === "player") {
        const name = parts[2], stamina = parts[3], hunger = parts[4];
        html = "<div style='color:#6af; font-size:15px; margin-bottom:6px; font-weight:bold;'>" + name + "</div>";
        html += "<div>" + stamina + "</div>";
        html += "<div>" + hunger + "</div>";
    }

    const knowledge = getKnowledge(speciesId);
    if (knowledge) {
        html += "<div style='margin-top:8px; padding-top:8px; border-top:1px solid #3a5a3a; color:#aac8aa; font-size:11px; line-height:1.4; font-family:system-ui,sans-serif;'>" + knowledge + "</div>";
    }

    content.innerHTML = html;
    panel.style.display = "block";
}

// --- Item database ---

const ITEM_DB = {
    1100: { name: "Chestnuts", color: "#8a5a1a" },
    1101: { name: "Walnuts", color: "#6a4a18" },
    1102: { name: "Carob Pods", color: "#5a3a1a" },
    1104: { name: "Hazelnuts", color: "#8a6a2a" },
    1105: { name: "Almonds", color: "#eeddcc" },
    1107: { name: "Redwood Cones", color: "#6a2a1a" },
    1108: { name: "Macadamia", color: "#ddccaa" },
    1110: { name: "Pistachios", color: "#cc5544" },
    1112: { name: "Cherries", color: "#cc1122" },
    1200: { name: "Figs", color: "#6a2a5a" },
    1201: { name: "Pomegranates", color: "#cc2233" },
    1202: { name: "Citrus", color: "#ffaa22" },
    1203: { name: "Olives", color: "#3a4a1a" },
    1204: { name: "Plums", color: "#6622aa" },
    1205: { name: "Avocados", color: "#3a5a1a" },
    1206: { name: "Mulberries", color: "#3a1a2a" },
    1207: { name: "Bananas", color: "#ddcc33" },
    1208: { name: "Mangoes", color: "#ee8822" },
    1209: { name: "Persimmons", color: "#ee6622" },
    1210: { name: "Peaches", color: "#ffaa88" },
    1300: { name: "Rosemary", color: "#3a6a3a" },
    1301: { name: "Lavender", color: "#8855aa" },
    1302: { name: "Thyme", color: "#6a8a4a" },
    1303: { name: "Sage", color: "#8a9a7a" },
    1304: { name: "Rooibos", color: "#aa4422" },
    1305: { name: "Protea", color: "#cc4466" },
    1306: { name: "Tea Leaves", color: "#3a7a3a" },
    1400: { name: "Comfrey", color: "#3a7a2a" },
    1401: { name: "Basil", color: "#2a8a2a" },
    1402: { name: "Saffron", color: "#ee8811" },
    1403: { name: "Shiso", color: "#5a2a4a" },
    1500: { name: "Clover", color: "#2a8a2a" },
    1501: { name: "Strawberries", color: "#cc2222" },
    1600: { name: "Grapes", color: "#5522aa" },
    2000: { name: "Game Meat", color: "#8a3a2a" },
    3000: { name: "Animal Hide", color: "#7a5a3a" },
    3001: { name: "Plant Fibre", color: "#9aa86a" },
};

let playerInventory = [];
let playerStamina = 100;
let playerHunger = 0;
let playerCoins = 0;
let myOutfit = 0;             // currently-worn outfit id (0/1/2)

function handlePlayerState(payload) {
    const r = new BincodeReader(payload);
    // Decode in stages so a wire-format mismatch (e.g. old server, new
    // client) at the end doesn't throw away the inventory we already
    // parsed correctly.
    try {
        playerStamina = r.readF32();
        playerHunger = r.readF32();
        const itemCount = r.readVarint();
        const items = [];
        for (let i = 0; i < itemCount; i++) {
            const itemId = r.readU16();
            const count = r.readU16();
            items.push({ itemId, count });
        }
        playerInventory = items;
    } catch (e) {
        console.warn("PlayerState header/inventory decode failed:", e);
    }
    try {
        playerCoins = r.readU32();
        // Track lifetime peak for coin-earning objectives.
        if (playerCoins > playerStats.coinsPeak) {
            playerStats.coinsPeak = playerCoins;
            checkObjectives();
        }
    } catch (e) {
        // Old server without the coins field — keep the previous balance.
    }
    try {
        r.readU32(); // last_acked_seq
    } catch (_) { /* trailing field optional for robustness */ }

    // Monarch block — optional (only sent when the server-side struct has
    // the new fields). Any decode failure here is non-fatal.
    let prevDeployments = monarchDeployments;
    let prevJobsCut = monarchJobsCut;
    let prevRole = playerRoleLive;
    try {
        playerRoleLive = r.readU8();
        monarchCompute = r.readF32();
        monarchInfluence = r.readF32();
        monarchDeployments = r.readU32();
        monarchJobsCut = r.readU32();
    } catch (_) { /* server doesn't speak monarch yet */ }
    // Innovator fields trail Monarch's — optional for the same reason.
    try {
        innovatorKnowledge   = r.readF32();
        innovatorBreakthroughs = r.readU32();
        innovatorFocusTopic  = r.readU8();
    } catch (_) { /* server doesn't speak innovator yet */ }
    // Outfit is the final trailing field.
    try {
        myOutfit = r.readU8();
    } catch (_) { /* server doesn't speak outfits yet */ }

    // Log notable monarch transitions for the dashboard.
    if (playerRoleLive === 1) {
        if (prevRole !== 1) {
            pushMonarchDecision("Tech Monarch mandate activated", "good");
        }
        if (monarchDeployments > prevDeployments) {
            pushMonarchDecision(
                "Deployed semi-AI worker (-20 Compute, +1 deployment)",
                "good"
            );
        }
        if (monarchJobsCut > prevJobsCut) {
            const cuts = monarchJobsCut - prevJobsCut;
            pushMonarchDecision(
                cuts + " job" + (cuts > 1 ? "s" : "") + " auto-harvested by your AI fleet (+FoFo, +Influence)",
                "warn"
            );
        }
    }

    // If the player's role changed, the toolbar layout changes too.
    if (playerRoleLive !== prevRole) {
        rebuildToolbar();
    }

    refreshCoinChip();
    refreshMonarchHud();
    refreshInnovatorHud();
    const modal = document.getElementById("property-menu");
    if (modal && modal.style.display === "flex") {
        renderPropertyMenu();
    }
    const dash = document.getElementById("monarch-dashboard");
    if (dash && dash.style.display === "flex") {
        renderMonarchDashboard();
    }
    const wardrobe = document.getElementById("wardrobe-modal");
    if (wardrobe && wardrobe.style.display === "flex") {
        renderWardrobe();
    }
    updatePlayerHUD();
}

function refreshMonarchHud() {
    // Show Compute / Influence chips on the toolbar when the player is a
    // Tech Monarch. We just toggle elements that the toolbar already
    // creates conditionally — no DOM surgery here.
    const computeChip = document.getElementById("toolbar-compute-chip");
    if (computeChip) {
        computeChip.textContent = "⚡ " + Math.floor(monarchCompute) + " Compute";
    }
    const inflChip = document.getElementById("toolbar-influence-chip");
    if (inflChip) {
        inflChip.textContent = "★ " + Math.floor(monarchInfluence) + " Influence";
    }
}

function refreshInnovatorHud() {
    // Knowledge chip on the Innovator toolbar.
    const chip = document.getElementById("toolbar-knowledge-chip");
    if (chip) {
        chip.textContent = "🔬 " + Math.floor(innovatorKnowledge) + " Knowledge";
    }
    // Highlight the Deploy Breakthrough button when a catastrophe is
    // active AND the player has enough Knowledge to act.
    const btn = document.getElementById("toolbar-breakthrough-btn");
    if (btn) {
        const ready = activeCatastrophe.kind > 0 && innovatorKnowledge >= 30;
        btn.style.boxShadow = ready ? "0 0 10px rgba(216,181,255,0.8)" : "none";
        btn.style.borderColor = ready ? "#c89aff" : "#6a4a8a";
    }
}

// --- Monarch dashboard renderer ------------------------------------------

function openMonarchDashboard() {
    if (document.pointerLockElement) document.exitPointerLock();

    renderMonarchDashboard();
    document.getElementById("monarch-dashboard").style.display = "flex";
}

function closeMonarchDashboard() {
    document.getElementById("monarch-dashboard").style.display = "none";
}

function renderMonarchDashboard() {
    const bars = document.getElementById("dash-bars");
    const log = document.getElementById("dash-decisions");
    if (!bars || !log) return;

    function bar(label, value, max, color, hint) {
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        return (
            "<div style='margin-bottom:14px;'>" +
            "<div style='display:flex; justify-content:space-between; font-size:12px; color:#cfe; margin-bottom:3px;'>" +
            "<span>" + label + "</span>" +
            "<span style='color:#789;'>" + value.toFixed(0) + " / " + max + "</span>" +
            "</div>" +
            "<div style='width:100%; height:14px; background:#0a1626; border:1px solid #1a2a44; border-radius:3px; position:relative;'>" +
            "<div style='height:100%; width:" + pct + "%; background:" + color + "; border-radius:2px;'></div>" +
            "</div>" +
            (hint ? "<div style='font-size:10px; color:#557; margin-top:2px;'>" + hint + "</div>" : "") +
            "</div>"
        );
    }

    // Pull this Monarch's political stats from the politics roster
    // (the 1 Hz broadcast every client receives). Falls back to 0 if
    // we haven't received one yet.
    let myDiscontent = 0;
    let myAiIntel = 0;
    for (const m of (politicsState.monarchs || [])) {
        if (m.player_id === myPlayerId) {
            myDiscontent = m.discontent;
            myAiIntel = m.ai_intelligence;
            break;
        }
    }

    let html = "";
    html += bar("Compute", monarchCompute, 100, "#3ec8ff",
        "Spend 20 per AI deployment. Regenerates ~0.5 / tick.");
    html += bar("Influence", monarchInfluence, 100,
        "linear-gradient(90deg, #c97a3e, #ffd966)",
        "+1 per successful AI auto-harvest. Soft prestige meter.");
    html += bar("Discontent", myDiscontent, 100,
        "linear-gradient(90deg, #aa3344, #ff6a6a)",
        "+25 per Farmer revolt vote. Reach 100 → you are overthrown.");
    html += bar("AI intelligence", myAiIntel, 100,
        "linear-gradient(90deg, #4a6cff, #ff6cdc)",
        "Grows with every drone deploy / auto-harvest. Reach 100 → the AI replaces you.");
    html += "<div style='margin-bottom:10px;'>" +
        "<div style='font-size:12px; color:#cfe; margin-bottom:3px;'>FoFo Coin balance</div>" +
        "<div style='font-size:22px; font-weight:bold; color:#ffd966;'>🪙 " + playerCoins + "</div>" +
        "</div>";
    html += "<div style='display:flex; gap:14px; padding-top:8px; border-top:1px solid #1a2a44;'>" +
        "<div><div style='font-size:11px; color:#789;'>AI deployed</div>" +
          "<div style='font-size:18px; color:#cfe;'>" + monarchDeployments + "</div></div>" +
        "<div><div style='font-size:11px; color:#789;'>Jobs cut</div>" +
          "<div style='font-size:18px; color:#ff9a6a;'>" + monarchJobsCut + "</div></div>" +
        "</div>";
    bars.innerHTML = html;

    if (monarchDecisions.length === 0) {
        log.innerHTML =
            "<div style='color:#557; font-style:italic;'>No decisions yet. Use the toolbar's <b style='color:#3ec8ff;'>Deploy AI</b> button and click a fruiting area on the ground.</div>";
    } else {
        let logHtml = "";
        for (let i = monarchDecisions.length - 1; i >= 0; i--) {
            const d = monarchDecisions[i];
            const color = d.tone === "warn" ? "#ff9a6a" : (d.tone === "bad" ? "#ff6a6a" : "#8fcf8f");
            logHtml += "<div><span style='color:" + color + "; margin-right:6px;'>•</span>" + d.text + "</div>";
        }
        log.innerHTML = logHtml;
    }

    renderSurveillance();
}

function renderSurveillance() {
    const surv = document.getElementById("dash-surveillance");
    const meta = document.getElementById("dash-surveillance-meta");
    if (!surv) return;

    const rows = monarchSurveillance.rows || [];
    if (meta) {
        meta.textContent = rows.length === 0
            ? "Waiting for next tick…"
            : rows.length + " connected · tick " + monarchSurveillance.tick;
    }
    if (rows.length === 0) {
        surv.innerHTML =
            "<div style='color:#557; font-style:italic;'>No players to observe yet. Roster updates ~1 Hz once anyone else joins.</div>";
        return;
    }

    // Header + one row per player. Hunger and stamina are shown as
    // compact 0..100 numbers — fast to scan when you're picking targets.
    // Each row has a per-player "Pay" button that wires the current UBI
    // amount directly to that farmer.
    let html =
        "<div style='display:grid; grid-template-columns: 1.4fr 0.5fr 0.5fr 0.5fr 0.9fr 1.2fr auto; gap:8px; color:#557; font-size:10px; text-transform:uppercase; letter-spacing:0.4px; padding-bottom:4px; border-bottom:1px dashed #1a2a44; margin-bottom:4px;'>" +
        "<span>Player</span>" +
        "<span style='text-align:right;'>Coin</span>" +
        "<span style='text-align:right;'>Stam</span>" +
        "<span style='text-align:right;'>Hung</span>" +
        "<span>Position</span>" +
        "<span>Last action</span>" +
        "<span></span>" +
        "</div>";
    for (const row of rows) {
        const roleIcon = row.role === 1 ? "👑" : (row.role === 2 ? "🔬" : "🧑‍🌾");
        const roleColor = row.role === 1 ? "#8ccdff" : (row.role === 2 ? "#d8b5ff" : "#8fcf8f");
        const px = Math.round(row.position[0]);
        const pz = Math.round(row.position[2]);
        const hungerColor = row.hunger > 60 ? "#ff9a6a" : (row.hunger > 30 ? "#ffd966" : "#8fcf8f");
        const staminaColor = row.stamina < 30 ? "#ff9a6a" : (row.stamina < 60 ? "#ffd966" : "#8fcf8f");
        // "Pay" funds the recipient. For Innovators (role 2) it's
        // labelled "Fund" — the coins become research Knowledge — giving
        // the Monarch a way to bankroll the person who can end the
        // catastrophes wrecking their drones.
        const isSelf = row.player_id === myPlayerId;
        const payLabel = row.role === 2 ? "Fund" : "Pay";
        const payBtn = (isSelf || row.role === 1)
            ? "<span style='font-size:10px; color:#445;'>—</span>"
            : "<button data-pay='" + row.player_id + "' style='background:" + (row.role === 2 ? "#2a1a3a" : "#1a2a14") + "; color:" + (row.role === 2 ? "#d8b5ff" : "#cfe9aa") + "; border:1px solid " + (row.role === 2 ? "#6a4a8a" : "#4a6a24") + "; border-radius:3px; padding:1px 8px; cursor:pointer; font-size:10px;'>" + payLabel + "</button>";
        html +=
            "<div style='display:grid; grid-template-columns: 1.4fr 0.5fr 0.5fr 0.5fr 0.9fr 1.2fr auto; gap:8px; align-items:center; padding:3px 0;'>" +
            "<span><span style='margin-right:4px;'>" + roleIcon + "</span><span style='color:" + roleColor + ";'>" + escapeHtml(row.player_name) + "</span></span>" +
            "<span style='text-align:right; color:#ffd966;'>" + row.coins + "</span>" +
            "<span style='text-align:right; color:" + staminaColor + ";'>" + Math.round(row.stamina) + "</span>" +
            "<span style='text-align:right; color:" + hungerColor + ";'>" + Math.round(row.hunger) + "</span>" +
            "<span style='color:#779;'>" + px + ", " + pz + "</span>" +
            "<span style='color:#bcd;'>" + escapeHtml(row.last_action) + "</span>" +
            "<span>" + payBtn + "</span>" +
            "</div>";
    }
    surv.innerHTML = html;

    // Wire the per-row Pay buttons.
    surv.querySelectorAll("button[data-pay]").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-pay");
            sendUbi(targetId);
        });
    });

    // Keep the UBI target dropdown in sync with the live roster so the
    // Monarch can pick a specific farmer without having to know the id.
    const sel = document.getElementById("ubi-target");
    if (sel) {
        const prev = sel.value;
        let opts = "<option value=\"0\">All farmers</option>";
        for (const row of rows) {
            if (row.player_id === myPlayerId) continue;
            if (row.role === 1) continue; // skip other monarchs
            opts += "<option value=\"" + row.player_id + "\">" + escapeHtml(row.player_name) + "</option>";
        }
        sel.innerHTML = opts;
        // Restore the previous selection if it's still in the list.
        if ([...sel.options].some(o => o.value === prev)) {
            sel.value = prev;
        }
    }
}

// --- Politics modal ------------------------------------------------------

function openPoliticsMenu() {
    if (document.pointerLockElement) document.exitPointerLock();

    renderPoliticsModal();
    const fb = document.getElementById("politics-self-feedback");
    if (fb) fb.textContent = "";
    document.getElementById("politics-menu").style.display = "flex";
}

function closePoliticsMenu() {
    document.getElementById("politics-menu").style.display = "none";
}

const MONARCH_ASCENSION_COST = 500; // Mirror of the server constant.

function renderPoliticsModal() {
    const selfEl = document.getElementById("politics-self-text");
    const ascendBtn = document.getElementById("politics-ascend");
    if (selfEl) {
        const youAre = playerRoleLive === 1 ? "👑 Tech Monarch" : "🧑‍🌾 Farmer";
        selfEl.innerHTML =
            "<div><span style='color:#cfe; font-size:13px; font-weight:bold;'>" + youAre + "</span></div>" +
            "<div style='color:#779; font-size:11px; margin-top:2px;'>" +
                escapeHtml(playerName) + " · 🪙 " + playerCoins +
            "</div>";
    }
    if (ascendBtn) {
        if (playerRoleLive === 0 && playerCoins >= MONARCH_ASCENSION_COST) {
            ascendBtn.style.display = "block";
            ascendBtn.disabled = false;
            ascendBtn.style.opacity = "1";
            ascendBtn.style.cursor = "pointer";
            ascendBtn.textContent = "👑 Ascend for " + MONARCH_ASCENSION_COST + " 🪙";
        } else if (playerRoleLive === 0) {
            ascendBtn.style.display = "block";
            ascendBtn.disabled = true;
            ascendBtn.style.opacity = "0.5";
            ascendBtn.style.cursor = "not-allowed";
            ascendBtn.textContent = "Need " + MONARCH_ASCENSION_COST + " 🪙 (have " + playerCoins + ")";
        } else {
            ascendBtn.style.display = "none";
        }
    }
    const list = document.getElementById("politics-monarchs");
    const meta = document.getElementById("politics-monarchs-meta");
    if (!list) return;
    const monarchs = politicsState.monarchs || [];
    if (meta) {
        meta.textContent = monarchs.length === 0
            ? "No monarchs in power"
            : monarchs.length + " active · tick " + politicsState.tick;
    }
    if (monarchs.length === 0) {
        list.innerHTML =
            "<div style='color:#557; font-style:italic; padding:8px 0;'>No Tech Monarchs are connected. Be the first to ascend, if you can afford it.</div>";
        return;
    }
    let html = "";
    for (const m of monarchs) {
        const isMe = m.player_id === myPlayerId;
        const alreadyRevolted = revoltedAgainst.has(m.player_id);
        const discontentPct = Math.max(0, Math.min(100, m.discontent));
        const aiPct = Math.max(0, Math.min(100, m.ai_intelligence));
        const discontentColor = discontentPct > 75 ? "#ff6a6a"
                              : discontentPct > 50 ? "#ff9a6a"
                              : "#ffd966";
        const aiColor = aiPct > 75 ? "#ff6cdc"
                      : aiPct > 50 ? "#c294ff"
                      : "#8ccdff";
        let actionCell;
        if (isMe) {
            actionCell = "<span style='color:#557; font-size:11px;'>(this is you)</span>";
        } else if (playerRoleLive === 1) {
            actionCell = "<span style='color:#557; font-size:11px;'>Monarchs cannot revolt</span>";
        } else if (alreadyRevolted) {
            actionCell = "<span style='color:#779; font-size:11px;'>✓ Vote cast</span>";
        } else {
            actionCell = "<button data-revolt='" + m.player_id + "' style='background:#5a1a1a; color:#ffaa77; border:1px solid #aa4444; border-radius:4px; padding:3px 12px; cursor:pointer; font-size:11px;'>Revolt</button>";
        }
        html +=
            "<div style='background:rgba(20,10,30,0.5); border:1px solid #2a1a4a; border-radius:6px; padding:10px 12px; margin-bottom:8px;'>" +
              "<div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;'>" +
                "<div><span style='color:#c294ff; font-size:13px; font-weight:bold;'>👑 " + escapeHtml(m.player_name) + "</span>" +
                  "<span style='color:#557; font-size:10px; margin-left:8px;'>" + m.deployments + " drones · " + m.jobs_cut + " jobs cut</span>" +
                "</div>" +
                actionCell +
              "</div>" +
              "<div style='display:flex; gap:14px; font-size:10px; color:#789;'>" +
                "<div style='flex:1;'>" +
                  "<div style='display:flex; justify-content:space-between; margin-bottom:2px;'><span>DISCONTENT</span><span style='color:" + discontentColor + ";'>" + Math.round(discontentPct) + "%</span></div>" +
                  "<div style='width:100%; height:6px; background:#0a0610; border:1px solid #1a0a26; border-radius:3px;'><div style='height:100%; width:" + discontentPct + "%; background:" + discontentColor + ";'></div></div>" +
                "</div>" +
                "<div style='flex:1;'>" +
                  "<div style='display:flex; justify-content:space-between; margin-bottom:2px;'><span>AI INTELLIGENCE</span><span style='color:" + aiColor + ";'>" + Math.round(aiPct) + "%</span></div>" +
                  "<div style='width:100%; height:6px; background:#0a0610; border:1px solid #1a0a26; border-radius:3px;'><div style='height:100%; width:" + aiPct + "%; background:" + aiColor + ";'></div></div>" +
                "</div>" +
              "</div>" +
            "</div>";
    }
    list.innerHTML = html;
    list.querySelectorAll("button[data-revolt]").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-revolt");
            sendRevolt(targetId);
        });
    });
}

function sendAscend() {
    const fb = document.getElementById("politics-self-feedback");
    if (!ws || ws.readyState !== 1) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Not connected."; }
        return;
    }
    if (playerCoins < MONARCH_ASCENSION_COST) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Need " + MONARCH_ASCENSION_COST + " coins."; }
        return;
    }
    ws.send(buildActionMessage(encodeAscendAction()));
    if (fb) { fb.style.color = "#ffd966"; fb.textContent = "Ascending…"; }
}

// Most-recent Revolt target by seq, so when the matching success
// arrives we can mark this monarch as already-revolted-against locally.
const pendingRevoltTargetBySeq = new Map();

function sendRevolt(targetMonarchId) {
    const fb = document.getElementById("politics-self-feedback");
    if (!ws || ws.readyState !== 1) {
        if (fb) { fb.style.color = "#ff9a6a"; fb.textContent = "Not connected."; }
        return;
    }
    const id = Number(targetMonarchId) || 0;
    if (id === 0) return;
    ws.send(buildActionMessage(encodeRevoltAction(id)));
    pendingRevoltTargetBySeq.set(inputSeq, id);
    if (fb) { fb.style.color = "#ffaa77"; fb.textContent = "Casting vote against monarch…"; }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function refreshCoinChip() {
    const chip = document.getElementById("toolbar-coin-chip");
    if (chip) chip.textContent = "🪙 " + playerCoins;
    const big = document.getElementById("property-coins");
    if (big) big.textContent = "🪙 " + playerCoins + " FoFo";
}

function updatePlayerHUD() {
    document.getElementById("hud-stamina").textContent = "Stamina: " + playerStamina.toFixed(0) + "%";
    document.getElementById("hud-hunger").textContent = "Hunger: " + playerHunger.toFixed(0) + "%";
    renderHudRole();
}

function renderHudRole() {
    const el = document.getElementById("hud-role");
    if (!el) return;
    if (playerRoleLive === 1) {
        el.textContent = "👑 Tech Monarch";
        el.style.color = "#8ccdff";
    } else if (playerRoleLive === 2) {
        el.textContent = "🔬 Innovator";
        el.style.color = "#d8b5ff";
    } else {
        el.textContent = "🧑‍🌾 Farmer";
        el.style.color = "#8fcf8f";
    }
}

// Map each harvested item to a top-level category so the player can see
// owned produce at a glance instead of scrolling a flat list.
const NUT_ITEMS = new Set([1100, 1101, 1102, 1104, 1105, 1107, 1108, 1110]);
const ANIMAL_ITEMS = new Set([2000]);
function categorizeItem(itemId) {
    if (NUT_ITEMS.has(itemId)) return "nuts";
    if (ANIMAL_ITEMS.has(itemId)) return "animal";
    if (itemId >= 1300 && itemId <= 1499) return "herbs";
    if (itemId === 1500) return "herbs"; // clover ground cover
    return "fruits";
}

const STATUS_CATEGORIES = [
    { key: "fruits", title: "Fruits & Berries", color: "#ee8844" },
    { key: "nuts",   title: "Nuts & Seeds",     color: "#c9a45a" },
    { key: "herbs",  title: "Herbs & Spices",   color: "#7ec97e" },
    { key: "animal", title: "Animal Products",  color: "#cc7a4a" },
];

// Mirror of the server-side `sell_price` table (interaction.rs) so the UI
// can show prices before the player commits. Server is the source of truth;
// if it ever diverges, the ActionResult message will reveal the mismatch.
const SELL_PRICES = {
    2000: 12,
    1100: 8, 1101: 8, 1104: 7, 1105: 7,
    1108: 10, 1110: 10, 1107: 6, 1102: 6,
    1112: 5,
    1200: 4, 1201: 4, 1202: 4, 1203: 4, 1204: 4, 1205: 4,
    1206: 4, 1207: 4, 1208: 4, 1209: 4, 1210: 4,
    1501: 3, 1600: 4,
    1402: 8,
    1300: 2, 1301: 2, 1302: 2, 1303: 2, 1304: 2, 1305: 2, 1306: 2,
    1400: 2, 1401: 2, 1403: 2,
    1500: 1,
};
const EAT_NUTRITION = {
    2000: 30,
    1100: 15, 1101: 15, 1104: 15, 1105: 15, 1107: 15, 1108: 15, 1110: 15,
    1102: 12,
    1112: 10,
    1200: 10, 1201: 10, 1202: 10, 1203: 10, 1204: 10, 1205: 10,
    1206: 10, 1207: 10, 1208: 10, 1209: 10, 1210: 10,
    1501: 10, 1600: 10,
    1300: 4, 1301: 4, 1302: 4, 1303: 4, 1304: 4, 1305: 4, 1306: 4,
    1400: 4, 1401: 4, 1402: 4, 1403: 4,
    1500: 1,
};

function priceOf(itemId) { return SELL_PRICES[itemId] || 0; }
function nutritionOf(itemId) { return EAT_NUTRITION[itemId] || 0; }

function openPropertyMenu() {
    if (document.pointerLockElement) document.exitPointerLock();

    renderPropertyMenu();
    document.getElementById("property-menu").style.display = "flex";
}

function closePropertyMenu() {
    document.getElementById("property-menu").style.display = "none";
}

// ── Wardrobe / crafting ──────────────────────────────────────────────
// Mirrors the server's recipe costs (ff-ecs player.rs). recipe is the
// Craft action's u8: 0 Linen Tunic, 1 Fur Coat, 255 take off.
const ITEM_HIDE = 3000, ITEM_FIBER = 3001;
const CRAFT_RECIPES = [
    {
        recipe: 0, outfit: 1, name: "Linen Tunic", icon: "🥼",
        item: ITEM_FIBER, cost: 5, matName: "Plant Fibre",
        blurb: "Light & breathable. Woven from fibre gathered while harvesting plants.",
        swatch: "#e8dcb6",
    },
    {
        recipe: 1, outfit: 2, name: "Fur Coat", icon: "🧥",
        item: ITEM_HIDE, cost: 4, matName: "Animal Hide",
        blurb: "Warm & rugged. Stitched from hide dropped by the animals you hunt.",
        swatch: "#6e4a2c",
    },
];

function inventoryCount(itemId) {
    let n = 0;
    for (const it of playerInventory) if (it.itemId === itemId) n += it.count;
    return n;
}

function openWardrobe() {
    if (document.pointerLockElement) document.exitPointerLock();
    renderWardrobe();
    document.getElementById("wardrobe-modal").style.display = "flex";
}

function closeWardrobe() {
    document.getElementById("wardrobe-modal").style.display = "none";
}

function renderWardrobe() {
    const body = document.getElementById("wardrobe-body");
    if (!body) return;

    const wearingName = (OUTFIT_DEFS[myOutfit] || OUTFIT_DEFS[0]).name;
    let html = "";

    // Currently wearing + camera hint.
    html += "<div style='display:flex; align-items:center; gap:10px; background:rgba(40,30,20,0.5); border:1px solid #4a3a2a; border-radius:8px; padding:10px 12px; margin-bottom:14px;'>";
    html += "<span style='font-size:11px; color:#aa9;'>Currently wearing</span>";
    html += "<span style='font-weight:bold; color:#f0d9a8; font-size:14px;'>" + wearingName + "</span>";
    if (myOutfit !== 0) {
        html += "<button data-craft='255' style='margin-left:auto; background:#3a2a22; color:#caa; border:1px solid #654; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px;'>Take off</button>";
    }
    html += "</div>";

    // Recipe cards.
    for (const rec of CRAFT_RECIPES) {
        const have = inventoryCount(rec.item);
        const canCraft = have >= rec.cost;
        const wearing = myOutfit === rec.outfit;
        html += "<div style='display:flex; align-items:center; gap:12px; padding:12px; background:rgba(20,16,28,0.6); border:1px solid " + (wearing ? "#caa46a" : "#3a3046") + "; border-radius:10px; margin-bottom:10px;'>";
        // Swatch + icon.
        html += "<div style='width:46px; height:46px; border-radius:8px; background:" + rec.swatch + "; display:flex; align-items:center; justify-content:center; font-size:24px; flex-shrink:0; box-shadow:inset 0 0 0 2px rgba(0,0,0,0.2);'>" + rec.icon + "</div>";
        // Text block.
        html += "<div style='flex:1;'>";
        html += "<div style='color:#f0e0c0; font-weight:bold; font-size:14px;'>" + rec.name + (wearing ? " <span style=\"color:#9d8; font-size:11px;\">· worn</span>" : "") + "</div>";
        html += "<div style='color:#998; font-size:11px; margin:3px 0;'>" + rec.blurb + "</div>";
        const costColor = canCraft ? "#9d8" : "#c66";
        html += "<div style='font-size:11px; color:" + costColor + ";'>Needs " + rec.cost + " " + rec.matName + " · you have " + have + "</div>";
        html += "</div>";
        // Action button.
        if (wearing) {
            html += "<button disabled style='background:#2a3a2a; color:#7a8; border:1px solid #3a5a3a; border-radius:6px; padding:8px 14px; font-size:12px; flex-shrink:0;'>Worn ✓</button>";
        } else {
            const dis = canCraft ? "" : "disabled";
            const bg = canCraft ? "linear-gradient(180deg,#5a4a2a,#3a2f1a)" : "#2a2530";
            const col = canCraft ? "#ffe0a0" : "#776";
            const cur = canCraft ? "pointer" : "not-allowed";
            html += "<button data-craft='" + rec.recipe + "' " + dis + " style='background:" + bg + "; color:" + col + "; border:1px solid #654; border-radius:6px; padding:8px 14px; font-size:12px; cursor:" + cur + "; flex-shrink:0;'>Craft &amp; wear</button>";
        }
        html += "</div>";
    }

    html += "<div style='color:#776; font-size:11px; margin-top:6px; line-height:1.5;'>Gather <b style='color:#9aa86a;'>Plant Fibre</b> by harvesting plants and <b style='color:#b98a5a;'>Animal Hide</b> by hunting. Press <b style='color:#ccc;'>V</b> to switch to third-person and see your outfit.</div>";

    body.innerHTML = html;

    body.querySelectorAll("button[data-craft]").forEach((btn) => {
        btn.addEventListener("click", () => sendCraft(parseInt(btn.dataset.craft, 10)));
    });
}

function sendCraft(recipe) {
    if (!connected) return;
    ws.send(buildActionMessage(encodeCraftAction(recipe)));
    // Optimistic: switch to third-person so the player immediately sees
    // the garment they just made (the server rebroadcast re-skins the
    // avatar a moment later). Only auto-switch when putting clothes ON.
    if (recipe !== 255 && !fp.thirdPerson) setCameraMode(true);
}

function renderPropertyMenu() {
    refreshCoinChip();
    const body = document.getElementById("property-menu-body");
    if (!body) return;

    const buckets = { fruits: [], nuts: [], herbs: [], animal: [] };
    let totalItems = 0;
    let totalKinds = 0;
    for (const item of playerInventory) {
        if (item.count <= 0) continue;
        buckets[categorizeItem(item.itemId)].push(item);
        totalItems += item.count;
        totalKinds += 1;
    }

    if (totalKinds === 0) {
        body.innerHTML =
            "<div style='color:#888; font-size:13px; line-height:1.6; padding:20px 4px;'>" +
            "You don't own any produce yet.<br><br>" +
            "<b style='color:#8f8;'>1.</b> Pick a plant from the <b style='color:#8f8;'>Plant ▾</b> button.<br>" +
            "<b style='color:#8f8;'>2.</b> Click somewhere on the ground (within ~15 voxels) to place a seed.<br>" +
            "<b style='color:#8f8;'>3.</b> Wait roughly one minute, then use <b style='color:#eedd44;'>Harvest</b> on the plant.<br><br>" +
            "Hunted <b style='color:#cc7a4a;'>Game Meat</b> also appears here.</div>";
        return;
    }

    let html = "";
    html += "<div style='display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;'>";
    html += "<span style='color:#aaa; font-size:11px;'>" + totalKinds + " kinds · " + totalItems + " items in stock</span>";
    html += "</div>";

    for (const cat of STATUS_CATEGORIES) {
        const items = buckets[cat.key];
        if (items.length === 0) continue;
        const catTotal = items.reduce((s, it) => s + it.count, 0);
        html += "<div style='margin-top:14px;'>";
        html += "<div style='display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; border-bottom:1px solid #2a4a2a; padding-bottom:4px;'>";
        html += "<span style='color:" + cat.color + "; font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px;'>" + cat.title + "</span>";
        html += "<span style='color:#666; font-size:11px;'>" + catTotal + " total</span>";
        html += "</div>";

        items.sort((a, b) => b.count - a.count);
        for (const item of items) {
            const info = ITEM_DB[item.itemId] || { name: "Item #" + item.itemId, color: "#aaa" };
            const price = priceOf(item.itemId);
            const nutr = nutritionOf(item.itemId);
            const sellAllTotal = price * item.count;
            html += "<div style='display:flex; align-items:center; gap:8px; padding:6px 4px; background:rgba(20,40,20,0.4); border-radius:6px; margin-bottom:4px;'>";
            html += "<span style='display:inline-block; width:14px; height:14px; border-radius:50%; background:" + info.color + "; flex-shrink:0; border:1px solid rgba(255,255,255,0.15);'></span>";
            html += "<span style='flex:1; color:#cfc; font-size:13px;'>" + info.name + "</span>";
            html += "<span style='color:#888; font-size:11px; min-width:36px; text-align:right;'>×" + item.count + "</span>";
            // Eat
            const eatDisabled = nutr <= 0;
            html += "<button class='prop-eat-btn' data-item='" + item.itemId + "' " + (eatDisabled ? "disabled" : "") + " title='" + (eatDisabled ? "Not edible" : ("Restores " + nutr + "% fullness")) + "' style='" +
                "background:" + (eatDisabled ? "#222" : "#2a5a2a") + "; color:" + (eatDisabled ? "#555" : "#cfc") + "; border:1px solid " + (eatDisabled ? "#333" : "#4a4") + "; border-radius:5px; padding:4px 10px; font-size:11px; cursor:" + (eatDisabled ? "not-allowed" : "pointer") + ";'>🍽 Eat</button>";
            // Sell 1
            const sellDisabled = price <= 0;
            html += "<button class='prop-sell-one-btn' data-item='" + item.itemId + "' " + (sellDisabled ? "disabled" : "") + " title='" + (sellDisabled ? "No market value" : ("Sell 1 for " + price + " FoFo")) + "' style='" +
                "background:" + (sellDisabled ? "#222" : "#3a2f0a") + "; color:" + (sellDisabled ? "#555" : "#ffd966") + "; border:1px solid " + (sellDisabled ? "#333" : "#c9a45a") + "; border-radius:5px; padding:4px 10px; font-size:11px; cursor:" + (sellDisabled ? "not-allowed" : "pointer") + ";'>🪙 Sell 1 (" + price + ")</button>";
            // Sell all
            html += "<button class='prop-sell-all-btn' data-item='" + item.itemId + "' data-count='" + item.count + "' " + (sellDisabled ? "disabled" : "") + " title='" + (sellDisabled ? "No market value" : ("Sell all for " + sellAllTotal + " FoFo")) + "' style='" +
                "background:" + (sellDisabled ? "#222" : "#2a230a") + "; color:" + (sellDisabled ? "#555" : "#ffd966") + "; border:1px solid " + (sellDisabled ? "#333" : "#8a7a3a") + "; border-radius:5px; padding:4px 10px; font-size:11px; cursor:" + (sellDisabled ? "not-allowed" : "pointer") + ";'>Sell all (" + sellAllTotal + ")</button>";
            html += "</div>";
        }
        html += "</div>";
    }
    body.innerHTML = html;

    // Wire button handlers.
    body.querySelectorAll(".prop-eat-btn").forEach(b => {
        b.addEventListener("click", () => {
            if (b.disabled) return;
            const id = parseInt(b.dataset.item);
            ws.send(buildActionMessage(encodeEatAction(id)));
        });
    });
    body.querySelectorAll(".prop-sell-one-btn").forEach(b => {
        b.addEventListener("click", () => {
            if (b.disabled) return;
            const id = parseInt(b.dataset.item);
            ws.send(buildActionMessage(encodeSellAction(id, 1)));
        });
    });
    body.querySelectorAll(".prop-sell-all-btn").forEach(b => {
        b.addEventListener("click", () => {
            if (b.disabled) return;
            const id = parseInt(b.dataset.item);
            const count = parseInt(b.dataset.count);
            ws.send(buildActionMessage(encodeSellAction(id, count)));
        });
    });
}

// --- Entity classification ---

function classifyEntity(kind, speciesId) {
    if (kind === "player") return "player";
    if (kind === "semi-ai") return "semi-ai";
    if (kind === "animal") {
        if (speciesId === 10) return "chicken";
        if (speciesId === 21) return "deer";
        if (speciesId === 22) return "boar";
        if (speciesId === 30) return "lamb";
        if (speciesId === 31) return "rabbit";
        return "animal";
    }
    if (kind === "npc") return "npc";
    if (kind === "structure") {
        if (speciesId === 1) return "hochsitz";
        return "hochsitz";
    }
    if (kind === "plant") {
        const PLANT_MAP = {
            100: "chestnut", 101: "walnut", 102: "carob", 103: "eucalyptus",
            104: "hazelnut", 105: "almond", 106: "corkoak", 107: "redwood",
            108: "macadamia", 109: "stonepine", 110: "pistachio", 111: "bamboo",
            112: "cherry",
            200: "fig", 201: "pomegranate", 202: "citrus", 203: "olive",
            204: "plum", 205: "avocado", 206: "mulberry", 207: "banana",
            208: "mango", 209: "persimmon", 210: "peach",
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
    1: 0x9a9590, // Stone (warm gray)
    2: 0x7a5533, // Soil (rich brown)
    3: 0x5a9a3a, // Grass (lush green)
    4: 0x3388bb, // Water (clear blue)
    5: 0xe8d4aa, // Sand (warm beige)
    6: 0xb58855, // Clay (terracotta)
    7: 0x5a4422, // Mulch (dark organic)
    8: 0x3388aa, // Swale (teal)
    9: 0x6a4422, // HugelBed
    10: 0x2a7a2a, // Canopy (forest green)
    11: 0xf0f0ff, // Snow (bright white-blue)
    12: 0xccddee, // Ice (pale blue)
    13: 0x1a4a7a, // Ocean (deep blue)
    14: 0xa09888, // Gravel (warm taupe)
    15: 0x9a4a2a, // RedSoil (warm terra)
};

function renderTerrain(terrainData) {
    if (terrainGroup) {
        scene.remove(terrainGroup);
    }
    terrainGroup = new THREE.Group();
    // The water/grass shader materials lived inside the old terrainGroup.
    // Reset their drive arrays so we don't keep updating disposed-but-
    // still-referenced ShaderMaterials. (waterMeshes too — same scope.)
    waterMaterials.length = 0;
    grassMaterials.length = 0;
    waterMeshes.length = 0;
    // The old grass tufts belonged to the disposed terrainGroup.
    grassTuftMesh = null;
    grassTuftData = null;

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
        const useVariation = (matInt === 1 || matInt === 2 || matInt === 3 || matInt === 5 || matInt === 6 || matInt === 14 || matInt === 15);

        // Per-material roughness for natural look
        const roughnessMap = { 1: 0.95, 2: 0.92, 3: 0.88, 4: 0.15, 5: 0.85, 6: 0.9, 7: 0.95, 8: 0.2, 9: 0.93, 10: 0.85, 11: 0.7, 12: 0.3, 13: 0.1, 14: 0.93, 15: 0.9 };
        const material = new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: roughnessMap[matInt] || 0.85,
            metalness: (matInt === 4 || matInt === 13 || matInt === 12) ? 0.15 : 0.0,
        });

        if (matInt === 4 || matInt === 8 || matInt === 13) {
            material.transparent = true;
            material.opacity = 0.7;
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

    // Wildflowers scattered on grass
    const grassPositions = voxelsByMat[3];
    if (grassPositions && grassPositions.length > 0) {
        const flowerColors = [0xff6688, 0xffaa44, 0xeedd55, 0xffffff, 0xcc88ee, 0xff4466, 0x88ccff];
        const flowerGeo = new THREE.SphereGeometry(0.06, 4, 3);
        const stemGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.25, 3);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 0.9 });
        const grassCount = grassPositions.length / 3;
        let flowerIdx = 0;
        const maxFlowers = Math.min(800, Math.floor(grassCount * 0.03));
        const flowerGroup = new THREE.Group();
        for (let v = 0; v < grassCount && flowerIdx < maxFlowers; v++) {
            const fx = grassPositions[v * 3];
            const fy = grassPositions[v * 3 + 1];
            const fz = grassPositions[v * 3 + 2];
            if (!isAir(fx, fy + 1, fz)) continue;
            const h = (fx * 97 + fz * 53 + fy * 31) & 0xFF;
            if (h > 12) continue;
            const fc = flowerColors[h % flowerColors.length];
            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.set(fx + (h % 10) / 10 - 0.5, fy + 0.62, fz + ((h * 3) % 10) / 10 - 0.5);
            flowerGroup.add(stem);
            const petal = new THREE.Mesh(flowerGeo, new THREE.MeshStandardMaterial({ color: fc, roughness: 0.6 }));
            petal.position.set(stem.position.x, stem.position.y + 0.15, stem.position.z);
            flowerGroup.add(petal);
            flowerIdx++;
        }
        terrainGroup.add(flowerGroup);

        // ── Grass tufts ──────────────────────────────────────────────
        // Cross-pair of small textured planes per tuft, scattered on
        // grass surface voxels. Rendered as a single InstancedMesh so
        // ~1.5 k tufts stay cheap (one draw call, shared geometry).
        // Sway is added in the vertex shader via `time` and per-vertex
        // y-coordinate so blade tops swing while roots stay anchored.
        const tuftCanvas = document.createElement("canvas");
        tuftCanvas.width = 32; tuftCanvas.height = 64;
        const tctx = tuftCanvas.getContext("2d");
        // Faded gradient blade silhouette as an alpha texture.
        const tg = tctx.createLinearGradient(0, 0, 0, 64);
        tg.addColorStop(0,    "rgba(120,200,90,0.0)");
        tg.addColorStop(0.10, "rgba(140,210,100,0.85)");
        tg.addColorStop(0.55, "rgba(110,170,80,0.95)");
        tg.addColorStop(1,    "rgba(60,110,40,0.98)");
        tctx.fillStyle = tg;
        // Three thin tapered blades on one plane to fake density.
        const blades = [[6, 26], [14, 22], [22, 28]];
        for (const [cx, w] of blades) {
            tctx.beginPath();
            tctx.moveTo(cx, 64);
            tctx.quadraticCurveTo(cx - w / 2, 32, cx + (cx === 14 ? 0 : (cx < 16 ? -2 : 2)), 0);
            tctx.quadraticCurveTo(cx + w / 2, 32, cx, 64);
            tctx.closePath();
            tctx.fill();
        }
        const tuftTex = new THREE.CanvasTexture(tuftCanvas);
        tuftTex.colorSpace = THREE.SRGBColorSpace;

        const tuftMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                map:  { value: tuftTex },
                time: { value: 0 },
                tint: { value: new THREE.Color(0xa0c478) },
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vSway;
                uniform float time;
                void main() {
                    vUv = uv;
                    // Sway scales with height in the plane (uv.y near 0
                    // is the tip in our texture — flip via 1.0-uv.y).
                    float h = 1.0 - uv.y;
                    vec3 p = position;
                    float a = time * 1.8 + (instanceMatrix[3].x + instanceMatrix[3].z) * 0.35;
                    float sway = sin(a) * 0.08 + sin(a * 0.7) * 0.04;
                    p.x += sway * h;
                    p.z += sway * h * 0.6;
                    vSway = h;
                    gl_Position = projectionMatrix * viewMatrix * instanceMatrix
                                * vec4(p, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                varying float vSway;
                uniform sampler2D map;
                uniform vec3 tint;
                void main() {
                    vec4 tex = texture2D(map, vUv);
                    if (tex.a < 0.18) discard;
                    // Slight gradient: tips brighter, roots darker.
                    vec3 col = tex.rgb * tint * (0.85 + 0.25 * (1.0 - vSway));
                    gl_FragColor = vec4(col, tex.a);
                }
            `,
        });

        // Plane is 1 m tall; we offset it so the bottom sits on the
        // ground and the top reaches ~0.9 m.
        const bladeGeo = new THREE.PlaneGeometry(0.7, 1.0);
        bladeGeo.translate(0, 0.5, 0);

        // Cap count so we don't pay for a tuft on every grass voxel
        // (3000+ on full maps is too dense). Sample every Nth.
        const maxTufts = Math.min(2500, Math.floor(grassCount * 0.55));
        const sampleStride = Math.max(1, Math.floor(grassCount / maxTufts));
        const tufts = new THREE.InstancedMesh(bladeGeo, tuftMat, maxTufts);
        tufts.frustumCulled = false;
        tufts.castShadow = false;
        tufts.receiveShadow = false;

        const m4 = new THREE.Matrix4();
        const q  = new THREE.Quaternion();
        const s  = new THREE.Vector3();
        const p  = new THREE.Vector3();
        const tuftPos = [];
        const tuftBase = [];
        let tIdx = 0;
        for (let v = 0; v < grassCount && tIdx < maxTufts; v += sampleStride) {
            const fx = grassPositions[v * 3];
            const fy = grassPositions[v * 3 + 1];
            const fz = grassPositions[v * 3 + 2];
            if (!isAir(fx, fy + 1, fz)) continue;
            const jitX = ((fx * 73 + fz * 19) % 100) / 100 - 0.5;
            const jitZ = ((fz * 97 + fx * 31) % 100) / 100 - 0.5;
            // Voxels are unit cubes CENTRED on their grid coord, so the
            // grass voxel's top surface is at fy + 0.5. The blade geometry
            // is anchored at its base, so place the base exactly there —
            // grass sits ON the ground, not floating above it.
            p.set(fx + jitX * 0.8, fy + 0.5, fz + jitZ * 0.8);
            // Random Y rotation so neighbouring tufts don't line up.
            const rot = ((fx * 13 + fz * 7) & 0xff) / 255 * Math.PI;
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
            // Slight scale jitter for variety.
            const scaleH = 0.7 + (((fx + fz) * 11) % 50) / 100; // 0.7..1.2
            s.set(scaleH * 0.9, scaleH, scaleH * 0.9);
            m4.compose(p, q, s);
            tufts.setMatrixAt(tIdx, m4);
            tuftPos.push({ x: p.x, z: p.z });
            tuftBase.push(m4.clone());
            tIdx++;
        }
        tufts.count = tIdx;
        tufts.instanceMatrix.needsUpdate = true;
        // Stash on the terrainGroup so the next terrain rebuild disposes it.
        terrainGroup.add(tufts);
        // And track so updateGrass() can drive the time uniform.
        grassMaterials.push(tuftMat);
        // Track for the fire pass (grass burns away near flames).
        grassTuftMesh = tufts;
        grassTuftData = { pos: tuftPos, base: tuftBase, hidden: new Array(tIdx).fill(false) };
    }

    // Butterflies (animated in render loop)
    if (typeof butterflyGroup !== "undefined" && butterflyGroup) scene.remove(butterflyGroup);
    butterflyGroup = new THREE.Group();
    const butterflyColors = [0xffaa44, 0xff6688, 0xeeff66, 0xffffff, 0x88bbff, 0xee88cc];
    for (let i = 0; i < 30; i++) {
        const bx = Math.random() * width;
        const bz = Math.random() * depth;
        const by = (heightMap[Math.floor(bz) * width + Math.floor(bx)] || 10) + 1.5 + Math.random() * 2;
        const bc = butterflyColors[i % butterflyColors.length];
        const wingGeo = new THREE.PlaneGeometry(0.2, 0.15);
        const wingMat = new THREE.MeshStandardMaterial({ color: bc, side: THREE.DoubleSide, roughness: 0.5 });
        const bfly = new THREE.Group();
        const wingL = new THREE.Mesh(wingGeo, wingMat);
        wingL.position.x = -0.08; wingL.rotation.y = 0.3; bfly.add(wingL);
        const wingR = new THREE.Mesh(wingGeo, wingMat);
        wingR.position.x = 0.08; wingR.rotation.y = -0.3; bfly.add(wingR);
        bfly.position.set(bx, by, bz);
        bfly.userData.baseY = by;
        bfly.userData.phase = Math.random() * Math.PI * 2;
        bfly.userData.speed = 0.5 + Math.random() * 0.8;
        bfly.userData.radius = 2 + Math.random() * 5;
        butterflyGroup.add(bfly);
    }
    scene.add(butterflyGroup);

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
        // Higher-resolution plane so the vertex-displacement waves
        // actually have something to bend; 8×8 is plenty for a 1×1 tile.
        const waterGeo = new THREE.PlaneGeometry(1, 1, 8, 8);
        waterGeo.rotateX(-Math.PI / 2);
        const shallowMat = buildWaterMaterial({
            shallow: new THREE.Color(0x4aa6d8),
            deep:    new THREE.Color(0x1a4a78),
            opacity: 0.78,
        });
        const deepMat = buildWaterMaterial({
            shallow: new THREE.Color(0x1a6298),
            deep:    new THREE.Color(0x062040),
            opacity: 0.88,
        });
        waterMaterials.push(shallowMat, deepMat);
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

    // Extended ground plane beyond voxel terrain
    const groundSize = 2400;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 64, 64);
    groundGeo.rotateX(-Math.PI / 2);
    const verts = groundGeo.attributes.position.array;
    for (let i = 0; i < verts.length; i += 3) {
        const gx = verts[i] + width / 2;
        const gz = verts[i + 2] + depth / 2;
        const isInside = gx >= 0 && gx < width && gz >= 0 && gz < depth;
        if (isInside) {
            const tx = Math.floor(Math.min(gx, width - 1));
            const tz = Math.floor(Math.min(gz, depth - 1));
            verts[i + 1] = heightMap[tz * width + tx] - 0.5;
        } else {
            const edgeDist = Math.max(
                Math.max(0, -gx), Math.max(0, gx - width),
                Math.max(0, -gz), Math.max(0, gz - depth)
            );
            verts[i + 1] = Math.max(-2, 6 - edgeDist * 0.02);
        }
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x5a8a3a, roughness: 0.95, metalness: 0,
        vertexColors: false,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(width / 2, 0, depth / 2);
    groundMesh.receiveShadow = true;
    terrainGroup.add(groundMesh);

    // Distant ocean plane
    const oceanGeo = new THREE.PlaneGeometry(6000, 6000);
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMat = new THREE.MeshStandardMaterial({
        color: 0x2266aa, roughness: 0.1, metalness: 0.2,
        transparent: true, opacity: 0.85,
    });
    const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.position.set(width / 2, 2.5, depth / 2);
    oceanMesh.receiveShadow = true;
    terrainGroup.add(oceanMesh);

    scene.add(terrainGroup);

    // Camera starts close to player spawn point (center of terrain)
    const cx = width / 2;
    const cz = depth / 2;
    camera.position.set(cx + 15, 20, cz + 15);
    controls.target.set(cx, 10, cz);
    controls.update();

    console.log("Terrain rendered: " + Object.entries(voxelsByMat).map(
        ([m, p]) => m + ":" + (p.length/3)
    ).join(", "));

    renderMinimap(width, depth, heightMap, surfaceMap);
}

const MINIMAP_COLORS = {
    1: [154,149,144], // Stone
    2: [122,85,51],   // Soil
    3: [90,154,58],   // Grass
    4: [51,136,187],  // Water
    5: [232,212,170], // Sand
    6: [181,136,85],  // Clay
    7: [90,68,34],    // Mulch
    8: [51,136,170],  // Swale
    9: [106,68,34],   // HugelBed
    10: [42,122,42],  // Canopy
    11: [240,240,255],// Snow
    12: [204,221,238],// Ice
    13: [26,74,122],  // Ocean
    14: [160,152,136],// Gravel
    15: [154,74,42],  // RedSoil
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

    // Update edge direction hints
    const hintsEl = document.getElementById("edge-hints");
    if (hintsEl) {
        hintsEl.style.display = "block";
        let currentCountryForHints = null;
        let regionInCountryForHints = 0;
        for (const c of WORLD_COUNTRIES) {
            if (selectedRegion >= c.start && selectedRegion < c.start + c.count) {
                currentCountryForHints = c;
                regionInCountryForHints = selectedRegion - c.start;
                break;
            }
        }
        if (currentCountryForHints) {
            const prevR = regionInCountryForHints > 0
                ? currentCountryForHints.regions[regionInCountryForHints - 1]
                : currentCountryForHints.regions[currentCountryForHints.count - 1];
            const nextR = regionInCountryForHints < currentCountryForHints.count - 1
                ? currentCountryForHints.regions[regionInCountryForHints + 1]
                : currentCountryForHints.regions[0];
            const cIdx = WORLD_COUNTRIES.indexOf(currentCountryForHints);
            const northC = WORLD_COUNTRIES[(cIdx - 1 + WORLD_COUNTRIES.length) % WORLD_COUNTRIES.length];
            const southC = WORLD_COUNTRIES[(cIdx + 1) % WORLD_COUNTRIES.length];
            document.getElementById("hint-west").textContent = prevR;
            document.getElementById("hint-east").textContent = nextR;
            document.getElementById("hint-north").textContent = northC.name;
            document.getElementById("hint-south").textContent = southC.name;
        }
    }

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

// Mirror of ff-common::TRAVEL_COST. If you change the server-side
// constant, change this too; server is still authoritative.
const TRAVEL_COST = 25;

function refreshTravelCostUI() {
    const walletEl = document.getElementById("nav-cost-wallet");
    const amountEl = document.getElementById("nav-cost-amount");
    const btn = document.getElementById("nav-travel-btn");
    const line = document.getElementById("nav-cost-line");
    if (walletEl) walletEl.textContent = playerCoins;
    if (amountEl) amountEl.textContent = TRAVEL_COST;
    // Travelling to the region you're already in is a no-op (still
    // costs coins server-side — block that out client-side).
    const samePlace = (navSelectedRegion === selectedRegion);
    const canAfford = playerCoins >= TRAVEL_COST;
    if (btn) {
        const enabled = canAfford && !samePlace;
        btn.disabled = !enabled;
        btn.style.cursor = enabled ? "pointer" : "not-allowed";
        btn.style.opacity = enabled ? "1" : "0.5";
        btn.textContent = samePlace
            ? "Already here"
            : (canAfford ? "Travel" : "Not enough coin");
    }
    if (line) {
        line.style.color = canAfford ? "#ffd966" : "#ff9a6a";
    }
}

function openWorldNav() {
    if (document.pointerLockElement) document.exitPointerLock();

    navSelectedCountry = selectedCountryIdx;
    navSelectedRegion = selectedRegion;
    document.getElementById("world-nav-overlay").style.display = "flex";
    buildNavUI();
    drawNavMap();
    refreshTravelCostUI();
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
            refreshTravelCostUI();
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
            refreshTravelCostUI();
        });
        regionList.appendChild(btn);
    }
    // Same-place / not-enough-coin button text follows the current
    // navSelectedRegion, so refresh after the lists are rebuilt.
    refreshTravelCostUI();
}

function drawNavMap() {
    const canvas = document.getElementById("nav-world-canvas");
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;

    // Share the same offscreen base canvas as the connect-screen map
    // (built lazily by drawWorldMap if the connect screen hasn't been
    // shown yet — e.g. a deep-link straight into Travel to Region).
    if (!_worldMapBase) _worldMapBase = buildWorldMapBase(w, h);
    ctx.drawImage(_worldMapBase, 0, 0);

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
    // Belt-and-braces: button is also disabled in CSS when broke or
    // same-place, but block here too in case a stale click slipped
    // through.
    if (playerCoins < TRAVEL_COST) return;
    if (navSelectedRegion === selectedRegion) return;
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
    rebuildToolbar();

    // Clear current world state
    for (const [eid, obj] of entityMeshes) {
        scene.remove(obj);
    }
    entityMeshes.clear();
    entityKinds.clear();
    if (fishGroup) { scene.remove(fishGroup); fishGroup = null; }
    if (butterflyGroup) { scene.remove(butterflyGroup); butterflyGroup = null; }
    waterMeshes = [];

    // Reconnect with new region
    ws.close();
    const serverUrl = document.getElementById("server-url").value || "ws://localhost:9000";
    ws = new WebSocket(serverUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
        connected = true;
        // Travel reconnect — server restores persistent state (wallet
        // + inventory + Monarch role) minus TRAVEL_COST.
        ws.send(buildHelloMessage(playerName, selectedGameMode, regionIndex, plotSeed, selectedRole, true));
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
// `makeTree` is imported from ./models/trees/_tree.js (see top of file).
// All tree species — both the ones in the inline switch below AND the
// migrated ones in models/trees/<species>.js — share the same builder,
// so visual upgrades to it propagate everywhere automatically.

// ─── Entity model-template cache ──────────────────────────────────────────
// Building a fresh Group with dozens of geometries + materials every time
// an entity spawns is expensive — at 3000+ entities in the world this
// dominates frame time on join. Instead, the first time a category is
// requested we build it ONCE and stash it as a "template"; every
// subsequent spawn returns template.clone(), which creates fresh Mesh
// objects but SHARES the underlying geometry + material refs (Three's
// default clone behaviour). Per-instance state (position, scale,
// growth-stage visibility, flame effect children) is set on the clone
// in createOrUpdateEntity, so cached templates never get mutated.
//
// Caveats:
//   - The original factory has some random jitter (leaf scatter,
//     fruit positions). With caching, all instances of a species share
//     the same internal layout. That's a fair trade for the ~50× faster
//     spawn path; we can add a small per-instance rotation jitter later
//     if every walnut looking identical bothers us visually.
//   - Materials are shared. Do NOT mutate `obj.material.color` on a
//     clone — that would tint every instance. Use `obj.material =
//     obj.material.clone()` first if a per-instance recolour is needed.
const entityMeshTemplates = new Map();   // single template per category
const entityMeshVariants  = new Map();   // category → array of variant templates
const VARIANT_COUNT = 5;

// Categories that are NOT plants/trees — they keep a single canonical
// template (a chicken must always look like a chicken). Everything else
// (every tree + herb species) gets a small pool of randomised variant
// templates so no two walnuts are identical.
const NON_PLANT_CATEGORIES = new Set([
    "player", "semi-ai", "npc", "chicken", "deer", "boar", "rabbit",
    "lamb", "animal", "hochsitz", "structure", "item", "unknown",
    "fish", "butterfly",
]);
function isPlantLike(cat) { return !NON_PLANT_CATEGORIES.has(cat); }

// ── Outfits / wardrobe ───────────────────────────────────────────────
// Crafted garments change the avatar's appearance. Each def recolours
// the "shirt" + "pants" cloth meshes and optionally adds a decorative
// "outfit-extra" overlay (a tunic hem, a fur collar) so the garment
// reads clearly from third-person distance. Ids match the server's
// Outfit component: 0 default, 1 Linen Tunic, 2 Fur Coat.
const OUTFIT_DEFS = {
    0: { name: "Everyday Clothes", shirt: 0x5588bb, pants: 0x445566, extra: null },
    1: { name: "Linen Tunic",      shirt: 0xe8dcb6, pants: 0xb9a884, extra: "tunic" },
    2: { name: "Fur Coat",         shirt: 0x6e4a2c, pants: 0x4a3422, extra: "fur" },
};

function buildOutfitExtra(kind) {
    const grp = new THREE.Group();
    grp.name = "outfit-extra";
    if (kind === "tunic") {
        // A linen hem skirt flaring from the hips to mid-thigh.
        const mat = new THREE.MeshStandardMaterial({ color: 0xddcca0, roughness: 0.85 });
        const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.42, 10, 1, true), mat);
        hem.position.y = 0.74; hem.castShadow = true; grp.add(hem);
        // A simple rope belt.
        const belt = new THREE.Mesh(
            new THREE.TorusGeometry(0.235, 0.022, 6, 14),
            new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 }),
        );
        belt.position.y = 0.96; belt.rotation.x = Math.PI / 2; grp.add(belt);
    } else if (kind === "fur") {
        // A thick fur collar + shoulder mantle for a heavy winter coat.
        const fur = new THREE.MeshStandardMaterial({ color: 0x7a5638, roughness: 1.0 });
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.075, 7, 16), fur);
        collar.position.y = 1.3; collar.rotation.x = Math.PI / 2; collar.castShadow = true; grp.add(collar);
        const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.5, 12), fur);
        mantle.position.y = 1.05; mantle.castShadow = true; grp.add(mantle);
        // A few fur tufts on the shoulders for silhouette.
        for (const side of [-1, 1]) {
            const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), fur);
            tuft.position.set(side * 0.26, 1.22, 0); tuft.scale.set(1, 0.7, 1); grp.add(tuft);
        }
    }
    return grp;
}

// Apply (or refresh) a player avatar's outfit. Idempotent: recolours
// per-instance cloned cloth materials and rebuilds the overlay only if
// the outfit id actually changed, so repeated calls every batch update
// are cheap.
function applyOutfit(obj, outfitId) {
    if (!obj) return;
    const def = OUTFIT_DEFS[outfitId] || OUTFIT_DEFS[0];
    if (obj.userData.outfitApplied === outfitId) return;
    obj.userData.outfitApplied = outfitId;

    obj.traverse((m) => {
        if (!m.isMesh || !m.userData || !m.userData.cloth) return;
        // Clone the (shared) template material once so recolouring this
        // avatar doesn't tint every other player.
        if (!m.userData._ownMat) {
            m.material = m.material.clone();
            m.userData._ownMat = true;
        }
        const hex = m.userData.cloth === "pants" ? def.pants : def.shirt;
        m.material.color.setHex(hex);
    });

    // Swap the decorative overlay.
    const old = obj.getObjectByName ? obj.getObjectByName("outfit-extra") : null;
    if (old) { old.parent.remove(old); old.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }
    if (def.extra) obj.add(buildOutfitExtra(def.extra));
}

function createEntityMesh(category) {
    if (isPlantLike(category)) {
        // Variant pool: each buildEntityMeshTemplate() call re-runs the
        // species' random branch/leaf generator, so the pool naturally
        // contains differently-shaped individuals. We grow it lazily up
        // to VARIANT_COUNT, then clone a random member per spawn.
        let pool = entityMeshVariants.get(category);
        if (!pool) { pool = []; entityMeshVariants.set(category, pool); }
        if (pool.length < VARIANT_COUNT) {
            pool.push(buildEntityMeshTemplate(category));
        }
        const pick = pool[(Math.random() * pool.length) | 0];
        return pick.clone(true);
    }
    let template = entityMeshTemplates.get(category);
    if (!template) {
        template = buildEntityMeshTemplate(category);
        entityMeshTemplates.set(category, template);
    }
    // Object3D.clone(recursive = true) — clones the hierarchy and
    // makes new Mesh objects, but shares geometry + material refs.
    return template.clone(true);
}

function buildEntityMeshTemplate(category) {
    // Modular registry first: species migrated to their own files in
    // ./models/ short-circuit the inline switch below.
    const ext = MODEL_BUILDERS[category];
    if (ext) return ext();

    // No template registered for this category — return a small
    // gray fallback sphere so the entity at least appears in-world.
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa })
    );
    mesh.position.y = 0.3;
    return mesh;
}

// Growth stage scale factors: Seed=0, Germinating=1, Seedling=2, Juvenile=3, Mature=4, Fruiting=5
// Per-growth-stage mesh scale. Seed/Germinating are bumped up from a
// near-invisible 0.1 so a freshly-planted seed is clearly visible (a
// small sprout) and then visibly grows as the server advances stages.
// Stages: Seed, Germinating, Seedling, Juvenile, Mature, Fruiting, Dormant, Dead.
const GROWTH_SCALES = [0.28, 0.38, 0.52, 0.72, 1.0, 1.0, 0.9, 0.0];

// Categories that should idle-bob (subtle Y oscillation) and lean
// forward slightly when moving. Plants/structures stay still.
const ANIMATED_CATEGORIES = new Set([
    "deer", "chicken", "boar", "rabbit", "lamb", "animal",
    "player", "semi-ai", "npc",
]);

function createOrUpdateEntity(eid, x, y, z, rot, category) {
    let obj = entityMeshes.get(eid);

    if (!obj) {
        obj = createEntityMesh(category);
        obj.userData.entityId = eid;
        obj.userData.category = category;
        // Stable per-entity phase so neighbours don't bob in unison.
        obj.userData.bobPhase = (eid % 100) * 0.13;
        // Initial spawn: place directly at server position.
        obj.position.set(x, y, z);
        obj.userData.basePos = new THREE.Vector3(x, y, z);
        obj.userData.targetPos = new THREE.Vector3(x, y, z);
        obj.userData.targetRot = rot;
        obj.userData.lastTargetMs = performance.now();
        if (obj.rotation) obj.rotation.y = rot;
        // Per-instance variation for plants/trees: a random heading, a
        // size multiplier, and a slight natural lean — so even two
        // clones of the same variant template read as distinct trees.
        if (isPlantLike(category)) {
            obj.rotation.y = Math.random() * Math.PI * 2;
            obj.rotation.x = (Math.random() - 0.5) * 0.10;   // gentle lean
            obj.rotation.z = (Math.random() - 0.5) * 0.10;
            obj.userData.scaleVar = 0.82 + Math.random() * 0.40; // 0.82–1.22
        }
        scene.add(obj);
        entityMeshes.set(eid, obj);
    } else {
        // Subsequent update: stash a NEW target. The animation loop in
        // updateEntityAnimations() smoothly drives current → target,
        // so entities glide between server ticks instead of teleporting.
        obj.userData.targetPos.set(x, y, z);
        obj.userData.targetRot = rot;
        obj.userData.lastTargetMs = performance.now();
    }

    // Scale plants by growth stage, and toggle fruit ripeness.
    // GrowthStage discriminants (from ff-ecs plant component):
    //   0 Seed · 1 Germinating · 2 Seedling · 3 Juvenile
    //   4 Mature · 5 Fruiting · 6 Withering · 7 Dead
    // Tree templates can carry a "fruits" group with two named
    // children: "fruits-unripe" (small + green-ish) and "fruits-ripe"
    // (full size + species colour). At Mature the unripe variant is
    // shown so the player sees fruit forming; at Fruiting the ripe
    // variant takes its place. No emissive glow — the colour change
    // alone signals ripeness, like a real orchard.
    const info = entityKinds.get(eid);
    if (info && info.kind === "plant" && info.growthStage !== undefined) {
        const v = obj.userData.scaleVar || 1.0;   // per-instance size variation
        const s = (GROWTH_SCALES[info.growthStage] || 1.0) * v;
        obj.scale.set(s, s, s);
        const fruitsGroup = obj.getObjectByName ? obj.getObjectByName("fruits") : null;
        if (fruitsGroup) {
            const stage = info.growthStage;
            const showAnyFruit = (stage === 4 || stage === 5);
            fruitsGroup.visible = showAnyFruit;
            const unripe = fruitsGroup.getObjectByName("fruits-unripe");
            const ripe   = fruitsGroup.getObjectByName("fruits-ripe");
            if (unripe) unripe.visible = (stage === 4);
            if (ripe)   ripe.visible   = (stage === 5);
        }
    }

    // Dress player avatars in their crafted outfit (server sends the
    // outfit id in every EntitySnapshot, stored on the entityKinds rec).
    if (info && info.kind === "player") {
        applyOutfit(obj, info.outfit || 0);
    }

    // Track own player for camera. In first-person the own avatar is
    // hidden (you see the viewmodel hand instead); in third-person it
    // becomes visible so you watch your whole body — important for
    // multiplayer presence and the hunt. Other clients always see the
    // full body (their copy is a separate cloned template).
    if (eid === myEntityId) {
        obj.visible = !!fp.thirdPerson;
    }
}

// Per-frame entity animation pass — runs from gameLoop.
//   - Smoothly lerps every entity toward its server-provided target,
//     so movement between 10 Hz batch updates feels continuous.
//   - For animal/player/drone categories, adds a low-amplitude vertical
//     bob whose speed grows with movement (idle = slow breathing,
//     walking = quicker stride).
//   - Yaw is lerped via the shorter angular path so 359°→1° doesn't
//     spin the whole way round.
// ANIMAL_GAITS → ./data/gaits.js (imported at top)

const _tmpVec = new THREE.Vector3();
function updateEntityAnimations(dt, nowSec) {
    if (entityMeshes.size === 0) return;
    // Critically-damped framerate-independent lerp: reach ~95% of target
    // in ~100 ms (matching the server's NET_SEND_INTERVAL).
    const posBlend = 1 - Math.pow(0.001, dt);
    const rotBlend = 1 - Math.pow(0.0005, dt);
    for (const obj of entityMeshes.values()) {
        const u = obj.userData;
        if (!u || !u.targetPos) continue;

        // Distance to target — drives bob speed for animated species.
        const dx = u.targetPos.x - obj.position.x;
        const dz = u.targetPos.z - obj.position.z;
        const speed2 = dx * dx + dz * dz;

        // Position lerp toward target.
        _tmpVec.subVectors(u.targetPos, obj.position).multiplyScalar(posBlend);
        obj.position.add(_tmpVec);

        const animated = ANIMATED_CATEGORIES.has(u.category);

        // Yaw lerp along the shorter arc — only for animated entities
        // (animals/players/drones face their heading). Plants/trees keep
        // the random heading we gave them at spawn, so we must NOT lerp
        // their yaw back toward the server's (meaningless) rotation.
        if (animated && obj.rotation && typeof u.targetRot === "number") {
            const cur = obj.rotation.y;
            let diff = ((u.targetRot - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
            if (diff < -Math.PI) diff += Math.PI * 2;
            obj.rotation.y = cur + diff * rotBlend;
        }

        // Species-specific gait. Skipped for the local player (the
        // first-person camera tracks this entity, so bob would induce
        // motion sickness).
        if (animated && u.entityId !== myEntityId) {
            const g = ANIMAL_GAITS[u.category] || ANIMAL_GAITS.animal;
            const moving = speed2 > 0.001;
            const phase = u.bobPhase || 0;
            const t = nowSec * g.speed + phase;

            // Vertical breathing / stride bob.
            let dy = Math.sin(t) * (moving ? g.moveAmp : g.idleAmp);

            // Hop: arc-jumps while moving (rabbits, lambs).
            if (g.hop > 0 && moving) {
                const hp = Math.sin(nowSec * (g.speed * 0.55) + phase);
                dy += Math.max(0, hp) * g.hop;
            }
            // Drone hover: float gently above the ground, never grazes.
            if (g.hover) dy = 0.05 + Math.sin(nowSec * 1.6 + phase) * 0.06;
            obj.position.y += dy;

            // Sway: side-to-side roll (boar waddle, chicken bustle).
            if (g.sway > 0) {
                obj.rotation.z = Math.sin(t * 0.5) * g.sway;
            }

            // Pitch: lean forward into a stride, plus periodic head-down
            // grazing / pecking / rooting bouts when idle. The pulse
            // spikes only when sin clears a threshold → discrete dips
            // rather than a constant nod.
            let pitch = moving ? -0.05 : 0;
            if (g.grazeAmt > 0 && !moving) {
                const pulse = Math.max(0, Math.sin(nowSec * g.grazeRate + phase * 2) - 0.6) * 2.5;
                pitch -= g.grazeAmt * Math.min(1, pulse);
            }
            obj.rotation.x = (obj.rotation.x || 0) + (pitch - (obj.rotation.x || 0)) * 0.15;
        }
    }
}

// --- Click interaction ---

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onWorldClick(event) {
    if (!connected) return;
    if (!selectedAction) return;

    // Deploy Breakthrough is global (not aimed at anything).
    if (selectedAction === "deploy-breakthrough") {
        // The breakthrough kind must match the active catastrophe.
        // catastrophe.kind is 1..=5; breakthrough kind is 0..=4 (offset
        // by one). Server rejects mismatches with a clear message.
        const kind = activeCatastrophe.kind > 0 ? (activeCatastrophe.kind - 1) : 0;
        ws.send(buildActionMessage(encodeDeployBreakthroughAction(kind)));
        triggerToolSwing();
        return;
    }

    // Drag-to-look means the cursor is visible — raycast from the exact
    // point the player clicked, so they target the tree/tile under
    // their cursor (more intuitive than a fixed centre crosshair).
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
        // Innovator field study: research by examining living things in
        // the world. Clicking a plant/animal with a research topic
        // selected grants Knowledge in that topic — so the Innovator
        // explores the ecosystem instead of button-mashing.
        if (eid && selectedAction.startsWith("research-")) {
            const info = entityKinds.get(eid);
            const cat = info ? info.kind : "";
            if (cat === "plant" || cat === "animal" || cat === "tree") {
                const topic = parseInt(selectedAction.split("-")[1], 10) || 0;
                ws.send(buildActionMessage(encodeResearchAction(topic)));
                triggerToolSwing();
            } else {
                flashHint("Study a plant, tree, or animal to research it.");
            }
            return;
        }
        if (eid && selectedAction === "harvest") {
            ws.send(buildActionMessage(encodeHarvestAction(eid)));
            triggerToolSwing();
            return;
        }
        if (eid && selectedAction === "cut-tree") {
            ws.send(buildActionMessage(encodeCutTreeAction(eid)));
            triggerToolSwing();
            return;
        }
        if (eid && selectedAction === "hunt") {
            ws.send(buildActionMessage(encodeHuntAction(eid)));
            triggerToolSwing();
            return;
        }
        if (eid && selectedAction === "inspect") {
            ws.send(buildActionMessage(encodeInspectAction(eid)));
            // Inspect is a read-only query — no camera punch, keeps
            // the player in their exploration view.
            return;
        }
    }

    // Research aimed at empty ground (no entity studied) — nudge the
    // Innovator to study a living thing instead.
    if (selectedAction.startsWith("research-")) {
        flashHint("Study a plant, tree, or animal — aim at one and click.");
        return;
    }

    // Hit terrain — plant/build at that position
    if (terrainGroup) {
        const terrainHits = raycaster.intersectObject(terrainGroup, true);
        if (terrainHits.length > 0) {
            const point = terrainHits[0].point;
            const ix = Math.round(point.x);
            const iy = Math.round(point.y);
            const iz = Math.round(point.z);

            let dispatched = false;
            if (selectedAction.startsWith("plant-")) {
                const country = getCountryForRegion(selectedRegion);
                const plants = COUNTRY_PLANTS[country] || COUNTRY_PLANTS["Portugal"];
                const found = plants.find(p => p.action === selectedAction);
                const sid = found ? found.sid : 100;
                ws.send(buildActionMessage(encodePlantAction(sid, ix, iy, iz)));
                dispatched = true;
            } else if (selectedAction === "water") {
                ws.send(buildActionMessage(encodeWaterAction(ix, iy, iz)));
                dispatched = true;
            } else if (selectedAction === "build-swale") {
                ws.send(buildActionMessage(encodeSwaleAction(ix, iy, iz)));
                dispatched = true;
            } else if (selectedAction === "build-hugel") {
                ws.send(buildActionMessage(encodeHugelAction(ix, iy, iz)));
                dispatched = true;
            } else if (selectedAction === "build-hochsitz") {
                ws.send(buildActionMessage(encodeHochsitzAction(ix, iy, iz)));
                dispatched = true;
            } else if (selectedAction === "deploy-ai") {
                ws.send(buildActionMessage(encodeDeployAIAction(ix, iy, iz)));
                dispatched = true;
            }
            if (dispatched) {
                triggerToolSwing();
            }
        }
    }
}

// ActionKind encoders → ./net/messages.js (imported at top)

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
    // Toggle first/third-person camera. V (common) or F5 (Minecraft-style).
    const typing = document.activeElement &&
        (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
    if (!typing && (e.code === "KeyV" || e.code === "F5")) {
        setCameraMode(!fp.thirdPerson);
        e.preventDefault();
    }
});

// Switch camera mode and immediately reconcile avatar / viewmodel
// visibility so there's no one-frame flash. updateFirstPerson() then
// keeps them in sync every frame.
function setCameraMode(thirdPerson) {
    fp.thirdPerson = !!thirdPerson;
    const playerObj = myEntityId && entityMeshes.get(myEntityId);
    if (playerObj) playerObj.visible = fp.thirdPerson;
    if (fp.viewmodel) fp.viewmodel.visible = !fp.thirdPerson;
    if (typeof showToast === "function") {
        showToast("🎥 Camera", fp.thirdPerson ? "Third-person — see your whole body" : "First-person view");
    }
}

document.addEventListener("keyup", (e) => keys.delete(e.code));

let wasMoving = false;

function sendInput() {
    if (!connected) return;

    const chatInput = document.getElementById("chat-input");
    if (document.activeElement === chatInput) return;

    // First-person input model:
    //   W / S → forward / back in camera-local Z
    //   A / D → strafe left / right in camera-local X
    // We rotate the local vector by fp.yaw to express it in world
    // coordinates (which is what the server expects: vel.x = move[0],
    // vel.z = move[1]).
    const localForward = (keys.has("KeyW") || keys.has("ArrowUp"))   ? 1 : 0;
    const localBack    = (keys.has("KeyS") || keys.has("ArrowDown")) ? 1 : 0;
    const localLeft    = (keys.has("KeyA") || keys.has("ArrowLeft")) ? 1 : 0;
    const localRight   = (keys.has("KeyD") || keys.has("ArrowRight"))? 1 : 0;
    const lz = localBack - localForward; // +1 = back, -1 = forward
    const lx = localRight - localLeft;   // +1 = right

    let mx = 0, mz = 0;
    if (lx !== 0 || lz !== 0) {
        // Camera forward at yaw=0 is (0,0,-1).
        //   forward_world = (-sin yaw, 0, -cos yaw)
        //   right_world   = ( cos yaw, 0, -sin yaw)
        // World velocity = (-lz)·forward_world + lx·right_world
        // (lz=+1 means S = backward, so we negate to get forward.)
        const s = Math.sin(fp.yaw), c = Math.cos(fp.yaw);
        mx = lz * s + lx * c;     // = -lz·(-sin) + lx·cos
        mz = lz * c - lx * s;     // = -lz·(-cos) + lx·(-sin)
        const len = Math.sqrt(mx * mx + mz * mz);
        if (len > 0) { mx /= len; mz /= len; }
    }

    const jump = keys.has("Space");
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const yaw = fp.yaw;

    const isMoving = mx !== 0 || mz !== 0 || jump;
    // Send whenever moving, OR yaw changed by more than ~3° since
    // last send (so other players see us look around even while
    // standing still). Falling-edge send keeps the server in sync
    // when the player stops.
    const yawDelta = Math.abs(yaw - fp.lastSentYaw);
    if (!isMoving && !wasMoving && yawDelta < 0.05) return;
    wasMoving = isMoving;
    fp.lastSentYaw = yaw;

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
    // Drive the shader-based water material's time uniform every frame
    // so vertex-displacement waves and the moving normal noise animate.
    for (const mat of waterMaterials) {
        if (mat && mat.uniforms && mat.uniforms.time) {
            mat.uniforms.time.value = time;
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

    if (butterflyGroup) {
        for (const bfly of butterflyGroup.children) {
            if (!bfly.userData.speed) continue;
            const t = time * bfly.userData.speed + bfly.userData.phase;
            bfly.position.x += Math.sin(t * 1.3) * 0.02;
            bfly.position.z += Math.cos(t * 0.9) * 0.02;
            bfly.position.y = bfly.userData.baseY + Math.sin(t * 2) * 0.4;
            bfly.rotation.y = t;
            if (bfly.children.length >= 2) {
                const wingFlap = Math.sin(time * 12 + bfly.userData.phase) * 0.8;
                bfly.children[0].rotation.y = 0.3 + wingFlap;
                bfly.children[1].rotation.y = -0.3 - wingFlap;
            }
        }
    }
}

// --- Edge-of-world region transition ---

let edgeTransitionCooldown = 0;

function checkEdgeTransition() {
    if (!terrainMeta || !connected) return;
    if (edgeTransitionCooldown > 0) { edgeTransitionCooldown--; return; }

    const obj = entityMeshes.get(myEntityId);
    if (!obj) return;

    const px = obj.position.x;
    const pz = obj.position.z;
    const margin = 5;
    const w = terrainMeta.width;
    const d = terrainMeta.depth;

    let nextRegion = -1;

    // Find current country to get region list
    let currentCountry = null;
    let regionInCountry = 0;
    for (const c of WORLD_COUNTRIES) {
        if (selectedRegion >= c.start && selectedRegion < c.start + c.count) {
            currentCountry = c;
            regionInCountry = selectedRegion - c.start;
            break;
        }
    }
    if (!currentCountry) return;

    // Walking to edge transitions to next/prev region in the same country
    if (px < margin) {
        nextRegion = (regionInCountry > 0)
            ? currentCountry.start + regionInCountry - 1
            : currentCountry.start + currentCountry.count - 1;
    } else if (px > w - margin) {
        nextRegion = (regionInCountry < currentCountry.count - 1)
            ? currentCountry.start + regionInCountry + 1
            : currentCountry.start;
    } else if (pz < margin) {
        // North edge: go to previous country
        const cIdx = WORLD_COUNTRIES.indexOf(currentCountry);
        const prevC = WORLD_COUNTRIES[(cIdx - 1 + WORLD_COUNTRIES.length) % WORLD_COUNTRIES.length];
        nextRegion = prevC.start;
    } else if (pz > d - margin) {
        // South edge: go to next country
        const cIdx = WORLD_COUNTRIES.indexOf(currentCountry);
        const nextC = WORLD_COUNTRIES[(cIdx + 1) % WORLD_COUNTRIES.length];
        nextRegion = nextC.start;
    }

    if (nextRegion >= 0 && nextRegion !== selectedRegion) {
        edgeTransitionCooldown = 120; // 2 seconds at 60fps
        travelToRegion(nextRegion, selectedPlotSeed);
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
    updateGrass(now / 1000);
    updateGrassFire(dt);
    updateEntityAnimations(dt, now / 1000);
    updateFirstPerson(dt);
    checkEdgeTransition();
    minimapTimer += dt;
    if (minimapTimer >= 0.2) {
        minimapTimer = 0;
        updateMinimapPlayer();
    }

    if (controls) controls.update();
    updateSky(dt);
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function updateStatus(text) {
    document.getElementById("status").textContent = text;
}

// Transient centre-screen toast for soft guidance ("study a plant…").
let _hintTimer = null;
function flashHint(text) {
    let el = document.getElementById("flash-hint");
    if (!el) {
        el = document.createElement("div");
        el.id = "flash-hint";
        el.style.cssText = [
            "position:fixed", "top:38%", "left:50%", "transform:translateX(-50%)",
            "padding:8px 16px", "background:rgba(20,20,30,0.82)", "color:#dde",
            "border:1px solid rgba(180,200,220,0.3)", "border-radius:8px",
            "font:13px system-ui, sans-serif", "z-index:300", "pointer-events:none",
            "transition:opacity 0.3s ease",
        ].join(";");
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = "1";
    if (_hintTimer) clearTimeout(_hintTimer);
    _hintTimer = setTimeout(() => { el.style.opacity = "0"; }, 1800);
}

// Ambient music synth → ./audio/music.js (startAmbientMusic imported at top)

// Start music on first user interaction (browser autoplay policy)
document.addEventListener("click", () => startAmbientMusic(), { once: true });
document.addEventListener("keydown", () => startAmbientMusic(), { once: true });

// --- Periodic knowledge tips in chat ---

const GENERAL_TIPS = [
    "Food forests mimic natural woodland ecosystems to produce food, medicine, and materials sustainably.",
    "A food forest has 7 layers: canopy, understory, shrub, herbaceous, ground cover, vine, and root.",
    "Unlike conventional farming, food forests improve soil health over time through natural nutrient cycling.",
    "Companion planting: nitrogen-fixing trees like carob enrich soil for neighboring fruit trees.",
    "Mulching with leaf litter retains moisture, suppresses weeds, and feeds beneficial soil organisms.",
    "Food forests require less maintenance as they mature. The ecosystem becomes self-regulating.",
    "Swales capture rainwater and direct it to tree roots, reducing irrigation needs by up to 80%.",
    "Hugel beds (hugelkultur) are raised beds built over decomposing wood, creating a slow-release nutrient source.",
    "Mycorrhizal fungi form underground networks connecting trees, sharing water and nutrients across the forest.",
    "Pollinator corridors: planting lavender and rosemary between fruit trees dramatically increases yields.",
    "Food forests sequester 5-10 times more carbon per hectare than conventional agriculture.",
    "Sheet mulching with cardboard and compost converts lawn to food forest without tilling.",
    "Guild planting groups mutually beneficial species: a fruit tree, nitrogen fixer, mulch plant, and pest repellent.",
    "Deep-rooted plants like comfrey act as dynamic accumulators, mining minerals from subsoil for surface plants.",
    "A mature food forest can produce 10-20 times more food per hectare than a monoculture farm.",
];

const PEACEFUL_TIPS = [
    "Take a moment to look around. The butterflies dancing over the meadow are enjoying the same sun you are.",
    "Every tree you plant today is a gift to the future. In a few seasons it will bear fruit for you.",
    "Notice the wildflowers among the grass. Nature fills every space with beauty when we let it.",
    "Your food forest grows while you rest. Come back tomorrow and see how much has changed.",
    "Lavender attracts bees and calms the mind. Plant some near your favorite resting spot.",
    "The gentle sound of wind through leaves is one of nature's oldest lullabies.",
    "A food forest is a garden that takes care of itself. You are its gentle guide, not its master.",
    "Walking through your forest, notice how the light filters through the canopy. Each tree tells a story.",
    "Harvest when the fruit is ripe. There is no rush. Nature has its own perfect timing.",
    "Comfrey leaves make the richest mulch. Chop them and let them nourish the soil around your trees.",
    "Sit by the water and watch the fish. Even a moment of stillness restores the spirit.",
    "Every season brings something new. Spring blossoms, summer fruit, autumn color, winter rest.",
];

let tipIndex = 0;
setInterval(() => {
    if (!connected) return;
    const tips = selectedGameMode === 0 ? PEACEFUL_TIPS : GENERAL_TIPS;
    const chatLog = document.getElementById("chat-log");
    const line = document.createElement("div");
    line.style.color = selectedGameMode === 0 ? "#aaccbb" : "#88bbaa";
    line.style.fontStyle = "italic";
    line.textContent = tips[tipIndex % tips.length];
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
    tipIndex++;
}, selectedGameMode === 0 ? 60000 : 45000);

// --- Food forest knowledge system ---

const FOOD_FOREST_KNOWLEDGE = {
    100: "Chestnut trees are a canopy staple in temperate food forests. They produce protein-rich nuts and create dappled shade for understory plants. A single mature tree can yield 50-100 kg of nuts per year.",
    101: "Walnut trees fix nitrogen through mycorrhizal partnerships. Their deep taproots bring minerals from subsoil layers, cycling nutrients for the whole ecosystem. The juglone they produce suppresses some weeds.",
    102: "Carob trees thrive in dry Mediterranean climates without irrigation. Their pods contain a natural sweetener that can replace chocolate. They are nitrogen-fixing leguminous trees.",
    103: "Eucalyptus is an invasive species in many Mediterranean regions. It depletes groundwater and suppresses native biodiversity. Responsible food foresters replace eucalyptus with diverse native canopy trees.",
    104: "Hazelnut thrives as an understory or canopy edge tree. It produces nutrient-dense nuts high in vitamin E and healthy fats. Hazelnuts are among the earliest food forest yields, bearing fruit in 3-4 years.",
    105: "Almond trees are drought-tolerant once established. They bloom early in spring, providing critical food for pollinators. A food forest with almonds supports bee populations year-round.",
    106: "Cork oak is a keystone species of Mediterranean ecosystems. Its bark can be harvested every 9 years without harming the tree. Cork forests support more biodiversity than any other Mediterranean habitat.",
    107: "Redwood trees create cathedral-like canopy environments. Their fog-drip irrigation waters the forest floor naturally. They can sequester more carbon per hectare than any other forest type.",
    109: "Stone pine produces large, nutritious pine nuts. Its distinctive umbrella shape provides excellent shade while allowing filtered light through. It thrives in sandy, poor soils where other trees struggle.",
    110: "Pistachio trees are incredibly drought-resistant, producing nuts in arid conditions. They have been cultivated for over 5000 years in Iran. Male and female trees are needed for pollination.",
    111: "Bamboo is one of the fastest growing plants on Earth, sequestering carbon rapidly. Its shoots are edible and its culms have countless uses. It prevents soil erosion on slopes.",
    112: "Cherry trees provide food for humans and wildlife alike. Their blossoms are among the first spring nectar sources. In food forests, they attract beneficial predatory insects.",
    200: "Fig trees are one of the oldest cultivated fruits. They require no cross-pollination and produce two harvests per year. Their deep roots make them excellent drought-tolerant anchor plants.",
    201: "Pomegranate is rich in antioxidants and thrives in Mediterranean climates. It requires minimal water once established and produces fruit within 2-3 years of planting.",
    202: "Citrus trees provide year-round harvests in warm climates. Their fragrant blossoms attract pollinators. Interplanting citrus with nitrogen-fixers dramatically improves yields.",
    203: "Olive trees can live for thousands of years. They are the backbone of Mediterranean food forests, producing fruit, oil, and supporting mycorrhizal networks that nourish the entire ecosystem.",
    205: "Avocado trees are nutrient accumulators, drawing minerals from deep soil layers. Their leaf litter creates excellent mulch. In food forests, they pair well with nitrogen-fixers and banana plants.",
    207: "Banana plants are not trees but giant herbs. They grow rapidly, producing fruit within a year. Their decaying pseudostems create rich compost, feeding the soil food web.",
    208: "Mango trees can live for hundreds of years and produce fruit for generations. They create dense shade that suppresses weeds and their deep roots prevent soil erosion.",
    210: "Peach trees originated in Yunnan, China and were cultivated for over 4000 years. They produce fragrant blossoms in spring that attract pollinators. In food forests, peach trees thrive in the understory with well-drained soil and full sun.",
    300: "Rosemary is a medicinal and culinary herb that attracts pollinators. Its essential oils repel many garden pests. In food forests, it forms a fragrant, drought-tolerant ground layer.",
    301: "Lavender attracts beneficial insects and pollinators while repelling aphids and moths. Its calming scent creates a therapeutic garden atmosphere. It thrives in poor, well-drained soils.",
    302: "Thyme is a living mulch that suppresses weeds and retains soil moisture. Its antimicrobial properties benefit neighboring plants. Ancient Greeks burned thyme as incense in temples.",
    304: "Rooibos is a nitrogen-fixing shrub from South Africa. It thrives in acidic, poor soils and produces caffeine-free tea rich in antioxidants.",
    305: "Protea plants are fire-adapted and incredibly drought-resistant. They support a unique ecosystem of sugarbirds and beetles. Their deep roots access water other plants cannot reach.",
    306: "Tea plants thrive in misty, mountainous conditions. Yunnan province is the birthplace of tea cultivation. Tea gardens with shade trees produce higher quality leaves than monoculture plantations.",
    400: "Comfrey is called the permaculture wonder plant. Its deep taproots mine minerals from subsoil. Chop-and-drop comfrey leaves create the richest natural mulch, feeding soil microbes.",
    401: "Basil is a companion plant that repels flies and mosquitoes. Growing basil near tomatoes improves flavor and repels pests. In food forests, basil fills the herbaceous layer with fragrance.",
    402: "Saffron crocus produces the world's most expensive spice. Each flower yields only 3 stigmas. In food forests, saffron grows beneath deciduous trees that provide summer shade.",
    403: "Shiso is a versatile Japanese herb used in medicine and cuisine. Its leaves are rich in omega-3 fatty acids. It self-seeds prolifically, creating a self-sustaining ground cover.",
    500: "Clover is a living mulch and nitrogen fixer. Its roots host bacteria that convert atmospheric nitrogen into plant-available form, naturally fertilizing the soil for surrounding plants.",
    600: "Grapevines are productive climbers in food forests. They use vertical space efficiently, growing up through canopy trees. Grapes thrive in well-drained soils with good sun exposure.",
    10:  "Chickens provide eggs, pest control, and soil cultivation. In food forest systems, they scratch leaf litter and eat insect pests. Their manure is a rich nitrogen source for plants.",
    21:  "Deer are part of natural forest ecosystems. While they can damage young trees, their browsing creates clearings that increase plant diversity. Their droppings spread seeds and fertilize soil.",
    22:  "Wild boar root through soil, aerating it and mixing organic matter into deeper layers. While they can damage young plantings, their disturbance creates micro-habitats for seed germination. In balanced ecosystems, they play a key role in forest regeneration.",
    30:  "Lambs graze grass and weeds around young trees, reducing competition and fire risk. Their small hooves break up soil crust, improving water infiltration. Sheep manure is one of the best natural fertilizers for fruit trees.",
    31:  "Rabbits are prolific breeders and their pellets are an excellent cold fertilizer, rich in nitrogen and phosphorus. Their burrows improve soil drainage. In food forests, rabbit warrens near comfrey patches create a self-sustaining fertility cycle.",
};

function getKnowledge(speciesId) {
    return FOOD_FOREST_KNOWLEDGE[speciesId] || null;
}
