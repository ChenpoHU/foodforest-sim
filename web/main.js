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
let butterflyGroup = null;

const keys = new Set();
let inputSeq = 0;

// Connect screen
document.getElementById("connect-btn").addEventListener("click", () => {
    playerName = document.getElementById("player-name").value || "Farmer";
    const serverUrl = document.getElementById("server-url").value || "ws://localhost:9000";
    selectedPlotSeed = parseInt(document.getElementById("plot-seed-input").value) || 42;
    document.getElementById("connect-screen").style.display = "none";
    rebuildToolbar();
    init(serverUrl);
});

document.getElementById("player-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("connect-btn").click();
});

const modeDescriptions = {
    0: "No casualties. Trees disappear when cut. Relaxed pace for all ages.",
    1: "Full felling physics. Falling trees can crush you. Real danger.",
    2: "Wildfire deadline + animals with learning AI that adapt to your behavior.",
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

// Country-specific plantable species
const COUNTRY_PLANTS = {
    "Portugal": [
        { action: "plant-chestnut", label: "Chestnut", sid: 100 },
        { action: "plant-walnut", label: "Walnut", sid: 101 },
        { action: "plant-carob", label: "Carob", sid: 102 },
        { action: "plant-olive", label: "Olive", sid: 203 },
        { action: "plant-fig", label: "Fig", sid: 200 },
        { action: "plant-pomegranate", label: "Pomegranate", sid: 201 },
        { action: "plant-rosemary", label: "Rosemary", sid: 300 },
        { action: "plant-lavender", label: "Lavender", sid: 301 },
        { action: "plant-comfrey", label: "Comfrey", sid: 400 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "France": [
        { action: "plant-chestnut", label: "Chestnut", sid: 100 },
        { action: "plant-walnut", label: "Walnut", sid: 101 },
        { action: "plant-hazelnut", label: "Hazelnut", sid: 104 },
        { action: "plant-fig", label: "Fig", sid: 200 },
        { action: "plant-plum", label: "Plum", sid: 204 },
        { action: "plant-lavender", label: "Lavender", sid: 301 },
        { action: "plant-thyme", label: "Thyme", sid: 302 },
        { action: "plant-comfrey", label: "Comfrey", sid: 400 },
        { action: "plant-grapevine", label: "Grapevine", sid: 600 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "Spain": [
        { action: "plant-carob", label: "Carob", sid: 102 },
        { action: "plant-almond", label: "Almond", sid: 105 },
        { action: "plant-corkoak", label: "Cork Oak", sid: 106 },
        { action: "plant-olive", label: "Olive", sid: 203 },
        { action: "plant-citrus", label: "Citrus", sid: 202 },
        { action: "plant-pomegranate", label: "Pomegranate", sid: 201 },
        { action: "plant-fig", label: "Fig", sid: 200 },
        { action: "plant-rosemary", label: "Rosemary", sid: 300 },
        { action: "plant-clover", label: "Clover", sid: 500 },
        { action: "plant-grapevine", label: "Grapevine", sid: 600 },
    ],
    "Italy": [
        { action: "plant-chestnut", label: "Chestnut", sid: 100 },
        { action: "plant-hazelnut", label: "Hazelnut", sid: 104 },
        { action: "plant-stonepine", label: "Stone Pine", sid: 109 },
        { action: "plant-olive", label: "Olive", sid: 203 },
        { action: "plant-fig", label: "Fig", sid: 200 },
        { action: "plant-citrus", label: "Citrus", sid: 202 },
        { action: "plant-basil", label: "Basil", sid: 401 },
        { action: "plant-rosemary", label: "Rosemary", sid: 300 },
        { action: "plant-grapevine", label: "Grapevine", sid: 600 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "Iran": [
        { action: "plant-walnut", label: "Walnut", sid: 101 },
        { action: "plant-pistachio", label: "Pistachio", sid: 110 },
        { action: "plant-pomegranate", label: "Pomegranate", sid: 201 },
        { action: "plant-mulberry", label: "Mulberry", sid: 206 },
        { action: "plant-fig", label: "Fig", sid: 200 },
        { action: "plant-saffron", label: "Saffron", sid: 402 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "California": [
        { action: "plant-redwood", label: "Redwood", sid: 107 },
        { action: "plant-avocado", label: "Avocado", sid: 205 },
        { action: "plant-citrus", label: "Citrus", sid: 202 },
        { action: "plant-fig", label: "Fig", sid: 200 },
        { action: "plant-sage", label: "Sage", sid: 303 },
        { action: "plant-grapevine", label: "Grapevine", sid: 600 },
        { action: "plant-strawberry", label: "Strawberry", sid: 501 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "South Africa": [
        { action: "plant-macadamia", label: "Macadamia", sid: 108 },
        { action: "plant-citrus", label: "Citrus", sid: 202 },
        { action: "plant-rooibos", label: "Rooibos", sid: 304 },
        { action: "plant-protea", label: "Protea", sid: 305 },
        { action: "plant-comfrey", label: "Comfrey", sid: 400 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "Yunnan": [
        { action: "plant-bamboo", label: "Bamboo", sid: 111 },
        { action: "plant-banana", label: "Banana", sid: 207 },
        { action: "plant-mango", label: "Mango", sid: 208 },
        { action: "plant-peach", label: "Peach", sid: 210 },
        { action: "plant-tea", label: "Tea", sid: 306 },
        { action: "plant-comfrey", label: "Comfrey", sid: 400 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
    "Japan": [
        { action: "plant-cherry", label: "Cherry", sid: 112 },
        { action: "plant-persimmon", label: "Persimmon", sid: 209 },
        { action: "plant-bamboo", label: "Bamboo", sid: 111 },
        { action: "plant-tea", label: "Tea", sid: 306 },
        { action: "plant-shiso", label: "Shiso", sid: 403 },
        { action: "plant-comfrey", label: "Comfrey", sid: 400 },
        { action: "plant-clover", label: "Clover", sid: 500 },
    ],
};

function getCountryForRegion(regionIndex) {
    for (const c of WORLD_COUNTRIES) {
        if (regionIndex >= c.start && regionIndex < c.start + c.count) return c.name;
    }
    return "Portugal";
}

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
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const plant = document.getElementById("plant-menu");
        if (plant && plant.style.display === "flex") { closePlantMenu(); return; }
        const prop = document.getElementById("property-menu");
        if (prop && prop.style.display === "flex") { closePropertyMenu(); return; }
    }
});

rebuildToolbar();

async function init(serverUrl) {
    updateStatus("Loading...");
    initRenderer();
    connectWebSocket(serverUrl);
    requestAnimationFrame(gameLoop);
}

function initRenderer() {
    scene = new THREE.Scene();

    // Painterly sky: inspired by Claude Lorrain golden landscapes and Turner atmospherics
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 512; skyCanvas.height = 256;
    const skyCtx = skyCanvas.getContext("2d");
    const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, "#2a4a78");
    skyGrad.addColorStop(0.15, "#4a78b0");
    skyGrad.addColorStop(0.35, "#7aaccf");
    skyGrad.addColorStop(0.5, "#a8cce0");
    skyGrad.addColorStop(0.65, "#d4c8b0");
    skyGrad.addColorStop(0.78, "#e8c8a0");
    skyGrad.addColorStop(0.88, "#e0b888");
    skyGrad.addColorStop(1.0, "#c8a070");
    skyCtx.fillStyle = skyGrad;
    skyCtx.fillRect(0, 0, 512, 256);
    // Soft clouds as translucent ovals
    skyCtx.globalAlpha = 0.08;
    for (let i = 0; i < 20; i++) {
        const cx = Math.random() * 512;
        const cy = 30 + Math.random() * 100;
        const rx = 40 + Math.random() * 80;
        const ry = 8 + Math.random() * 15;
        skyCtx.beginPath();
        skyCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        skyCtx.fillStyle = "#ffffff";
        skyCtx.fill();
    }
    skyCtx.globalAlpha = 1.0;
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTexture;
    scene.fog = new THREE.FogExp2(0xc8d8e0, 0.0012);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 3000);
    camera.position.set(160, 80, 160);
    camera.lookAt(160, 0, 160);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minDistance = 3;
    controls.maxDistance = 600;

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
    scene.add(new THREE.AmbientLight(0x708090, 0.6));
    scene.add(new THREE.HemisphereLight(0x99ccee, 0x667744, 0.7));

    // Warm fill from the side for depth
    const fill = new THREE.DirectionalLight(0xffddbb, 0.4);
    fill.position.set(-100, 120, -80);
    scene.add(fill);

    // Subtle backlight rim for atmosphere
    const rim = new THREE.DirectionalLight(0xccddff, 0.25);
    rim.position.set(-50, 200, -200);
    scene.add(rim);

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
        case 0x0106: handlePlayerState(payload); break;
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
};

let playerInventory = [];
let playerStamina = 100;
let playerHunger = 0;
let playerCoins = 0;

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
    } catch (e) {
        // Old server without the coins field — keep the previous balance.
    }
    try {
        r.readU32(); // last_acked_seq
    } catch (_) { /* trailing field optional for robustness */ }

    refreshCoinChip();
    const modal = document.getElementById("property-menu");
    if (modal && modal.style.display === "flex") {
        renderPropertyMenu();
    }
    updatePlayerHUD();
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
    renderPropertyMenu();
    document.getElementById("property-menu").style.display = "flex";
}

function closePropertyMenu() {
    document.getElementById("property-menu").style.display = "none";
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

function makeTree(trunkColor, trunkW, trunkH, canopyColor, canopyR, canopyH, canopyY, fruitColor, fruitCount) {
    const group = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(trunkW * 0.6, trunkW, trunkH, 8);
    const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({
        color: trunkColor, roughness: 0.95
    }));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);
    // Multiple overlapping canopy spheres for organic look
    const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.85 });
    const mainCanopy = new THREE.Mesh(new THREE.SphereGeometry(canopyR, 10, 8), canopyMat);
    if (canopyH !== canopyR) mainCanopy.scale.y = canopyH / canopyR;
    mainCanopy.position.y = canopyY;
    mainCanopy.castShadow = true;
    group.add(mainCanopy);
    // Secondary canopy blobs
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const r2 = canopyR * 0.65;
        const blob = new THREE.Mesh(
            new THREE.SphereGeometry(r2, 7, 5),
            new THREE.MeshStandardMaterial({
                color: new THREE.Color(canopyColor).offsetHSL(0, 0, (i - 1) * 0.04),
                roughness: 0.85
            })
        );
        blob.position.set(Math.cos(a) * canopyR * 0.5, canopyY - 0.2 + i * 0.15, Math.sin(a) * canopyR * 0.5);
        blob.castShadow = true;
        group.add(blob);
    }
    // Leaf particles scattered around canopy
    const leafCount = Math.floor(canopyR * 12);
    const leafGeo = new THREE.PlaneGeometry(0.18, 0.12);
    for (let i = 0; i < leafCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const rLeaf = canopyR * (0.7 + Math.random() * 0.45);
        const lx = Math.sin(phi) * Math.cos(theta) * rLeaf;
        const ly = canopyY + Math.cos(phi) * canopyH * 0.5 * (Math.random() - 0.3);
        const lz = Math.sin(phi) * Math.sin(theta) * rLeaf;
        const leafShade = new THREE.Color(canopyColor).offsetHSL(
            (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.08
        );
        const leaf = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({
            color: leafShade, roughness: 0.8, side: THREE.DoubleSide
        }));
        leaf.position.set(lx, ly, lz);
        leaf.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        group.add(leaf);
    }
    // Fruits — placed inside a named subgroup so we can toggle visibility
    // based on the plant's growth stage (only visible when Fruiting).
    if (fruitColor && fruitCount) {
        const fruitsGroup = new THREE.Group();
        fruitsGroup.name = "fruits";
        fruitsGroup.visible = false; // shown only when growthStage === 5 (Fruiting)
        const fruitMat = new THREE.MeshStandardMaterial({
            color: fruitColor,
            roughness: 0.4,
            metalness: 0.05,
            emissive: new THREE.Color(fruitColor).multiplyScalar(0.25),
        });
        const fruitGeo = new THREE.SphereGeometry(0.14, 6, 5);
        for (let i = 0; i < fruitCount; i++) {
            const a = (i / fruitCount) * Math.PI * 2;
            const rr = canopyR * 0.6;
            const fruit = new THREE.Mesh(fruitGeo, fruitMat);
            fruit.position.set(
                Math.cos(a) * rr,
                canopyY - canopyH * 0.3 + Math.sin(i * 2.3) * 0.3,
                Math.sin(a) * rr
            );
            fruitsGroup.add(fruit);
        }
        group.add(fruitsGroup);
    }
    return group;
}

function createEntityMesh(category) {
    switch (category) {
        case "player": {
            const g = new THREE.Group();
            const skin = new THREE.MeshStandardMaterial({ color: 0xf0d0a8, roughness: 0.75 });
            const shirt = new THREE.MeshStandardMaterial({ color: 0x5588bb, roughness: 0.8 });
            const pants = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.8 });
            const shoe = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
            const hair = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9 });
            const dot = new THREE.MeshStandardMaterial({ color: 0x221111, roughness: 0.6 });
            // Torso
            const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.4, 6, 8), shirt);
            torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
            // Neck
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 6), skin);
            neck.position.y = 1.35; g.add(neck);
            // Head (slightly wider, friendly proportion)
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
            head.position.y = 1.56; head.castShadow = true; g.add(head);
            // Hair cap
            const hairCap = new THREE.Mesh(
                new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair
            );
            hairCap.position.y = 1.58; g.add(hairCap);
            // Simple dot eyes (friendly, no uncanny valley)
            for (const side of [-1, 1]) {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 5, 4), dot);
                eye.position.set(side * 0.08, 1.58, -0.2); g.add(eye);
            }
            // Arms (connected to torso, overlapping)
            for (const side of [-1, 1]) {
                const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.24, 4, 6), shirt);
                upperArm.position.set(side * 0.3, 1.1, 0); upperArm.castShadow = true; g.add(upperArm);
                const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 6), skin);
                forearm.position.set(side * 0.3, 0.8, 0); g.add(forearm);
                const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), skin);
                hand.position.set(side * 0.3, 0.62, 0); g.add(hand);
            }
            // Legs (overlapping with torso)
            for (const side of [-1, 1]) {
                const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.24, 4, 6), pants);
                thigh.position.set(side * 0.1, 0.6, 0); thigh.castShadow = true; g.add(thigh);
                const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 6), pants);
                shin.position.set(side * 0.1, 0.32, 0); g.add(shin);
                const shoeM = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.1, 4, 5), shoe);
                shoeM.position.set(side * 0.1, 0.14, -0.02); shoeM.rotation.x = Math.PI / 2;
                shoeM.scale.set(1, 1.3, 0.8); g.add(shoeM);
            }
            return g;
        }
        case "eucalyptus":
            return makeTree(0x8a7a6a, 0.2, 6, 0x6a8a6a, 1.5, 2.1, 7.0);
        case "chestnut":
            return makeTree(0x5c3a1a, 0.3, 4, 0x2a7a1a, 2.5, 2.5, 5.5, 0x8a5a1a, 6);
        case "walnut":
            return makeTree(0x4a3018, 0.35, 5, 0x2a6a1a, 2.8, 2.8, 6.5, 0x5a7a2a, 8);
        case "carob":
            return makeTree(0x3a2a1a, 0.25, 3, 0x2a5a1a, 2.0, 2.0, 4.5, 0x5a3a1a, 5);
        case "fig":
            return makeTree(0x6a5a3a, 0.15, 1.5, 0x3a7a2a, 2.0, 1.4, 2.8, 0x6a2a5a, 7);
        case "pomegranate":
            return makeTree(0x5a3a2a, 0.12, 1.8, 0x3a6a1a, 1.2, 1.2, 3.0, 0xcc2233, 6);
        case "citrus":
            return makeTree(0x5a4a2a, 0.15, 1.5, 0x2a7a1a, 1.5, 1.5, 3.0, 0xffaa22, 8);
        case "olive":
            return makeTree(0x7a6a4a, 0.2, 2.5, 0x7a9a6a, 2.0, 1.4, 3.8, 0x3a4a1a, 10);
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
                new THREE.MeshStandardMaterial({ color: 0x3a8a2a, roughness: 0.85 })
            );
            leaves.position.y = 0.15; leaves.scale.y = 0.5; group.add(leaves);
            const berryMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4 });
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2;
                const berry = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3), berryMat);
                berry.position.set(Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15);
                berry.scale.y = 1.3; group.add(berry);
            }
            return group;
        }
        case "grapevine": {
            const group = new THREE.Group();
            const vine = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.07, 2.0, 5),
                new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.9 })
            );
            vine.position.y = 1.0; vine.castShadow = true; group.add(vine);
            const foliage = new THREE.Mesh(
                new THREE.SphereGeometry(0.8, 8, 6),
                new THREE.MeshStandardMaterial({ color: 0x4a8a2a, roughness: 0.85 })
            );
            foliage.position.y = 2.0; foliage.scale.y = 0.6;
            foliage.castShadow = true; group.add(foliage);
            // Grape clusters
            const grapeMat = new THREE.MeshStandardMaterial({ color: 0x5522aa, roughness: 0.5 });
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2;
                for (let j = 0; j < 3; j++) {
                    const grape = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), grapeMat);
                    grape.position.set(
                        Math.cos(a) * 0.5, 1.7 - j * 0.06,
                        Math.sin(a) * 0.5 + (j - 1) * 0.03
                    );
                    group.add(grape);
                }
            }
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
            const g = new THREE.Group();
            const fur = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.9 });
            const furLight = new THREE.MeshStandardMaterial({ color: 0xc8aa78, roughness: 0.9 });
            const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.8 });
            // Main body: overlapping spheres for smooth form
            const bodyFront = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 7), fur);
            bodyFront.position.set(0, 0.88, 0.15); bodyFront.scale.set(0.85, 0.9, 1.1);
            bodyFront.castShadow = true; g.add(bodyFront);
            const bodyRear = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 7), fur);
            bodyRear.position.set(0, 0.86, -0.18); bodyRear.scale.set(0.9, 0.88, 1.0);
            bodyRear.castShadow = true; g.add(bodyRear);
            const bodyMid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), fur);
            bodyMid.position.set(0, 0.87, 0); bodyMid.scale.set(0.8, 0.85, 1.05);
            g.add(bodyMid);
            // Belly
            const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 5), furLight);
            belly.position.set(0, 0.76, 0); belly.scale.set(0.7, 0.6, 1.0); g.add(belly);
            // Legs (upper starts inside body sphere)
            for (const [lx, lz] of [[-0.11, -0.28], [0.11, -0.28], [-0.11, 0.28], [0.11, 0.28]]) {
                const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 4, 5), fur);
                upper.position.set(lx, 0.52, lz); upper.castShadow = true; g.add(upper);
                const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.26, 4, 4), fur);
                lower.position.set(lx, 0.22, lz); g.add(lower);
                const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.06, 5), dark);
                hoof.position.set(lx, 0.04, lz); g.add(hoof);
            }
            // Shoulder bump (hides leg-body junction)
            const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), fur);
            shoulderL.position.set(-0.12, 0.82, 0.25); g.add(shoulderL);
            const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), fur);
            shoulderR.position.set(0.12, 0.82, 0.25); g.add(shoulderR);
            const hipL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), fur);
            hipL.position.set(-0.12, 0.8, -0.25); g.add(hipL);
            const hipR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), fur);
            hipR.position.set(0.12, 0.8, -0.25); g.add(hipR);
            // Neck: multiple overlapping spheres for smooth curve
            const neckBase = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), fur);
            neckBase.position.set(0, 0.98, 0.35); g.add(neckBase);
            const neckMid = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), fur);
            neckMid.position.set(0, 1.1, 0.42); g.add(neckMid);
            const neckTop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), fur);
            neckTop.position.set(0, 1.2, 0.46); g.add(neckTop);
            // Head (overlaps neckTop)
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), fur);
            head.position.set(0, 1.28, 0.52); g.add(head);
            // Snout
            const snout = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), furLight);
            snout.position.set(0, 1.24, 0.65); snout.scale.set(0.7, 0.65, 1.0); g.add(snout);
            // Nose
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), dark);
            nose.position.set(0, 1.25, 0.73); g.add(nose);
            // Eyes
            for (const side of [-1, 1]) {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), dark);
                eye.position.set(side * 0.11, 1.32, 0.58); g.add(eye);
            }
            // Ears
            for (const side of [-1, 1]) {
                const ear = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), furLight);
                ear.position.set(side * 0.1, 1.42, 0.46);
                ear.scale.set(0.35, 1.0, 0.5);
                ear.rotation.z = side * -0.3; ear.rotation.x = -0.15;
                g.add(ear);
            }
            // Antlers
            const antler = new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.85 });
            for (const side of [-1, 1]) {
                const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.3, 4), antler);
                a1.position.set(side * 0.06, 1.46, 0.48); a1.rotation.z = side * -0.4; g.add(a1);
                const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.2, 3), antler);
                a2.position.set(side * 0.12, 1.58, 0.45); a2.rotation.z = side * -0.7; g.add(a2);
                const a3 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.15, 3), antler);
                a3.position.set(side * 0.08, 1.6, 0.43); a3.rotation.z = side * -0.3;
                a3.rotation.x = -0.4; g.add(a3);
            }
            // White tail
            const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4),
                new THREE.MeshStandardMaterial({ color: 0xf0e8dd, roughness: 0.9 }));
            tail.position.set(0, 0.92, -0.45); tail.scale.set(0.8, 0.6, 1.0); g.add(tail);
            return g;
        }
        // --- New canopy trees ---
        case "hazelnut":
            return makeTree(0x5a4020, 0.2, 3.5, 0x3a7a1a, 2.0, 2.0, 4.8, 0x8a6a2a, 5);
        case "almond":
            return makeTree(0x6a5a3a, 0.15, 3, 0x5a8a3a, 1.8, 1.5, 4.2, 0xeeddcc, 6);
        case "corkoak":
            return makeTree(0x4a3018, 0.35, 5, 0x2a5a1a, 3.0, 2.5, 6.5);
        case "redwood":
            return makeTree(0x6a2a1a, 0.4, 10, 0x1a5a1a, 2.5, 4.0, 11.0);
        case "macadamia":
            return makeTree(0x5a4a2a, 0.25, 4, 0x2a6a2a, 2.2, 2.2, 5.5, 0xddccaa, 5);
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
            return makeTree(0x6a5a3a, 0.2, 3, 0x5a8a3a, 2.0, 1.5, 4.2, 0xcc5544, 6);
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
            return makeTree(0x5a3a2a, 0.2, 4, 0xdd88aa, 2.2, 2.0, 5.5, 0xcc1122, 8);
        // --- New understory ---
        case "plum":
            return makeTree(0x5a3a2a, 0.12, 2, 0x3a7a2a, 1.5, 1.5, 3.2, 0x6622aa, 7);
        case "avocado":
            return makeTree(0x5a4a2a, 0.2, 3, 0x2a6a1a, 2.0, 2.0, 4.5, 0x3a5a1a, 5);
        case "mulberry":
            return makeTree(0x5a3a1a, 0.18, 3, 0x3a7a2a, 2.0, 1.8, 4.2, 0x3a1a2a, 8);
        case "banana": {
            const g = new THREE.Group();
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.18, 3, 6),
                new THREE.MeshStandardMaterial({ color: 0x7a9a3a, roughness: 0.85 })
            );
            trunk.position.y = 1.5; trunk.castShadow = true; g.add(trunk);
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const leaf = new THREE.Mesh(
                    new THREE.CapsuleGeometry(0.08, 1.2, 3, 5),
                    new THREE.MeshStandardMaterial({ color: 0x3a8a2a, roughness: 0.7 })
                );
                leaf.position.set(Math.cos(angle) * 0.3, 3.1, Math.sin(angle) * 0.3);
                leaf.rotation.y = angle;
                leaf.rotation.x = -0.5; leaf.scale.set(2.5, 1, 0.15); g.add(leaf);
            }
            // Banana bunch
            const bunchMat = new THREE.MeshStandardMaterial({ color: 0xddcc33, roughness: 0.5 });
            for (let i = 0; i < 4; i++) {
                const banana = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 3, 4), bunchMat);
                banana.position.set(Math.cos(i * 1.5) * 0.08, 2.6 - i * 0.06, Math.sin(i * 1.5) * 0.08);
                banana.rotation.z = 0.3; g.add(banana);
            }
            return g;
        }
        case "mango":
            return makeTree(0x5a4a2a, 0.25, 4, 0x2a6a1a, 2.5, 2.0, 5.5, 0xee8822, 6);
        case "persimmon":
            return makeTree(0x5a3a1a, 0.15, 3, 0x4a7a2a, 1.8, 1.8, 4.2, 0xee6622, 5);
        case "peach":
            return makeTree(0x5a3a2a, 0.14, 2.5, 0x5aaa5a, 1.8, 1.6, 3.8, 0xffaa88, 8);
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
        case "boar": {
            const g = new THREE.Group();
            const boarM = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
            const boarL = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
            const dk = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.8 });
            // Body (stocky)
            const bod = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.7, 6, 8), boarM);
            bod.position.set(0, 0.55, 0); bod.rotation.z = Math.PI / 2;
            bod.castShadow = true; g.add(bod);
            // Legs (short, stout)
            for (const [lx, lz] of [[-0.15, -0.25], [0.15, -0.25], [-0.15, 0.25], [0.15, 0.25]]) {
                const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.15, 4, 4), boarM);
                leg.position.set(lx, 0.2, lz); leg.castShadow = true; g.add(leg);
                const hf = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), dk);
                hf.position.set(lx, 0.06, lz); hf.scale.y = 0.5; g.add(hf);
            }
            // Head
            const hd = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 5), boarM);
            hd.position.set(0, 0.6, 0.45); g.add(hd);
            // Snout (long)
            const sn = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.12, 4, 5), boarL);
            sn.position.set(0, 0.52, 0.6); sn.rotation.x = Math.PI / 2;
            sn.scale.set(0.9, 1, 0.7); g.add(sn);
            // Nose disc
            const nd = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6), new THREE.MeshStandardMaterial({ color: 0xcc8877 }));
            nd.position.set(0, 0.52, 0.68); nd.rotation.x = Math.PI / 2; g.add(nd);
            // Eyes
            for (const s of [-1, 1]) {
                const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), dk);
                e.position.set(s * 0.12, 0.65, 0.5); g.add(e);
            }
            // Ears
            for (const s of [-1, 1]) {
                const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), boarM);
                ear.position.set(s * 0.1, 0.78, 0.4); ear.rotation.z = s * -0.3; g.add(ear);
            }
            // Tusks
            for (const s of [-1, 1]) {
                const tusk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.015, 0.08, 3),
                    new THREE.MeshStandardMaterial({ color: 0xeee8dd }));
                tusk.position.set(s * 0.06, 0.48, 0.6); tusk.rotation.x = 0.3;
                tusk.rotation.z = s * 0.2; g.add(tusk);
            }
            // Bristly back
            const bristle = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 5), dk);
            bristle.position.set(0, 0.85, -0.05); bristle.scale.set(0.3, 1, 2); g.add(bristle);
            // Curly tail
            const tl = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 4, 6, Math.PI),
                boarM);
            tl.position.set(0, 0.65, -0.4); tl.rotation.y = Math.PI / 2; g.add(tl);
            return g;
        }
        case "rabbit": {
            const g = new THREE.Group();
            const furR = new THREE.MeshStandardMaterial({ color: 0xb8a088, roughness: 0.9 });
            const furW = new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.9 });
            const dkR = new THREE.MeshStandardMaterial({ color: 0x2a1a0a });
            // Body
            const bod = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), furR);
            bod.position.set(0, 0.22, 0); bod.scale.set(0.9, 0.8, 1.1);
            bod.castShadow = true; g.add(bod);
            // Head
            const hd = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), furR);
            hd.position.set(0, 0.32, 0.16); g.add(hd);
            // Ears (long, tall)
            for (const s of [-1, 1]) {
                const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.14, 4, 5), furR);
                ear.position.set(s * 0.04, 0.48, 0.12); ear.rotation.z = s * -0.15; g.add(ear);
                const earIn = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.1, 3, 4),
                    new THREE.MeshStandardMaterial({ color: 0xddaaaa }));
                earIn.position.set(s * 0.04, 0.47, 0.11); earIn.rotation.z = s * -0.15; g.add(earIn);
            }
            // Eyes
            for (const s of [-1, 1]) {
                const e = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), dkR);
                e.position.set(s * 0.07, 0.34, 0.22); g.add(e);
            }
            // Nose
            const n = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3),
                new THREE.MeshStandardMaterial({ color: 0xdd9999 }));
            n.position.set(0, 0.31, 0.26); g.add(n);
            // Fluffy tail
            const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), furW);
            tail.position.set(0, 0.22, -0.16); g.add(tail);
            // Hind legs (bigger)
            for (const s of [-1, 1]) {
                const hl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), furR);
                hl.position.set(s * 0.1, 0.12, -0.06); hl.scale.set(0.8, 1.2, 1); g.add(hl);
                const fl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), furR);
                fl.position.set(s * 0.06, 0.1, 0.12); g.add(fl);
            }
            return g;
        }
        case "lamb": {
            const g = new THREE.Group();
            const wool = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1.0 });
            const face = new THREE.MeshStandardMaterial({ color: 0x2a2020, roughness: 0.85 });
            const pink = new THREE.MeshStandardMaterial({ color: 0xddaaaa });
            // Woolly body (multiple blobs)
            const bod = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), wool);
            bod.position.set(0, 0.55, 0); bod.scale.set(1, 0.85, 1.2);
            bod.castShadow = true; g.add(bod);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const fluff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), wool);
                fluff.position.set(Math.cos(a) * 0.18, 0.6 + Math.sin(i) * 0.05, Math.sin(a) * 0.2);
                g.add(fluff);
            }
            // Legs (dark, thin)
            for (const [lx, lz] of [[-0.12, -0.2], [0.12, -0.2], [-0.12, 0.2], [0.12, 0.2]]) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.35, 4), face);
                leg.position.set(lx, 0.18, lz); leg.castShadow = true; g.add(leg);
                const hf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 3, 3), face);
                hf.position.set(lx, 0.04, lz); hf.scale.y = 0.5; g.add(hf);
            }
            // Head (dark face)
            const hd = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), face);
            hd.position.set(0, 0.65, 0.32); g.add(hd);
            // Wool on head
            const headWool = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), wool);
            headWool.position.set(0, 0.72, 0.28); g.add(headWool);
            // Eyes
            for (const s of [-1, 1]) {
                const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 3),
                    new THREE.MeshStandardMaterial({ color: 0x888844 }));
                e.position.set(s * 0.08, 0.68, 0.38); g.add(e);
            }
            // Ears (floppy)
            for (const s of [-1, 1]) {
                const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), face);
                ear.position.set(s * 0.12, 0.63, 0.28);
                ear.scale.set(0.5, 1, 0.7); ear.rotation.z = s * 0.5; g.add(ear);
            }
            // Nose
            const ns = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), pink);
            ns.position.set(0, 0.62, 0.43); g.add(ns);
            // Tail
            const tl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3), wool);
            tl.position.set(0, 0.6, -0.28); g.add(tl);
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
        case "hochsitz": {
            // Closed Kanzel (German hunting stand) — larch wood, ~3.5m stilts, 1.2x1.2m cabin
            const g = new THREE.Group();
            const larch = new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 0.92 });
            const larchDark = new THREE.MeshStandardMaterial({ color: 0x5a3a18, roughness: 0.95 });
            const plank = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 });
            const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
            const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a3a4a, roughness: 0.3, metalness: 0.1 });
            const platformH = 3.5;
            // Four larch log stilts
            for (const [lx, lz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, platformH, 6), larch);
                leg.position.set(lx, platformH / 2, lz); leg.castShadow = true; g.add(leg);
            }
            // Diagonal cross braces on two sides
            for (const side of [-1, 1]) {
                const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.5, 4), larchDark);
                brace.position.set(side * 0.55, 1.8, 0);
                brace.rotation.z = side * 0.55; brace.rotation.x = 0.3;
                g.add(brace);
                const brace2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.5, 4), larchDark);
                brace2.position.set(0, 1.8, side * 0.55);
                brace2.rotation.x = side * -0.55; brace2.rotation.z = 0.3;
                g.add(brace2);
            }
            // Horizontal cross beams at mid-height
            for (const lz of [-0.55, 0.55]) {
                const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), larchDark);
                beam.position.set(0, platformH * 0.5, lz); g.add(beam);
            }
            for (const lx of [-0.55, 0.55]) {
                const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), larchDark);
                beam.position.set(lx, platformH * 0.5, 0); g.add(beam);
            }
            // Platform floor (thick planks)
            const floor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 1.3), plank);
            floor.position.y = platformH; floor.castShadow = true; g.add(floor);
            // Cabin walls — closed on all four sides, 1.2m x 1.2m x 1.9m tall
            const cabinH = 1.9;
            const cabinY = platformH + cabinH / 2 + 0.05;
            const wallThick = 0.06;
            // Back wall (solid)
            const backWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, cabinH, wallThick), plank);
            backWall.position.set(0, cabinY, -0.57); backWall.castShadow = true; g.add(backWall);
            // Front wall (solid, with door opening indicated by darker panel)
            const frontWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, cabinH, wallThick), plank);
            frontWall.position.set(0, cabinY, 0.57); frontWall.castShadow = true; g.add(frontWall);
            // Side walls
            const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThick, cabinH, 1.2), plank);
            leftWall.position.set(-0.57, cabinY, 0); leftWall.castShadow = true; g.add(leftWall);
            const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThick, cabinH, 1.2), plank);
            rightWall.position.set(0.57, cabinY, 0); rightWall.castShadow = true; g.add(rightWall);
            // Observation windows (100cm x 40cm) — dark glass on all four sides
            const winW = 0.8, winH = 0.35;
            const winY = platformH + cabinH * 0.65;
            for (const [wx, wz, ry] of [[0, -0.58, 0], [0, 0.58, 0], [-0.58, 0, Math.PI/2], [0.58, 0, Math.PI/2]]) {
                const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), windowMat);
                win.position.set(wx, winY, wz);
                win.rotation.y = ry;
                if (wz < 0) win.rotation.y = Math.PI;
                g.add(win);
            }
            // Pitched roof (two sloping sides meeting at ridge)
            const roofOverhang = 0.2;
            const roofW = 1.2 + roofOverhang * 2;
            const roofD = (1.2 + roofOverhang * 2) / 2;
            const roofAngle = 0.35;
            const roofY = platformH + cabinH + 0.1;
            const roofLeft = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.05, roofD + 0.1), roofMat);
            roofLeft.position.set(0, roofY + 0.2, -roofD / 2 + 0.05);
            roofLeft.rotation.x = roofAngle; roofLeft.castShadow = true; g.add(roofLeft);
            const roofRight = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.05, roofD + 0.1), roofMat);
            roofRight.position.set(0, roofY + 0.2, roofD / 2 - 0.05);
            roofRight.rotation.x = -roofAngle; roofRight.castShadow = true; g.add(roofRight);
            // Roof ridge beam
            const ridge = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.06, 0.06), larchDark);
            ridge.position.set(0, roofY + 0.42, 0); g.add(ridge);
            // Gable triangles (front and back)
            const gableGeo = new THREE.BufferGeometry();
            const gableVerts = new Float32Array([
                -0.6, 0, 0,  0.6, 0, 0,  0, 0.35, 0
            ]);
            gableGeo.setAttribute("position", new THREE.BufferAttribute(gableVerts, 3));
            gableGeo.computeVertexNormals();
            for (const gz of [-0.58, 0.58]) {
                const gable = new THREE.Mesh(gableGeo, plank);
                gable.position.set(0, roofY, gz); g.add(gable);
            }
            // Internal ladder (leaning against front, goes through floor hatch)
            const ladderMat = larchDark;
            for (let ly = 0; ly < platformH; ly += 0.4) {
                const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), ladderMat);
                rung.position.set(0, ly + 0.2, 0.65); rung.rotation.z = Math.PI / 2; g.add(rung);
            }
            const ladderL = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, platformH + 0.5, 5), larch);
            ladderL.position.set(-0.15, platformH / 2, 0.65); ladderL.rotation.x = 0.08; g.add(ladderL);
            const ladderR = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, platformH + 0.5, 5), larch);
            ladderR.position.set(0.15, platformH / 2, 0.65); ladderR.rotation.x = 0.08; g.add(ladderR);
            return g;
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

