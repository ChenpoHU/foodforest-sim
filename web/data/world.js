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

