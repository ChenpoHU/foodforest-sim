import { readFileSync, writeFileSync } from "fs";

const gj = JSON.parse(readFileSync("/tmp/ne110.geojson", "utf8"));

// The seven full-country territories we highlight (must match ADMIN names
// in Natural Earth). California + Yunnan are sub-national → handled by pins.
const HIGHLIGHT = new Set([
  "Portugal", "France", "Spain", "Italy", "Iran",
  "South Africa", "Japan",
]);

const r = (n) => Math.round(n * 100) / 100; // 2-decimal ≈ 1.1 km

function ringsOfGeom(geom) {
  // Returns an array of rings; each ring is an array of [lon,lat].
  const out = [];
  const pushPoly = (poly) => {
    for (const ring of poly) {
      const cleaned = [];
      let prev = null;
      for (const [lon, lat] of ring) {
        const p = [r(lon), r(lat)];
        if (!prev || p[0] !== prev[0] || p[1] !== prev[1]) cleaned.push(p);
        prev = p;
      }
      if (cleaned.length >= 2) out.push(cleaned);
    }
  };
  if (geom.type === "Polygon") pushPoly(geom.coordinates);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach(pushPoly);
  return out;
}

const worldBorders = []; // all rings, for the faint global border layer
const countryRings = {}; // name -> rings, for highlighted outlines

for (const f of gj.features) {
  const name = f.properties.ADMIN || f.properties.NAME || f.properties.SOVEREIGNT;
  const rings = ringsOfGeom(f.geometry);
  for (const ring of rings) worldBorders.push(ring);
  if (HIGHLIGHT.has(name)) {
    countryRings[name] = (countryRings[name] || []).concat(rings);
  }
}

// Emit compact JS. Coordinates already rounded; JSON.stringify keeps them short.
const header = `// data/geo.js — AUTO-GENERATED from Natural Earth 1:110m admin-0
// countries (public domain). Exact national borders as [lon,lat] rings,
// rounded to ~1 km. Do not hand-edit; regenerate with tools/process_geo.mjs.
`;
const body =
  header +
  "export const WORLD_BORDERS = " + JSON.stringify(worldBorders) + ";\n" +
  "export const COUNTRY_RINGS = " + JSON.stringify(countryRings) + ";\n";

writeFileSync("/Users/migene/repo/foodforest-sim/web/data/geo.js", body);

const ringCount = worldBorders.length;
const ptCount = worldBorders.reduce((s, r) => s + r.length, 0);
console.log(`rings=${ringCount} points=${ptCount} bytes=${body.length}`);
console.log("highlighted:", Object.keys(countryRings).join(", "));