// Growth stage scale factors: Seed=0, Germinating=1, Seedling=2, Juvenile=3, Mature=4, Fruiting=5
const GROWTH_SCALES = [0.1, 0.15, 0.3, 0.55, 1.0, 1.0, 0.9, 0.0];

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

    // Scale plants by growth stage, and reveal fruits only while Fruiting.
    const info = entityKinds.get(eid);
    if (info && info.kind === "plant" && info.growthStage !== undefined) {
        const s = GROWTH_SCALES[info.growthStage] || 1.0;
        obj.scale.set(s, s, s);
        // GrowthStage::Fruiting === 5 (see ff-ecs plant component)
        const fruitsGroup = obj.getObjectByName ? obj.getObjectByName("fruits") : null;
        if (fruitsGroup) {
            fruitsGroup.visible = info.growthStage === 5;
        }
    }

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
        if (eid && selectedAction === "hunt") {
            ws.send(buildActionMessage(encodeHuntAction(eid)));
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
                const country = getCountryForRegion(selectedRegion);
                const plants = COUNTRY_PLANTS[country] || COUNTRY_PLANTS["Portugal"];
                const found = plants.find(p => p.action === selectedAction);
                const sid = found ? found.sid : 100;
                const actionPayload = encodePlantAction(sid, ix, iy, iz);
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
            } else if (selectedAction === "build-hochsitz") {
                const actionPayload = encodeHochsitzAction(ix, iy, iz);
                ws.send(buildActionMessage(actionPayload));
            }
        }
    }
}

