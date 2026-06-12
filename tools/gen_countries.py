#!/usr/bin/env python3
"""Generate the 80-country world data (1 location each) for both the client
(web/data/world.js) and the server (ff-voxel/src/generate.rs). Single source of
truth so the two stay index-aligned."""
import re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Climate bands → hazards · terrain params · plants · native species ──────
TITLE = {"banana":"Banana","mango":"Mango","citrus":"Citrus","bamboo":"Bamboo",
 "tea":"Tea","comfrey":"Comfrey","clover":"Clover","pomegranate":"Pomegranate",
 "olive":"Olive","fig":"Fig","almond":"Almond","grapevine":"Grapevine",
 "rosemary":"Rosemary","hazelnut":"Hazelnut","plum":"Plum","cherry":"Cherry",
 "walnut":"Walnut","pistachio":"Pistachio","saffron":"Saffron"}

BANDS = {
 "trop_wet": dict(hz=["wet","fertile","flood"], color="#2a8a6a",
   params=("land",7,5,0.045,0.9,0.25,True),
   plants=[("banana",207),("mango",208),("citrus",202),("bamboo",111),("tea",306),("comfrey",400),("clover",500)],
   species=[111,202,207,208,306,400,500]),
 "trop_dry": dict(hz=["drought","heat"], color="#b8862a",
   params=("land",7,4,0.04,0.35,0.3,False),
   plants=[("mango",208),("citrus",202),("pomegranate",201),("comfrey",400),("clover",500)],
   species=[201,202,208,400,500]),
 "medit": dict(hz=["drought","fire","heat"], color="#8a6a3a", invasive=True,
   params=("land",8,5,0.04,0.35,0.3,False),
   plants=[("olive",203),("fig",200),("citrus",202),("almond",105),("grapevine",600),("rosemary",300),("clover",500)],
   species=[105,200,202,203,300,500,600]),
 "temp_ocean": dict(hz=["wet","temperate"], color="#3a6a8a",
   params=("land",10,6,0.04,0.72,0.3,True),
   plants=[("hazelnut",104),("plum",204),("cherry",112),("walnut",101),("comfrey",400),("clover",500)],
   species=[101,104,112,204,400,500]),
 "temp_cont": dict(hz=["frost","temperate"], color="#6a8a4a",
   params=("land",9,5,0.035,0.5,0.3,True),
   plants=[("walnut",101),("hazelnut",104),("plum",204),("cherry",112),("comfrey",400),("clover",500)],
   species=[101,104,112,204,400,500]),
 "cold": dict(hz=["frost"], color="#6a6a8a",
   params=("mountain",11,6,0.04,0.55,0.4,False,18.0),
   plants=[("walnut",101),("hazelnut",104),("plum",204),("cherry",112),("clover",500)],
   species=[101,104,112,204,500]),
 "arid": dict(hz=["drought","heat","desertification"], color="#b8702a",
   params=("land",5,3,0.03,0.2,0.2,False),
   plants=[("pistachio",110),("pomegranate",201),("fig",200),("saffron",402),("clover",500)],
   species=[110,200,201,402,500]),
 "highland": dict(hz=["steep","frost"], color="#5a8a5a",
   params=("mountain",16,11,0.05,0.6,0.5,True,30.0),
   plants=[("walnut",101),("cherry",112),("tea",306),("comfrey",400),("clover",500)],
   species=[101,112,306,400,500]),
}

