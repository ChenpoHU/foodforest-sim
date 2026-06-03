// data/gaits.js
// Per-species movement "habits". Each animal moves with its own
// character, layered on top of the server-driven position:
//   idleAmp/moveAmp  vertical breathing vs. stride bob amplitude (m)
//   speed            bob frequency (higher = quicker, more nervous)
//   hop              arc-jump height while moving (rabbits bound)
//   sway             side-to-side body roll in radians (waddle)
//   grazeAmt/Rate    head-down pecking/rooting/grazing dip + frequency
//   hover            drone-style float (ignores ground + grazing)
export const ANIMAL_GAITS = {
    // Chickens: fast, nervous, constant little pecks + bustling sway.
    chicken:   { idleAmp: 0.015, moveAmp: 0.05, speed: 15, hop: 0.0,  sway: 0.06, grazeAmt: 0.5,  grazeRate: 1.7 },
    // Deer: graceful slow stride, occasional calm graze, faint sway.
    deer:      { idleAmp: 0.012, moveAmp: 0.08, speed: 7,  hop: 0.0,  sway: 0.03, grazeAmt: 0.35, grazeRate: 0.4 },
    // Rabbits: distinct bounding hops, twitchy nibbles when still.
    rabbit:    { idleAmp: 0.010, moveAmp: 0.0,  speed: 3,  hop: 0.22, sway: 0.0,  grazeAmt: 0.2,  grazeRate: 0.9 },
    // Boar: heavy low gait, strong waddle, frequent rooting in the dirt.
    boar:      { idleAmp: 0.018, moveAmp: 0.045,speed: 6,  hop: 0.0,  sway: 0.11, grazeAmt: 0.55, grazeRate: 1.1 },
    // Lamb: gentle bob with the occasional playful little jump + graze.
    lamb:      { idleAmp: 0.020, moveAmp: 0.06, speed: 9,  hop: 0.07, sway: 0.05, grazeAmt: 0.3,  grazeRate: 0.5 },
    // Generic / fallback animal: plain breathing bob.
    animal:    { idleAmp: 0.020, moveAmp: 0.06, speed: 8,  hop: 0.0,  sway: 0.0,  grazeAmt: 0.0,  grazeRate: 0.0 },
    // Other players + NPCs: upright stride, no grazing.
    player:    { idleAmp: 0.025, moveAmp: 0.07, speed: 9,  hop: 0.0,  sway: 0.0,  grazeAmt: 0.0,  grazeRate: 0.0 },
    npc:       { idleAmp: 0.025, moveAmp: 0.07, speed: 9,  hop: 0.0,  sway: 0.0,  grazeAmt: 0.0,  grazeRate: 0.0 },
    // Semi-AI drone: hovers, never touches the ground.
    "semi-ai": { idleAmp: 0.0,   moveAmp: 0.0,  speed: 3.5,hop: 0.0,  sway: 0.0,  grazeAmt: 0.0,  grazeRate: 0.0, hover: true },
};
