// data/world.js
// Static world data: the playable countries (with their map
// marker coords + region names) and the species each country lets you
// plant. Pure data + one pure lookup — no game state, no imports.

export const WORLD_COUNTRIES = [
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

export const COUNTRY_PLANTS = {
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
        { action: "plant-cherry", label: "Cherry", sid: 112 },
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

export function getCountryForRegion(regionIndex) {
    for (const c of WORLD_COUNTRIES) {
        if (regionIndex >= c.start && regionIndex < c.start + c.count) return c.name;
    }
    return "Portugal";
}

// ── Geography + difficulty model ─────────────────────────────────────
// True centroid latitude/longitude for each playable territory (used to
// place its pin on the 3D globe) plus an overall food-forest difficulty
// (1 = easy / green … 5 = brutal / red) and the dominant hazards.
//
// Difficulty reflects real permaculture challenge: summer drought, fire
// regime, flammable eucalyptus monocultures, extreme heat, frost, etc.
export const COUNTRY_GEO = {
    "Portugal":     { lat: 39.6, lon:  -8.0, stars: 4, hazards: ["eucalyptus", "fire", "drought"] },
    "France":       { lat: 46.6, lon:   2.4, stars: 2, hazards: ["temperate"] },
    "Spain":        { lat: 40.2, lon:  -3.7, stars: 4, hazards: ["drought", "heat", "fire"] },
    "Italy":        { lat: 42.6, lon:  12.6, stars: 3, hazards: ["fire", "drought"] },
    "Iran":         { lat: 32.4, lon:  53.7, stars: 4, hazards: ["drought", "heat", "salinity"] },
    "California":   { lat: 37.2, lon:-120.0, stars: 4, hazards: ["drought", "fire", "eucalyptus"] },
    "South Africa": { lat:-33.6, lon:  21.6, stars: 4, hazards: ["fire", "drought", "eucalyptus"] },
    "Yunnan":       { lat: 25.0, lon: 101.6, stars: 2, hazards: ["fertile", "erosion"] },
    "Japan":        { lat: 37.5, lon: 138.0, stars: 2, hazards: ["fertile", "typhoon"] },
};

// Per-region detail: true-ish lat/lon, star difficulty, and hazards.
// Keyed by region name (unique across the dataset).
export const REGION_INFO = {
    // Portugal
    "Minho":            { lat: 41.7, lon: -8.4, stars: 2, hazards: ["wet", "fertile"] },
    "Tras-os-Montes":   { lat: 41.5, lon: -7.0, stars: 3, hazards: ["frost", "drought"] },
    "Beira":            { lat: 40.3, lon: -7.6, stars: 3, hazards: ["fire", "eucalyptus"] },
    "Ribatejo":         { lat: 39.2, lon: -8.5, stars: 2, hazards: ["fertile", "flood"] },
    "Alentejo":         { lat: 38.1, lon: -7.9, stars: 5, hazards: ["eucalyptus", "fire", "drought", "heat"] },
    "Algarve":          { lat: 37.1, lon: -8.0, stars: 4, hazards: ["drought", "fire"] },
    "Lisboa":           { lat: 38.8, lon: -9.1, stars: 2, hazards: ["coastal", "fertile"] },
    // France
    "Provence":         { lat: 43.9, lon:  6.0, stars: 4, hazards: ["fire", "drought", "mistral"] },
    "Dordogne":         { lat: 45.0, lon:  0.7, stars: 2, hazards: ["fertile"] },
    "Loire Valley":     { lat: 47.3, lon:  0.7, stars: 1, hazards: ["fertile", "temperate"] },
    "Normandy":         { lat: 49.2, lon: -0.4, stars: 1, hazards: ["wet", "temperate"] },
    // Spain
    "Andalusia":        { lat: 37.4, lon: -4.8, stars: 5, hazards: ["drought", "heat", "desertification"] },
    "Catalonia":        { lat: 41.8, lon:  1.7, stars: 3, hazards: ["fire", "drought"] },
    "Galicia":          { lat: 42.8, lon: -8.0, stars: 3, hazards: ["eucalyptus", "fire", "wet"] },
    "Basque Country":   { lat: 43.1, lon: -2.7, stars: 2, hazards: ["wet", "fertile"] },
    // Italy
    "Tuscany":          { lat: 43.4, lon: 11.2, stars: 2, hazards: ["fertile", "temperate"] },
    "Sicily":           { lat: 37.5, lon: 14.2, stars: 5, hazards: ["heat", "drought", "fire"] },
    "Amalfi Coast":     { lat: 40.6, lon: 14.6, stars: 3, hazards: ["steep", "drought"] },
    "Piedmont":         { lat: 45.0, lon:  7.9, stars: 2, hazards: ["fertile", "frost"] },
    // Iran
    "Isfahan":          { lat: 32.7, lon: 51.7, stars: 4, hazards: ["drought", "heat"] },
    "Shiraz":           { lat: 29.6, lon: 52.5, stars: 4, hazards: ["drought", "heat"] },
    "Gilan":            { lat: 37.3, lon: 49.8, stars: 2, hazards: ["humid", "fertile"] },
    "Alborz":           { lat: 36.0, lon: 51.0, stars: 3, hazards: ["frost", "steep"] },
    // California
    "Central Valley":   { lat: 36.7, lon:-119.8, stars: 5, hazards: ["drought", "heat", "fire"] },
    "Napa Valley":      { lat: 38.5, lon:-122.3, stars: 3, hazards: ["fire", "eucalyptus"] },
    "Coastal Range":    { lat: 36.5, lon:-121.5, stars: 2, hazards: ["fog", "fertile"] },
    "Sierra Nevada":    { lat: 38.0, lon:-119.5, stars: 4, hazards: ["fire", "frost", "steep"] },
    // South Africa
    "Cape Winelands":   { lat:-33.7, lon: 19.0, stars: 3, hazards: ["fire", "drought"] },
    "Fynbos Coast":     { lat:-34.2, lon: 20.5, stars: 4, hazards: ["fire", "eucalyptus", "wind"] },
    "Karoo":            { lat:-32.5, lon: 22.5, stars: 5, hazards: ["drought", "heat", "desertification"] },
    "Garden Route":     { lat:-33.9, lon: 22.8, stars: 2, hazards: ["fertile", "wet"] },
    // Yunnan
    "Kunming Plateau":  { lat: 25.0, lon:102.7, stars: 1, hazards: ["fertile", "temperate"] },
    "Xishuangbanna":    { lat: 22.0, lon:100.8, stars: 2, hazards: ["fertile", "deforestation"] },
    "Dali":             { lat: 25.6, lon:100.2, stars: 2, hazards: ["fertile", "lake"] },
    "Tiger Leaping Gorge": { lat: 27.2, lon:100.1, stars: 3, hazards: ["steep", "erosion"] },
    // Japan
    "Hokkaido":         { lat: 43.2, lon:142.8, stars: 2, hazards: ["frost", "fertile"] },
    "Kanto":            { lat: 36.0, lon:139.8, stars: 2, hazards: ["fertile", "typhoon"] },
    "Kansai":           { lat: 34.7, lon:135.5, stars: 1, hazards: ["fertile", "temperate"] },
    "Kyushu":           { lat: 32.8, lon:131.0, stars: 3, hazards: ["typhoon", "volcanic"] },
};

// Hazard vocabulary → emoji + short label, for the difficulty chips.
// "Easy/positive" traits (fertile, temperate, wet…) read green; the rest
// read as challenges.
export const HAZARD_META = {
    eucalyptus:      { icon: "🌲", label: "Eucalyptus", bad: true },
    fire:            { icon: "🔥", label: "Wildfire",    bad: true },
    drought:         { icon: "🌵", label: "Drought",     bad: true },
    heat:            { icon: "☀️", label: "Extreme heat", bad: true },
    frost:           { icon: "❄️", label: "Frost",        bad: true },
    salinity:        { icon: "🧂", label: "Salinity",     bad: true },
    desertification: { icon: "🏜️", label: "Desertification", bad: true },
    typhoon:         { icon: "🌀", label: "Typhoons",     bad: true },
    volcanic:        { icon: "🌋", label: "Volcanic",     bad: true },
    flood:           { icon: "🌊", label: "Flooding",     bad: true },
    erosion:         { icon: "⛰️", label: "Erosion",      bad: true },
    deforestation:   { icon: "🪓", label: "Deforestation", bad: true },
    steep:           { icon: "📐", label: "Steep terrain", bad: true },
    mistral:         { icon: "🌬️", label: "Mistral wind", bad: true },
    wind:            { icon: "🌬️", label: "Strong wind",  bad: true },
    wet:             { icon: "🌧️", label: "Reliable rain", bad: false },
    humid:           { icon: "💧", label: "Humid",        bad: false },
    fog:             { icon: "🌫️", label: "Coastal fog",  bad: false },
    fertile:         { icon: "🌱", label: "Fertile soil", bad: false },
    temperate:       { icon: "🌤️", label: "Mild climate", bad: false },
    coastal:         { icon: "⚓", label: "Coastal",      bad: false },
    lake:            { icon: "🛶", label: "Lakeside",     bad: false },
};

// Difficulty (1–5 stars) → a green→amber→red ramp used for pins, rings,
// region cards, and the legend. Returns { hex, name }.
export function difficultyColor(stars) {
    switch (Math.max(1, Math.min(5, stars | 0))) {
        case 1: return { hex: "#4caf50", name: "Easy" };       // green
        case 2: return { hex: "#9ccc4a", name: "Gentle" };     // yellow-green
        case 3: return { hex: "#ffc83d", name: "Moderate" };   // amber
        case 4: return { hex: "#ff8a3d", name: "Hard" };       // orange
        default: return { hex: "#f4453d", name: "Brutal" };    // red
    }
}

// Convenience: region info by global region index.
export function regionInfoByIndex(regionIndex) {
    for (const c of WORLD_COUNTRIES) {
        if (regionIndex >= c.start && regionIndex < c.start + c.count) {
            const name = c.regions[regionIndex - c.start];
            return { name, country: c.name, ...(REGION_INFO[name] || { stars: 3, hazards: [] }) };
        }
    }
    return null;
}