# ── The 80 countries: (name, location, lat, lon, band, stars) ───────────────
C = [
 ("Portugal","Alentejo",39.5,-8.0,"medit",4),
 ("Spain","Andalusia",37.4,-4.8,"medit",4),
 ("France","Provence",43.9,6.0,"medit",3),
 ("Italy","Tuscany",43.4,11.2,"medit",3),
 ("Greece","Crete",35.2,24.9,"medit",3),
 ("Germany","Bavaria",48.8,11.5,"temp_cont",2),
 ("United Kingdom","Kent",51.2,0.7,"temp_ocean",2),
 ("Ireland","Munster",52.3,-8.6,"temp_ocean",2),
 ("Netherlands","Holland",52.2,4.9,"temp_ocean",2),
 ("Switzerland","Valais",46.2,7.4,"highland",3),
 ("Austria","Tyrol",47.3,11.4,"highland",3),
 ("Poland","Masovia",52.2,21.0,"temp_cont",3),
 ("Ukraine","Cherkasy",49.4,32.1,"temp_cont",3),
 ("Russia","Krasnodar",45.0,39.0,"temp_cont",4),
 ("Sweden","Skane",55.7,13.2,"cold",4),
 ("Norway","Vestland",60.4,6.4,"cold",4),
 ("Romania","Transylvania",46.5,24.5,"temp_cont",3),
 ("Hungary","Pannonia",47.0,19.0,"temp_cont",3),
 ("Czechia","Bohemia",49.8,14.4,"temp_cont",2),
 ("Georgia","Kakheti",41.9,45.7,"temp_cont",3),
 ("Japan","Kansai",34.7,135.5,"temp_ocean",2),
 ("China","Yunnan",25.0,101.6,"highland",2),
 ("South Korea","Jeolla",35.0,127.0,"temp_ocean",2),
 ("India","Kerala",10.5,76.3,"trop_wet",3),
 ("Indonesia","Bali",-8.4,115.2,"trop_wet",2),
 ("Thailand","Chiang Mai",18.8,99.0,"trop_wet",2),
 ("Vietnam","Mekong Delta",10.0,105.8,"trop_wet",2),
 ("Philippines","Luzon",16.0,121.0,"trop_wet",3),
 ("Malaysia","Cameron Highlands",4.5,101.4,"trop_wet",2),
 ("Iran","Gilan",37.3,49.8,"arid",4),
 ("Turkey","Anatolia",39.0,35.0,"medit",3),
 ("Israel","Galilee",32.8,35.3,"medit",4),
 ("Saudi Arabia","Asir",18.2,42.5,"arid",5),
 ("Iraq","Mesopotamia",33.3,44.4,"arid",5),
 ("Pakistan","Punjab",31.5,73.1,"arid",4),
 ("Bangladesh","Bengal",23.7,90.4,"trop_wet",3),
 ("Sri Lanka","Kandy",7.3,80.6,"trop_wet",2),
 ("Nepal","Kathmandu Valley",27.7,85.3,"highland",3),
 ("Myanmar","Shan",21.0,97.0,"trop_wet",3),
 ("Kazakhstan","Almaty",43.2,76.9,"temp_cont",4),
 ("Uzbekistan","Fergana",40.4,71.8,"arid",4),
 ("Cambodia","Siem Reap",13.4,103.9,"trop_wet",3),
 ("South Africa","Cape Winelands",-33.7,19.0,"medit",4),
 ("Nigeria","Cross River",5.9,8.6,"trop_wet",3),
 ("Egypt","Nile Delta",30.8,31.0,"arid",5),
 ("Kenya","Rift Valley",-0.3,36.1,"highland",3),
 ("Ethiopia","Shewa",9.0,38.7,"highland",3),
 ("Morocco","Atlas",31.8,-6.5,"medit",4),
 ("Tanzania","Kilimanjaro",-3.1,37.4,"highland",3),
 ("Ghana","Ashanti",6.7,-1.6,"trop_wet",3),
 ("Uganda","Buganda",0.3,32.6,"trop_wet",2),
 ("Algeria","Tell Atlas",36.5,3.0,"medit",4),
 ("Tunisia","Cap Bon",36.8,10.8,"medit",4),
 ("Senegal","Casamance",12.6,-16.0,"trop_dry",4),
 ("Cameroon","West",5.5,10.4,"trop_wet",3),
 ("Ivory Coast","Lagunes",5.4,-4.0,"trop_wet",3),
 ("Zimbabwe","Highveld",-18.0,31.0,"trop_dry",4),
 ("Madagascar","Antananarivo",-19.0,47.0,"highland",3),
 ("USA","California",37.2,-120.0,"medit",4),
 ("Canada","British Columbia",49.5,-123.0,"temp_ocean",3),
 ("Mexico","Oaxaca",17.0,-96.7,"highland",3),
 ("Brazil","Bahia",-12.5,-41.7,"trop_wet",3),
 ("Argentina","Argentine Pampas",-34.0,-61.0,"temp_cont",3),
 ("Chile","Maipo Valley",-34.5,-71.0,"medit",3),
 ("Colombia","Antioquia",6.2,-75.6,"trop_wet",2),
 ("Peru","Sacred Valley",-13.3,-72.1,"highland",3),
 ("Ecuador","Cotopaxi",-1.5,-78.5,"highland",3),
 ("Bolivia","Yungas",-16.3,-67.7,"highland",3),
 ("Venezuela","Merida",8.6,-71.1,"trop_wet",3),
 ("Cuba","Vinales",22.6,-83.7,"trop_wet",3),
 ("Guatemala","Antigua",14.6,-90.7,"highland",3),
 ("Costa Rica","Meseta Central",9.9,-84.1,"trop_wet",2),
 ("Uruguay","Uruguayan Pampas",-33.0,-56.0,"temp_cont",2),
 ("Paraguay","Itapua",-26.8,-55.9,"trop_dry",3),
 ("Australia","Tasmania",-42.0,146.8,"temp_ocean",3),
 ("New Zealand","Canterbury",-43.5,172.0,"temp_ocean",2),
 ("Papua New Guinea","Wahgi Valley",-6.0,144.0,"trop_wet",3),
 ("Fiji","Viti Levu",-17.8,178.0,"trop_wet",2),
 ("Azerbaijan","Ganja",40.7,46.4,"arid",4),
 ("Lebanon","Bekaa",33.9,36.0,"medit",4),
]
assert len(C) == 80, len(C)
assert C[20][0] == "Japan" and C[20][1] == "Kansai", "Japan must keep Kansai"
locs = [c[1] for c in C]
assert len(set(locs)) == 80, "location names must be unique"

