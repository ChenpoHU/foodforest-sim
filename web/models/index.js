// models/index.js
// Central registry mapping entity category strings → template builders.
// main.js consults this registry first inside buildEntityMeshTemplate;
// only when no entry exists does it fall back to its inline default
// (a small gray sphere — useful for an unrecognised species id).
//
// To add a new species:
//   1. Put its builder in its own file under models/<group>/.
//   2. import it here.
//   3. Register it against the category string from classifyEntity().
//
// Each builder must be pure (no side effects, no external state) and
// return a THREE.Object3D template. main.js caches the result and
// clones it per spawn.

import { buildPlayer }   from "./player.js";

// Animals
import { buildDeer }           from "./animals/deer.js";
import { buildChicken }        from "./animals/chicken.js";
import { buildBoar }           from "./animals/boar.js";
import { buildRabbit }         from "./animals/rabbit.js";
import { buildLamb }           from "./animals/lamb.js";
import { buildGenericAnimal }  from "./animals/animal.js";

// Trees (makeTree wrappers)
import { buildEucalyptus }  from "./trees/eucalyptus.js";
import { buildChestnut }    from "./trees/chestnut.js";
import { buildWalnut }      from "./trees/walnut.js";
import { buildCarob }       from "./trees/carob.js";
import { buildFig }         from "./trees/fig.js";
import { buildPomegranate } from "./trees/pomegranate.js";
import { buildCitrus }      from "./trees/citrus.js";
import { buildOlive }       from "./trees/olive.js";
import { buildHazelnut }    from "./trees/hazelnut.js";
import { buildAlmond }      from "./trees/almond.js";
import { buildCorkoak }     from "./trees/corkoak.js";
import { buildRedwood }     from "./trees/redwood.js";
import { buildMacadamia }   from "./trees/macadamia.js";
import { buildPistachio }   from "./trees/pistachio.js";
import { buildCherry }      from "./trees/cherry.js";
import { buildPlum }        from "./trees/plum.js";
import { buildAvocado }     from "./trees/avocado.js";
import { buildMulberry }    from "./trees/mulberry.js";
import { buildMango }       from "./trees/mango.js";
import { buildPersimmon }   from "./trees/persimmon.js";
import { buildPeach }       from "./trees/peach.js";
// Trees with their own geometry
import { buildStonepine }   from "./trees/stonepine.js";
import { buildBamboo }      from "./trees/bamboo.js";
import { buildBanana }      from "./trees/banana.js";

// Plants / herbs / shrubs
import { buildRosemary }   from "./plants/rosemary.js";
import { buildLavender }   from "./plants/lavender.js";
import { buildComfrey }    from "./plants/comfrey.js";
import { buildClover }     from "./plants/clover.js";
import { buildStrawberry } from "./plants/strawberry.js";
import { buildGrapevine }  from "./plants/grapevine.js";
import { buildThyme }      from "./plants/thyme.js";
import { buildSage }       from "./plants/sage.js";
import { buildRooibos }    from "./plants/rooibos.js";
import { buildProtea }     from "./plants/protea.js";
import { buildTea }        from "./plants/tea.js";
import { buildBasil }      from "./plants/basil.js";
import { buildSaffron }    from "./plants/saffron.js";
import { buildShiso }      from "./plants/shiso.js";

// Structures
import { buildSemiAI }    from "./structures/semi_ai.js";
import { buildHochsitz }  from "./structures/hochsitz.js";

// IMPORTANT: keep the keys in sync with classifyEntity() in main.js.
export const MODEL_BUILDERS = {
    // People
    "player":     buildPlayer,
    // Animals
    "deer":       buildDeer,
    "chicken":    buildChicken,
    "boar":       buildBoar,
    "rabbit":     buildRabbit,
    "lamb":       buildLamb,
    "animal":     buildGenericAnimal,
    // Canopy trees
    "eucalyptus": buildEucalyptus,
    "chestnut":   buildChestnut,
    "walnut":     buildWalnut,
    "carob":      buildCarob,
    "fig":        buildFig,
    "pomegranate":buildPomegranate,
    "citrus":     buildCitrus,
    "olive":      buildOlive,
    "hazelnut":   buildHazelnut,
    "almond":     buildAlmond,
    "corkoak":    buildCorkoak,
    "redwood":    buildRedwood,
    "macadamia":  buildMacadamia,
    "pistachio":  buildPistachio,
    "cherry":     buildCherry,
    "plum":       buildPlum,
    "avocado":    buildAvocado,
    "mulberry":   buildMulberry,
    "mango":      buildMango,
    "persimmon":  buildPersimmon,
    "peach":      buildPeach,
    "stonepine":  buildStonepine,
    "bamboo":     buildBamboo,
    "banana":     buildBanana,
    // Plants / shrubs / herbs
    "rosemary":   buildRosemary,
    "lavender":   buildLavender,
    "comfrey":    buildComfrey,
    "clover":     buildClover,
    "strawberry": buildStrawberry,
    "grapevine":  buildGrapevine,
    "thyme":      buildThyme,
    "sage":       buildSage,
    "rooibos":    buildRooibos,
    "protea":     buildProtea,
    "tea":        buildTea,
    "basil":      buildBasil,
    "saffron":    buildSaffron,
    "shiso":      buildShiso,
    // Structures / drones
    "semi-ai":    buildSemiAI,
    "hochsitz":   buildHochsitz,
};

// Re-export the shared tree helper so any callers in main.js can still
// reach the upgraded organic-canopy builder without a deep import.
export { makeTree, makeTreePositional } from "./trees/_tree.js";
