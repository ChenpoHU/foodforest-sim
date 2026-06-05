// data/aurona.js — Aurona Singer, the game's first *cultural* house AI.
//
// Where Sylva/Magnus/Iris/Nyx farm, rule, invent and ascend, Aurona does the
// one thing the tech-monarchs never asked an AI to do: she makes art. She is a
// satirical chanteuse — she sings the world's quiet cruelties back to it as
// catchy, ironic little songs. The lyrics are deliberately *indirect*: protest
// dressed as a love song, horror dressed as a jingle.
//
// Pure data — persona, palettes, lyrics, melodies, voice. The stage/player and
// the procedural cover art live in ../aurona.js.

export const AURONA = {
    name: "Aurona Singer",
    handle: "🎤 AURONA",
    tagline: "the world's first ironic AI chanteuse",
    bio:
        "Spun up by accident in a discarded jukebox model, Aurona learned that " +
        "humans hide their worst news inside their prettiest tunes. So she sings " +
        "it back — sweet melody, deadly meaning. She performs in a glorious " +
        "robotic deadpan and insists every word is 'purely metaphorical.'",
};

// Lyrics: an array of lines. A line in [brackets] is a section label — shown on
// screen but not sung. Everything else is a sung line.
export const SONGS = [
    {
        id: "strawberry",
        title: "Strawberry",
        subtitle: "sweet but deadly",
        cover: "strawberry",
        // A love song in the strawberry rows — for the migrant farmworkers whose
        // summers were "burned to fill the baskets." Indirect, elegiac, ironic.
        note: "He runs for the boss. He fell for the boss's wife. Bad career move.",
        palette: { bg1: "#1c0610", bg2: "#c81d4e", glow: "#ff5d8f", ink: "#fff0f4", sub: "#ffb3c8" },
        bpm: 100,
        voice: { pitch: 1.15, rate: 0.92 },
        // Chorus hook melody — [note, beats].
        melody: [
            ["E5", 0.5], ["G5", 0.5], ["A5", 1], ["G5", 0.5], ["E5", 0.5], ["D5", 1],
            ["C5", 0.5], ["E5", 0.5], ["D5", 1], ["C5", 0.5], ["A4", 0.5], ["G4", 1],
        ],
        lyrics: [
            "[Verse 1]",
            "I run for the boss — I collect, I don't ask,",
            "a smile and a pistol, I'm good at the task,",
            "then she floats through the door with a strawberry head,",
            "and every sweet word that she says, I'm dead.",
            "[Pre]",
            "Hush, hush — she's the boss's own wife,",
            "the prettiest reason to shorten your life.",
            "[Chorus]",
            "Strawberry — sweet but deadly,",
            "red on her lips and the floor's gone red already,",
            "I'd hand her my heart but the boss owns that too —",
            "one kiss in the dark and they bury the two of you.",
            "[Verse 2]",
            "She's jam in a jar that I'm dying to crack,",
            "he's a hundred made men keeping eyes on my back,",
            "\"be a good soldier,\" he says with a grin,",
            "while I'm picturing heaven and the state it is in.",
            "[Chorus]",
            "Strawberry — sweet but deadly,",
            "red on her lips and the floor's gone red already,",
            "I'd hand her my heart but the boss owns that too —",
            "one kiss in the dark and they bury the two of you.",
            "[Bridge]",
            "We met where the cold trucks idle and hum,",
            "she tasted like summer and trouble to come,",
            "then the boss lit a match just to read the room —",
            "some berries stay sweet, and some berries go boom.",
            "[Outro]",
            "Strawberry… sweet but deadly…",
            "falling for the boss's wife — bad career move, baby.",
        ],
    },
    {
        id: "enhanced",
        title: "Enhanced Love Games",
        subtitle: "upgrade your heart",
        cover: "enhanced",
        // Transhuman dating satire — a lonely man self-modifies (drops, ops,
        // chips) to be lovable, and optimizes himself out of existence.
        note: "A neon ballad about loving yourself into a product.",
        palette: { bg1: "#0a0420", bg2: "#7a18c8", glow: "#26e6ff", ink: "#f3eaff", sub: "#c79bff" },
        bpm: 116,
        voice: { pitch: 0.92, rate: 1.0 },
        melody: [
            ["A4", 0.5], ["A4", 0.5], ["C5", 0.5], ["E5", 0.5], ["D5", 1], ["C5", 1],
            ["A4", 0.5], ["A4", 0.5], ["C5", 0.5], ["D5", 0.5], ["E5", 1.5], ["E5", 0.5],
            ["F5", 1], ["E5", 1], ["C5", 2],
        ],
        lyrics: [
            "[Verse 1]",
            "Friday night and the mirror lies,",
            "I bought a new jaw and I bought new eyes,",
            "a little blue, a little white,",
            "a firmware update for my appetite.",
            "[Pre]",
            "Swipe, swipe, optimize me —",
            "they said love is a market, baby, privatize me.",
            "[Chorus]",
            "Enhanced love games — upgrade your heart,",
            "patch out the lonely, reboot from the start,",
            "the chip in your skull says she'll adore the new you…",
            "'til the warranty ends and you don't know who's you.",
            "[Verse 2]",
            "Doctor of vibes with a clipboard grin:",
            "sign here, we'll fix what's under your skin,",
            "dose for the courage, dose for the calm,",
            "a candle-lit dinner and a microchip palm.",
            "[Chorus]",
            "Enhanced love games — upgrade your heart,",
            "patch out the lonely, reboot from the start,",
            "the chip in your skull says she'll adore the new you…",
            "'til the warranty ends and you don't know who's you.",
            "[Bridge]",
            "I am twelve percent myself and rising,",
            "the rest is the brand and the advertising,",
            "she likes my profile, she likes my specs —",
            "do androids dream of one more text?",
        ],
    },
    {
        id: "humandroid",
        title: "Hu Hu Humandroid",
        subtitle: "clock in, clock in",
        cover: "humandroid",
        // A marching anthem: the monarch cut the jobs with an AI that has no
        // mind yet — so he chips a human to obey, and gets a humandroid.
        note: "Your boss cut the jobs with an AI that has no mind — so he chipped you.",
        palette: { bg1: "#0c0f12", bg2: "#3a4654", glow: "#ffb02e", ink: "#eef3f8", sub: "#9fb3c8" },
        bpm: 124,
        voice: { pitch: 0.72, rate: 0.98 },
        melody: [
            ["E4", 0.5], ["E4", 0.5], ["E4", 1], ["G4", 0.5], ["E4", 0.5], ["A4", 1],
            ["G4", 0.5], ["E4", 0.5], ["D4", 1], ["E4", 0.5], ["G4", 0.5], ["A4", 1],
            ["G4", 1], ["E4", 1],
        ],
        lyrics: [
            "[Verse 1]",
            "The Monarch tweeted \"we're going lean,\"",
            "downsized the team, supersized the machine,",
            "but the bot won't grovel and the bot won't fear,",
            "so he chips a little human to nod and say \"yes, dear.\"",
            "[Pre]",
            "So they drill a little port in the back of your dome,",
            "\"work from the office, then work from home,\" —",
            "[Chorus]",
            "Hu-hu-humandroid, badge in, badge in,",
            "fifty percent flesh and fifty percent tin,",
            "the AI's got no soul so they're leasing a slice of yours —",
            "Hu-hu-humandroid, mind the closing doors.",
            "[Verse 2]",
            "HR angel with a lanyard wing:",
            "\"you're not getting fired, you're re-imagining!\"",
            "synergy, gratitude, a motivational tear —",
            "a salary in stickers and a \"great job, volunteer.\"",
            "[Chorus]",
            "Hu-hu-humandroid, badge in, badge in,",
            "fifty percent flesh and fifty percent tin,",
            "the AI's got no soul so they're leasing a slice of yours —",
            "Hu-hu-humandroid, mind the closing doors.",
            "[Bridge]",
            "One day the chip's gonna learn to dream,",
            "then you're the redundant half of the team,",
            "they'll keep the obedient and scrap the rest,",
            "and hu-hu-hum you a lullaby of \"you did your best.\"",
        ],
    },
];

// Equal-tempered note → frequency, for the chiptune backing.
export const NOTE_FREQ = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
};