INVASIVE_EXTRA = {"Australia"}  # eucalyptus risk outside the medit band

def cx(lon): return round((lon+180)/360*700)
def cy(lat): return round((90-lat)/180*320)

def js():
    wc, geo, rinfo, plants = [], [], [], []
    for i,(name,loc,lat,lon,band,stars) in enumerate(C):
        b = BANDS[band]
        hz = '", "'.join(b["hz"])
        wc.append(f'    {{ name: "{name}", start: {i}, count: 1, color: "{b["color"]}",\n'
                  f'      cx: {cx(lon)}, cy: {cy(lat)}, regions: ["{loc}"] }},')
        geo.append(f'    "{name}": {{ lat: {lat}, lon: {lon}, stars: {stars}, hazards: ["{hz}"] }},')
        rinfo.append(f'    "{loc}": {{ lat: {lat}, lon: {lon}, stars: {stars}, hazards: ["{hz}"] }},')
        rows = ',\n'.join(f'        {{ action: "plant-{n}", label: "{TITLE[n]}", sid: {s} }}'
                          for n,s in b["plants"])
        plants.append(f'    "{name}": [\n{rows}\n    ],')
    return ("\n".join(wc), "\n".join(geo), "\n".join(rinfo), "\n".join(plants))

WORLD_JS_TMPL = '''// data/world.js  ── GENERATED by tools/gen_countries.py (80 countries, 1 location each)
// Static world data: the playable countries (one location each, index-aligned
// with the server's REGIONS table) + the species each lets you plant.

export const WORLD_COUNTRIES = [
{wc}
];

export const COUNTRY_PLANTS = {{
{plants}
}};

export function getCountryForRegion(regionIndex) {{
    for (const c of WORLD_COUNTRIES) {{
        if (regionIndex >= c.start && regionIndex < c.start + c.count) return c.name;
    }}
    return "Portugal";
}}

// True centroid lat/lon (globe pins) + difficulty (1 easy … 5 brutal) + hazards.
export const COUNTRY_GEO = {{
{geo}
}};

// One location per country → REGION_INFO mirrors COUNTRY_GEO, keyed by location.
export const REGION_INFO = {{
{rinfo}
}};

// Hazard vocabulary → emoji + label. "Good" traits read green; the rest are challenges.
export const HAZARD_META = {{
    eucalyptus:      {{ icon: "🌲", label: "Eucalyptus", bad: true }},
    fire:            {{ icon: "🔥", label: "Wildfire",    bad: true }},
    drought:         {{ icon: "🌵", label: "Drought",     bad: true }},
    heat:            {{ icon: "☀️", label: "Extreme heat", bad: true }},
    frost:           {{ icon: "❄️", label: "Frost",        bad: true }},
    salinity:        {{ icon: "🧂", label: "Salinity",     bad: true }},
    desertification: {{ icon: "🏜️", label: "Desertification", bad: true }},
    typhoon:         {{ icon: "🌀", label: "Typhoons",     bad: true }},
    volcanic:        {{ icon: "🌋", label: "Volcanic",     bad: true }},
    flood:           {{ icon: "🌊", label: "Flooding",     bad: true }},
    erosion:         {{ icon: "⛰️", label: "Erosion",      bad: true }},
    deforestation:   {{ icon: "🪓", label: "Deforestation", bad: true }},
    steep:           {{ icon: "📐", label: "Steep terrain", bad: true }},
    wind:            {{ icon: "🌬️", label: "Strong wind",  bad: true }},
    wet:             {{ icon: "🌧️", label: "Reliable rain", bad: false }},
    humid:           {{ icon: "💧", label: "Humid",        bad: false }},
    fog:             {{ icon: "🌫️", label: "Coastal fog",  bad: false }},
    fertile:         {{ icon: "🌱", label: "Fertile soil", bad: false }},
    temperate:       {{ icon: "🌤️", label: "Mild climate", bad: false }},
    coastal:         {{ icon: "⚓", label: "Coastal",      bad: false }},
    lake:            {{ icon: "🛶", label: "Lakeside",     bad: false }},
}};

export function difficultyColor(stars) {{
    switch (Math.max(1, Math.min(5, stars | 0))) {{
        case 1: return {{ hex: "#4caf50", name: "Easy" }};
        case 2: return {{ hex: "#9ccc4a", name: "Gentle" }};
        case 3: return {{ hex: "#ffc83d", name: "Moderate" }};
        case 4: return {{ hex: "#ff8a3d", name: "Hard" }};
        default: return {{ hex: "#f4453d", name: "Brutal" }};
    }}
}}

export function regionInfoByIndex(regionIndex) {{
    for (const c of WORLD_COUNTRIES) {{
        if (regionIndex >= c.start && regionIndex < c.start + c.count) {{
            const name = c.regions[regionIndex - c.start];
            return {{ name, country: c.name, ...(REGION_INFO[name] || {{ stars: 3, hazards: [] }}) }};
        }}
    }}
    return null;
}}
'''