// ActionKind bincode encoders (enum variant index as varint, then fields)
function encodePlantAction(speciesId, x, y, z) {
    // PlantSeed { species_id: u16, position: [i32; 3] }
    return [
        ...encodeVarint(0),
        ...encodeVarint(speciesId),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
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

function encodeHuntAction(entityId) {
    return [...encodeVarint(12), ...encodeVarint(entityId)];
}

function encodeEatAction(itemId) {
    // EatItem { item_id: u16 } — variant 14
    return [...encodeVarint(14), ...encodeVarint(itemId)];
}

function encodeSellAction(itemId, count) {
    // SellItem { item_id: u16, count: u16 } — variant 15
    return [...encodeVarint(15), ...encodeVarint(itemId), ...encodeVarint(count)];
}

function encodeHochsitzAction(x, y, z) {
    return [
        ...encodeVarint(13),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
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

    const yaw = Math.atan2(-mx, -mz);
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
    checkEdgeTransition();
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

// --- Ambient music (relaxing piano) ---

let audioCtx = null;
let musicStarted = false;
let pianoBus = null;

// Synthesize a single piano-like note using a stack of harmonics with an
// ADSR envelope (fast attack, exponential decay) — no samples, no drones.
function playPianoNote(freq, when, duration, velocity) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + when;
    const peak = velocity;

    const noteGain = audioCtx.createGain();
    noteGain.gain.setValueAtTime(0.0001, t0);
    noteGain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    noteGain.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 0.25);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    noteGain.connect(pianoBus);

    // Loose approximation of a piano's first few partials.
    const partials = [
        { mult: 1.0, amp: 1.00, type: "triangle" },
        { mult: 2.0, amp: 0.42, type: "sine" },
        { mult: 3.0, amp: 0.18, type: "sine" },
        { mult: 4.0, amp: 0.09, type: "sine" },
        { mult: 5.0, amp: 0.04, type: "sine" },
    ];
    for (const p of partials) {
        const osc = audioCtx.createOscillator();
        osc.type = p.type;
        osc.frequency.value = freq * p.mult;
        const g = audioCtx.createGain();
        g.gain.value = p.amp;
        osc.connect(g);
        g.connect(noteGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.05);
    }
}

function startAmbientMusic() {
    if (musicStarted) return;
    musicStarted = true;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Shared bus with a gentle low-pass + soft delay tail for warmth —
    // no oscillators on it directly, just shaping for the piano notes.
    pianoBus = audioCtx.createGain();
    pianoBus.gain.value = 0.85;

    const tone = audioCtx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    tone.Q.value = 0.6;

    const delay = audioCtx.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const feedback = audioCtx.createGain();
    feedback.gain.value = 0.22;
    const wet = audioCtx.createGain();
    wet.gain.value = 0.18;

    pianoBus.connect(tone);
    tone.connect(audioCtx.destination);
    tone.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(audioCtx.destination);

    // Slow, peaceful four-chord progression (vi - IV - I - V in C major).
    // Each entry: [root chord notes, melody pool drawn from the chord scale].
    const progression = [
        { chord: [220.00, 261.63, 329.63], melody: [440.00, 523.25, 659.25, 783.99] }, // A minor
        { chord: [174.61, 220.00, 261.63], melody: [349.23, 440.00, 523.25, 698.46] }, // F major
        { chord: [196.00, 261.63, 329.63], melody: [392.00, 523.25, 587.33, 659.25] }, // C major
        { chord: [196.00, 246.94, 293.66], melody: [392.00, 493.88, 587.33, 783.99] }, // G major
    ];

    const CHORD_SECONDS = 5.5;
    let step = 0;

    function scheduleNext() {
        if (!audioCtx) return;
        const slot = progression[step % progression.length];

        // Soft sustained chord underneath.
        for (const f of slot.chord) {
            playPianoNote(f, 0, CHORD_SECONDS, 0.08);
        }

        // Sparse melody on top: 2–3 notes drifting through the chord.
        const notes = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < notes; i++) {
            const f = slot.melody[Math.floor(Math.random() * slot.melody.length)];
            const offset = 0.8 + i * (1.2 + Math.random() * 0.6);
            const vel = 0.10 + Math.random() * 0.05;
            playPianoNote(f, offset, 2.5, vel);
        }

        step += 1;
        setTimeout(scheduleNext, CHORD_SECONDS * 1000);
    }

    scheduleNext();
}

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
