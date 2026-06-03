// audio/music.js
// Generative ambient piano — synthesised with the Web Audio API (no
// samples). Self-contained: owns its own AudioContext + bus. Call
// startAmbientMusic() once after a user gesture (browser autoplay
// policy). Safe to call repeatedly; it no-ops after the first time.

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

export function startAmbientMusic() {
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