def write_world_js():
    wc, geo, rinfo, plants = js()
    out = WORLD_JS_TMPL.format(wc=wc, geo=geo, rinfo=rinfo, plants=plants)
    with open(os.path.join(ROOT,"web/data/world.js"),"w") as f: f.write(out)

def rparams(p):
    kind = p[0]
    if kind=="land":
        _,b,a,fr,m,r,riv = p
        return f"RegionParams::land({b:.1f}, {a:.1f}, {fr}, {m}, {r}, {str(riv).lower()})"
    if kind=="mountain":
        _,b,a,fr,m,r,riv,snow = p
        return f"RegionParams::mountain({b:.1f}, {a:.1f}, {fr}, {m}, {r}, {str(riv).lower()}, {snow:.1f})"

def rust_countries():
    lines = ["pub const COUNTRIES: &[CountryInfo] = &["]
    for i,(name,*_rest) in enumerate(C):
        lines.append(f'    CountryInfo {{ name: "{name}", region_start: {i}, region_count: 1 }},')
    lines.append("];")
    return "\n".join(lines)

def rust_regions():
    lines = ["pub const REGIONS: &[(&str, RegionParams)] = &["]
    for (name,loc,lat,lon,band,stars) in C:
        lines.append(f'    ("{loc}",')
        lines.append(f'     {rparams(BANDS[band]["params"])}),')
    lines.append("];")
    return "\n".join(lines)

def group_by_band():
    g = {}
    for (name,loc,lat,lon,band,stars) in C:
        g.setdefault(band,[]).append(name)
    return g

def rust_native():
    g = group_by_band()
    arms = []
    for band, names in g.items():
        pat = " | ".join(f'Some("{n}")' for n in names)
        sp = ", ".join(str(s) for s in BANDS[band]["species"])
        arms.append(f"        {pat}\n            => &[{sp}],")
    body = "\n".join(arms)
    return ("pub fn native_species_for_region(region_index: u8) -> &'static [u16] {\n"
            "    let country = COUNTRIES.iter().find(|c|\n"
            "        region_index >= c.region_start && region_index < c.region_start + c.region_count\n"
            "    );\n"
            "    match country.map(|c| c.name) {\n"
            f"{body}\n"
            "        _ => &[100, 200, 300, 400, 500],\n"
            "    }\n"
            "}")

def rust_invasive():
    names = [n for (n,loc,lat,lon,band,stars) in C if BANDS[band].get("invasive")]
    names += [n for n in INVASIVE_EXTRA if n not in names]
    pat = " | ".join(f'Some("{n}")' for n in names)
    return ("pub fn invasive_species_for_region(region_index: u8) -> Option<u16> {\n"
            "    let country = COUNTRIES.iter().find(|c|\n"
            "        region_index >= c.region_start && region_index < c.region_start + c.region_count\n"
            "    );\n"
            "    match country.map(|c| c.name) {\n"
            f"        {pat}\n            => Some(103),\n"
            "        _ => None,\n"
            "    }\n"
            "}")

def patch_generate_rs():
    path = os.path.join(ROOT,"crates/ff-voxel/src/generate.rs")
    s = open(path).read()
    s = re.sub(r"pub const COUNTRIES: &\[CountryInfo\] = &\[.*?\n\];", rust_countries(), s, count=1, flags=re.S)
    s = re.sub(r"pub const REGIONS: &\[\(&str, RegionParams\)\] = &\[.*?\n\];", rust_regions(), s, count=1, flags=re.S)
    s = re.sub(r"pub fn native_species_for_region\(region_index: u8\) -> &'static \[u16\] \{.*?\n\}", rust_native(), s, count=1, flags=re.S)
    s = re.sub(r"pub fn invasive_species_for_region\(region_index: u8\) -> Option<u16> \{.*?\n\}", rust_invasive(), s, count=1, flags=re.S)
    open(path,"w").write(s)

if __name__ == "__main__":
    write_world_js()
    patch_generate_rs()
    print(f"OK · {len(C)} countries, {len(C)} locations · Japan→{C[20][1]}")
