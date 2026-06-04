#!/usr/bin/env node
// reference_agent.mjs — a tiny, dependency-free example of an external agent
// playing Food Forest through the JSON Agent API (see md/08-agent-api.md).
//
// It proves the whole loop: register → receive observations → act → get reward.
// The "policy" here is a trivial greedy Farmer (plant clover, harvest anything
// ripe, eat when hungry, wander a little). Swap `decide()` for an LLM call, an
// RL policy, or anything else — the wire contract is identical.
//
// Run (needs Node ≥ 21/22 for the built-in global WebSocket):
//   node tools/agents/reference_agent.mjs [ws://localhost:9000] [name] [role]
// role: 0 Farmer · 1 Tech-Monarch · 2 Innovator   (AIs may take any role)

const URL   = process.argv[2] || "ws://localhost:9000";
const NAME  = process.argv[3] || "Sprout";
const ROLE  = parseInt(process.argv[4] ?? "0", 10) || 0;
const LABEL = "ref-greedy-v1";

if (typeof WebSocket === "undefined") {
  console.error("This script needs Node ≥ 21 (global WebSocket). Try `node --version`.");
  process.exit(1);
}

const ws = new WebSocket(URL);
let me = null;          // welcome payload (player_id, entity_id, …)
let steps = 0;
let totalReward = 0;

ws.addEventListener("open", () => {
  console.log(`→ connecting to ${URL} as "${NAME}" (role ${ROLE})`);
  send({ op: "register", name: NAME, world: 1, region: 0, role: ROLE, label: LABEL });
});

ws.addEventListener("message", (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }

  if (msg.op === "welcome") {
    me = msg;
    console.log(`✓ welcomed as player ${msg.player_id} (entity ${msg.entity_id}). ` +
                `actions: ${msg.actions.join(", ")}`);
    return;
  }

  if (msg.op === "obs") {
    steps++;
    totalReward += msg.reward || 0;
    const act = decide(msg);
    if (act) send(act);
    if (steps % 10 === 0) {
      console.log(`step ${steps}: coins=${msg.self.coins} hunger=${msg.self.hunger} ` +
                  `nearby=${msg.nearby.length} Σreward=${totalReward} → ${act ? act.op : "idle"}`);
    }
  }
});

ws.addEventListener("close", () => {
  console.log(`connection closed after ${steps} steps, total reward ${totalReward}.`);
  process.exit(0);
});
ws.addEventListener("error", (e) => console.error("ws error:", e.message || e));

function send(obj) { ws.send(JSON.stringify(obj)); }

// ── The policy ───────────────────────────────────────────────────────────
// Pure function of the observation → one action (or null). Replace freely.
function decide(obs) {
  const self = obs.self;

  // 1. Survive: if hungry and holding something edible, eat it.
  if (self.hunger > 60) {
    const food = self.inv.find((i) => i.item >= 1200 && i.item < 3000); // fruits/meat
    if (food) return { op: "eat", item: food.item };
  }

  // 2. Trade: sell produce now and then to bank FoFo coin (the reward).
  const sellable = self.inv.find((i) => i.item >= 1000 && i.item < 2000 && i.n > 0);
  if (sellable && steps % 5 === 0) return { op: "sell", item: sellable.item, count: sellable.n };

  // 3. Grow the forest most of the time: plant a clover near where we stand
  //    (planting has no distance limit, so this reliably succeeds).
  if (steps % 3 !== 0) {
    const x = Math.round(self.pos[0] + (Math.random() * 8 - 4));
    const z = Math.round(self.pos[2] + (Math.random() * 8 - 4));
    return { op: "plant", species: 500, x, z };   // 500 = clover
  }

  // 4. Occasionally harvest the nearest fruiting plant (growth stage 5).
  const ripe = obs.nearby
    .filter((e) => e.kind === "plant" && e.stage === 5)
    .sort((a, b) => a.dist - b.dist)[0];
  if (ripe) return { op: "harvest", target: ripe.id };

  // 5. Otherwise wander a step.
  return { op: "move", dx: Math.random() * 2 - 1, dz: Math.random() * 2 - 1 };
}
