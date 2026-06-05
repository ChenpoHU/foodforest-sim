// aurona.js — Aurona Singer's Stage.
//
// Renders her three songs as colourful procedurally-drawn cover art, shows the
// lyrics, and *performs* them: a chiptune backing (Web Audio) under a glorious
// robotic deadpan voice (Web Speech), with karaoke highlighting. If speech
// synthesis isn't available it falls back to a timed karaoke scroll over the
// melody, so "she sings" always does something.

import { AURONA, SONGS, NOTE_FREQ } from "./data/aurona.js";

// ── Procedural cover art ─────────────────────────────────────────────
export function drawCover(canvas, song) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const p = song.palette;
    ctx.clearRect(0, 0, w, h);

    // Background wash.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, p.bg1); g.addColorStop(1, p.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Vignette.
    const vg = ctx.createRadialGradient(w / 2, h * 0.42, w * 0.1, w / 2, h * 0.5, w * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

    ({ strawberry: drawStrawberry, enhanced: drawEnhanced, humandroid: drawHumandroid }[song.cover]
        || drawStrawberry)(ctx, w, h, p);

    // Title block.
    ctx.textAlign = "center";
    ctx.fillStyle = p.ink;
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    ctx.font = `800 ${Math.round(w * 0.105)}px system-ui, sans-serif`;
    wrapText(ctx, song.title.toUpperCase(), w / 2, h * 0.80, w * 0.92, w * 0.11);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = p.glow;
    ctx.font = `600 italic ${Math.round(w * 0.05)}px Georgia, serif`;
    ctx.fillText(song.subtitle, w / 2, h * 0.92);
    // Artist chip.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(ctx, w * 0.04, h * 0.04, w * 0.36, h * 0.085, 8); ctx.fill();
    ctx.fillStyle = p.sub; ctx.textAlign = "left";
    ctx.font = `700 ${Math.round(w * 0.038)}px system-ui, sans-serif`;
    ctx.fillText("🎤 AURONA", w * 0.075, h * 0.097);
}

function drawStrawberry(ctx, w, h, p) {
    // Heat glow at the field's edge (the "burned summer", abstract).
    const fg = ctx.createLinearGradient(0, h, 0, h * 0.55);
    fg.addColorStop(0, "rgba(255,120,40,0.55)"); fg.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = fg; ctx.fillRect(0, h * 0.55, w, h * 0.45);
    // Lover silhouette (torso).
    ctx.fillStyle = "rgba(10,2,6,0.85)";
    ctx.beginPath(); ctx.moveTo(w * 0.40, h * 0.66); ctx.lineTo(w * 0.60, h * 0.66);
    ctx.lineTo(w * 0.64, h * 0.70); ctx.lineTo(w * 0.36, h * 0.70); ctx.closePath(); ctx.fill();
    // Strawberry HEAD where her face had gone.
    const cx = w * 0.5, cy = h * 0.46, r = w * 0.17;
    ctx.fillStyle = "#e21d4a";
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 1.25);
    ctx.bezierCurveTo(cx - r * 1.3, cy + r * 0.4, cx - r, cy - r, cx, cy - r * 0.9);
    ctx.bezierCurveTo(cx + r, cy - r, cx + r * 1.3, cy + r * 0.4, cx, cy + r * 1.25);
    ctx.fill();
    // Seeds.
    ctx.fillStyle = "#ffd86b";
    for (let i = 0; i < 22; i++) {
        const a = i * 2.39, rr = (i / 22) * r * 0.9;
        const sx = cx + Math.cos(a) * rr, sy = cy - r * 0.1 + Math.sin(a) * rr * 1.1;
        ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.05, r * 0.09, a, 0, 7); ctx.fill();
    }
    // Leaf crown.
    ctx.fillStyle = "#3aa64a";
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.95);
        ctx.lineTo(cx + i * r * 0.34, cy - r * 1.5);
        ctx.lineTo(cx + i * r * 0.34 + r * 0.16, cy - r * 1.0);
        ctx.closePath(); ctx.fill();
    }
    // The boss — a small cold shadow to the side.
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.beginPath(); ctx.arc(w * 0.83, h * 0.4, w * 0.045, 0, 7); ctx.fill();
    ctx.fillRect(w * 0.79, h * 0.44, w * 0.08, h * 0.16);
}

function drawEnhanced(ctx, w, h, p) {
    // Circuit traces.
    ctx.strokeStyle = "rgba(38,230,255,0.35)"; ctx.lineWidth = Math.max(1, w * 0.006);
    for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        let x = (i / 7) * w, y = h * 0.15;
        ctx.moveTo(x, 0);
        for (let s = 0; s < 4; s++) { y += h * 0.18; x += (s % 2 ? 1 : -1) * w * 0.08; ctx.lineTo(x, y); }
        ctx.stroke();
    }
    // Glowing heart with a chip inside.
    const cx = w * 0.5, cy = h * 0.44, s = w * 0.16;
    ctx.save(); ctx.shadowColor = p.glow; ctx.shadowBlur = 28;
    ctx.fillStyle = "#ff2d8e";
    ctx.beginPath();
    ctx.moveTo(cx, cy + s);
    ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.4, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.4);
    ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.4, cy - s * 0.4, cx, cy + s);
    ctx.fill(); ctx.restore();
    // Chip.
    ctx.fillStyle = "#0a0420"; ctx.strokeStyle = p.glow; ctx.lineWidth = w * 0.008;
    roundRect(ctx, cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84, 4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(38,230,255,0.8)"; ctx.lineWidth = w * 0.01;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(cx - s * 0.55, cy + i * s * 0.22); ctx.lineTo(cx - s * 0.42, cy + i * s * 0.22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + s * 0.42, cy + i * s * 0.22); ctx.lineTo(cx + s * 0.55, cy + i * s * 0.22); ctx.stroke();
    }
    // Floating capsules (pills).
    for (let i = 0; i < 6; i++) {
        const px = w * (0.12 + 0.76 * ((i * 0.37) % 1));
        const py = h * (0.2 + 0.5 * ((i * 0.61) % 1));
        ctx.save(); ctx.translate(px, py); ctx.rotate(i);
        ctx.fillStyle = "#26e6ff"; roundRect(ctx, -w * 0.03, -w * 0.013, w * 0.06, w * 0.026, w * 0.013); ctx.fill();
        ctx.fillStyle = "#f3eaff"; roundRect(ctx, -w * 0.03, -w * 0.013, w * 0.03, w * 0.026, w * 0.013); ctx.fill();
        ctx.restore();
    }
}

function drawHumandroid(ctx, w, h, p) {
    const cx = w * 0.5, cy = h * 0.42, r = w * 0.17;
    // Head — left flesh, right machine.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
    ctx.fillStyle = "#d8a07a"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); ctx.closePath();
    ctx.fillStyle = "#7d8b99"; ctx.fill();
    ctx.restore();
    // Machine panel lines + chip.
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = w * 0.006;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(cx, cy - r + i * r * 0.5); ctx.lineTo(cx + r * 0.9, cy - r + i * r * 0.5); ctx.stroke(); }
    ctx.fillStyle = p.glow; roundRect(ctx, cx + r * 0.2, cy - r * 0.12, r * 0.45, r * 0.28, 3); ctx.fill();
    // Eye.
    ctx.fillStyle = "#1a1f25"; ctx.beginPath(); ctx.arc(cx - r * 0.4, cy - r * 0.1, r * 0.12, 0, 7); ctx.fill();
    ctx.fillStyle = "#ff5252"; ctx.fillRect(cx + r * 0.42, cy - r * 0.12, r * 0.18, r * 0.06);
    // Brain chip on top.
    ctx.strokeStyle = p.ink; ctx.lineWidth = w * 0.008;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI; ctx.lineTo(cx - r * 0.6 + i * r * 0.12, cy - r * 1.05 - Math.sin(a * 3) * r * 0.12); }
    ctx.stroke();
    // Barcode.
    let bx = w * 0.1;
    for (let i = 0; i < 26 && bx < w * 0.9; i++) { const bw = ((i * 37) % 5) + 1; ctx.fillStyle = i % 2 ? "rgba(0,0,0,0)" : p.ink; ctx.fillRect(bx, h * 0.66, bw, h * 0.05); bx += bw + 2; }
    // Marching silhouettes.
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (let i = 0; i < 5; i++) { const mx = w * (0.12 + i * 0.18); ctx.beginPath(); ctx.arc(mx, h * 0.74, w * 0.018, 0, 7); ctx.fill(); ctx.fillRect(mx - w * 0.012, h * 0.75, w * 0.024, h * 0.05); }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(" "); let line = "", yy = y;
    const lines = [];
    for (const wd of words) {
        if (ctx.measureText(line + wd).width > maxW && line) { lines.push(line.trim()); line = wd + " "; }
        else line += wd + " ";
    }
    lines.push(line.trim());
    yy -= (lines.length - 1) * lineH * 0.5;
    for (const l of lines) { ctx.fillText(l, x, yy); yy += lineH; }
}

// ── Performance (audio + voice) ──────────────────────────────────────
let audioCtx = null;
const perf = { playing: false, loading: false, song: null, master: null, timers: [], lineEls: [] };

// One shared per-line pitch contour for Aurona's talk-singing. This is THE
// voice the user liked — the "Doctor of vibes with a clipboard grin…" verse of
// "Enhanced Love Games". In the old per-line code those four lines landed on
// E5/E5/F5/E5 at the top of the melody, which produced SpeechSynthesis pitch
// ≈ 1.50, 1.50, 1.65, 1.50 — a bright, pleasant register. The OTHER parts of
// the song dropped to ≈0.65 (the deeper voice the user disliked). So we lock
// every line of every song into that bright ~1.5 band, with only the same
// gentle lilt those four good lines had — never dropping into the low register.
const VOCAL_CONTOUR = [1.50, 1.50, 1.65, 1.50, 1.55, 1.48, 1.62, 1.52, 1.47, 1.58, 1.51, 1.60];

function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
}

// A *sung* note — a vowel-ish voice: sawtooth through two band-pass "formants"
// with gentle vibrato and a soft attack/sustain/release, so it actually sings
// the tune instead of reading it flat. (This is the fix for "she just read.")
function singVoice(freq, start, dur, master) {
    const ctx = audioCtx;
    const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.setValueAtTime(freq, start);
    // a tiny scoop up into the note → a more human, sung onset
    osc.frequency.setValueAtTime(freq * 0.94, start);
    osc.frequency.exponentialRampToValueAtTime(freq, start + 0.06);
    // vibrato
    const vib = ctx.createOscillator(); vib.type = "sine"; vib.frequency.value = 5.6;
    const vibGain = ctx.createGain(); vibGain.gain.value = freq * 0.012;
    vib.connect(vibGain); vibGain.connect(osc.frequency);
    // two formants → an "aah" vowel colour
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 740; f1.Q.value = 7;
    const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1180; f2.Q.value = 10;
    const g = ctx.createGain();
    const peak = 0.18;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.05);
    g.gain.setValueAtTime(peak, start + dur * 0.62);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(f1); osc.connect(f2); f1.connect(g); f2.connect(g); g.connect(master);
    osc.start(start); vib.start(start);
    osc.stop(start + dur + 0.06); vib.stop(start + dur + 0.06);
}

// Soft root under each line for warmth (the little backing track).
function bassNote(freq, start, dur, master) {
    const o = audioCtx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.06, start + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
}

function highlight(idx) {
    perf.lineEls.forEach((el, i) => el && el.classList.toggle("on", i === idx));
    const el = perf.lineEls[idx];
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Notes-per-line = syllable count (vowel groups), so longer lines sing longer.
function syllableCount(line) {
    const words = line.toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);
    let n = 0;
    for (const w of words) { const m = w.match(/[aeiouy]+/g); n += Math.max(1, m ? m.length : 1); }
    return Math.min(18, Math.max(1, n));
}

// Lightweight performance — a little synth arrangement (chord pad + bass + an
// expressive vowel-lead voice with vibrato singing the tune), with the lyrics
// scrolling karaoke-style. Pure Web Audio: no downloads, no main-thread jank.
function startPerf(song) {
    stopPerf();
    const ctx = ensureCtx();
    perf.playing = true; perf.song = song;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 0.12);
    master.connect(ctx.destination);
    perf.master = master;
    updateControls();
    if ("speechSynthesis" in window) singTalk(song, master);
    else instrumental(song, master);
}

// Native-voice "talk-singing": the browser's own voice carries the WORDS,
// pitched line-by-line to follow the tune, over a soft chord + bass bed. It's
// TTS-led (each line chains to the next on `onend`) so words and music stay in
// step; lightweight + no downloads. Sounds like robotic Sprechgesang — by design.
function singTalk(song, master) {
    const ctx = audioCtx;
    const sung = [];
    song.lyrics.forEach((l, idx) => { if (!/^\s*\[/.test(l)) sung.push({ idx, text: l.replace(/[()"]/g, " ") }); });
    if (!sung.length) { stopPerf(); return; }

    // Melody folded into one octave — used only for the chord/bass bed so each
    // song keeps its own music. The VOICE itself uses one shared, comfortable
    // contour (VOCAL_CONTOUR) + fixed rate, so all three songs sing in the same
    // pleasant register the way "Enhanced Love Games" did — no squeak, no growl.
    const raw = song.melody.map(([n]) => NOTE_FREQ[n] || 440);
    const base = Math.min(...raw);
    const folded = raw.map((f) => { while (f >= base * 2) f /= 2; return f; });
    const beat = 60 / song.bpm;

    let voice = null;
    const pickVoice = () => {
        const vs = window.speechSynthesis.getVoices() || [];
        voice = vs.find((v) => /en[-_]/i.test(v.lang) && /(female|samantha|victoria|karen|moira|tessa|fiona|zira|allison|ava|susan|catherine|serena)/i.test(v.name))
            || vs.find((v) => /en[-_]/i.test(v.lang)) || vs[0] || null;
    };

    let li = 0;
    const speakLine = () => {
        if (!perf.playing) return;
        if (li >= sung.length) { stopPerf(); return; }
        const { idx, text } = sung[li];
        const note = folded[li % folded.length];
        highlight(idx);
        // Musical bed for this line (chord + bass), retriggered per line.
        const t = ctx.currentTime + 0.03;
        playChord(note, t, beat * 3.2, master);
        bassNote(note / 2, t, beat * 3.2, master);
        // The talk-sung words — one consistent voice contour + pace for ALL songs.
        const u = new SpeechSynthesisUtterance(text);
        if (voice) u.voice = voice;
        u.pitch = VOCAL_CONTOUR[li % VOCAL_CONTOUR.length];
        u.rate = 0.82; u.volume = 1.0;
        u.onend = () => { li++; perf.timers.push(setTimeout(speakLine, 130)); };
        u.onerror = () => { li++; perf.timers.push(setTimeout(speakLine, 130)); };
        window.speechSynthesis.speak(u);
    };

    // Kick off only once the browser's voice list is ready. On a cold page load
    // getVoices() is often briefly empty (especially Chrome); starting before it
    // populates can leave the FIRST song silent — which is why Strawberry
    // sometimes didn't sing. Wait for `voiceschanged`, with a timeout fallback
    // so we always start even if that event never fires.
    let started = false;
    const onVoices = () => begin();
    const begin = () => {
        if (started || !perf.playing) return;
        started = true;
        try { window.speechSynthesis.removeEventListener("voiceschanged", onVoices); } catch (e) {}
        pickVoice();
        speakLine();
    };
    if ((window.speechSynthesis.getVoices() || []).length) {
        perf.timers.push(setTimeout(begin, 60));
    } else {
        try { window.speechSynthesis.addEventListener("voiceschanged", onVoices, { once: true }); } catch (e) {}
        perf.timers.push(setTimeout(begin, 800)); // fallback if the event never fires
    }
    // Chrome can quietly pause the synth on long performances; a gentle resume
    // heartbeat keeps her singing. (clearTimeout in stopPerf also clears this.)
    perf.timers.push(setInterval(() => {
        if (!perf.playing) return;
        try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (e) {}
    }, 4000));
}

// No speech voice → perform the melody instrumentally (vowel lead + chords),
// with the lyrics scrolling karaoke-style.
function instrumental(song, master) {
    const ctx = audioCtx;
    const beat = 60 / song.bpm;
    const transpose = song.voice && song.voice.pitch ? song.voice.pitch : 1;
    const notes = song.melody.map(([n]) => (NOTE_FREQ[n] || 440) * transpose);
    let t = ctx.currentTime + 0.25, mi = 0;
    song.lyrics.forEach((line, idx) => {
        if (/^\s*\[/.test(line)) return;
        const lineStart = t;
        perf.timers.push(setTimeout(() => { if (perf.playing) highlight(idx); },
            Math.max(0, (lineStart - ctx.currentTime) * 1000)));
        const root = notes[mi % notes.length];
        playChord(root / 2, lineStart, beat * 2.3, master);
        bassNote(root / 4, lineStart, beat * 2.3, master);
        const syl = syllableCount(line);
        for (let s = 0; s < syl; s++) {
            const f = notes[mi % notes.length]; mi++;
            singVoice(f, t, beat * 0.44 * 1.05, master);
            t += beat * 0.44;
        }
        t += beat * 0.55;
    });
    perf.timers.push(setTimeout(() => { if (perf.playing) stopPerf(); },
        Math.max(0, (t - ctx.currentTime) * 1000) + 500));
}

// A soft triad pad (root · major third · fifth) — the backing under each line.
function playChord(root, start, dur, master) {
    for (const r of [1, 1.26, 1.5]) {
        const o = audioCtx.createOscillator(); o.type = "sine"; o.frequency.value = root * r;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.045, start + 0.18);
        g.gain.setValueAtTime(0.045, start + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.connect(g); g.connect(master); o.start(start); o.stop(start + dur + 0.05);
    }
}

function stopPerf() {
    perf.playing = false; perf.loading = false;
    perf.timers.forEach(clearTimeout); perf.timers = [];
    if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    if (perf.master && audioCtx) {
        try {
            const m = perf.master;
            m.gain.cancelScheduledValues(audioCtx.currentTime);
            m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), audioCtx.currentTime);
            m.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
            setTimeout(() => { try { m.disconnect(); } catch (e) {} }, 220);
        } catch (e) {}
    }
    perf.master = null;
    highlight(-1);
    updateControls();
}

function updateControls() {
    const btn = document.getElementById("aurona-play");
    if (!btn) return;
    btn.textContent = perf.loading ? "🎙️  warming up her voice…"
        : (perf.playing ? "⏹  Stop" : "▶  Sing it, Aurona");
}

// ── Stage UI ─────────────────────────────────────────────────────────
let built = false;

// In-game Songbook store. The host (main.js) supplies live wallet + ownership
// + a buy callback via `storeApi`. When it's null (opened standalone), every
// song is treated as owned so the stage still works. SONG_PRICE MIRRORS the
// server's song_price() in ff-ecs/interaction.rs — keep them in sync.
let storeApi = null;
const SONG_PRICE = [90, 120, 90]; // [Strawberry, Enhanced Love Games, Humandroid]
function build() {
    if (built) return; built = true;
    const modal = document.createElement("div");
    modal.id = "aurona-modal";
    modal.innerHTML =
        "<div id='aurona-card'>" +
          "<div id='aurona-head'>" +
            "<div><div id='aurona-name'>🎤 " + AURONA.name + "</div>" +
            "<div id='aurona-tag'>" + AURONA.tagline + "</div></div>" +
            "<button id='aurona-close'>✕</button>" +
          "</div>" +
          "<p id='aurona-bio'>" + AURONA.bio + "</p>" +
          "<div id='aurona-store-bar'></div>" +
          "<div id='aurona-gallery'></div>" +
          "<div id='aurona-song' style='display:none;'>" +
            "<div id='aurona-song-top'>" +
              "<canvas id='aurona-cover-big' width='320' height='320'></canvas>" +
              "<div id='aurona-song-meta'>" +
                "<button id='aurona-back'>‹ all songs</button>" +
                "<div id='aurona-song-note'></div>" +
                "<button id='aurona-play'>▶  Sing it, Aurona</button>" +
                "<div id='aurona-disclaimer'>🎶 Aurona talk-sings the words over a synth track (robotic by design). Satire; every word purely metaphorical.</div>" +
              "</div>" +
            "</div>" +
            "<div id='aurona-lyrics'></div>" +
          "</div>" +
        "</div>";
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.getElementById("aurona-close").addEventListener("click", close);
    document.getElementById("aurona-back").addEventListener("click", showGallery);
    document.getElementById("aurona-play").addEventListener("click", () => {
        if (perf.playing) stopPerf(); else startPerf(perf.song);
    });

    // The gallery is populated as a STORE on each open (renderGallery), so
    // ownership + prices reflect the live wallet every time.
    if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = () => {};
}

// Render the gallery as Aurona's Songbook store: owned songs are playable,
// locked songs show a FoFo-Coin price + a Buy button. Re-callable so it
// refreshes after a purchase.
function renderGallery() {
    const gal = document.getElementById("aurona-gallery");
    if (!gal) return;
    const owned = storeApi ? (storeApi.owned() | 0) : 0xff;
    const coins = storeApi ? (storeApi.coins() | 0) : 0;

    const bar = document.getElementById("aurona-store-bar");
    if (bar) {
        bar.style.display = storeApi ? "flex" : "none";
        bar.innerHTML = storeApi
            ? "<span class='aurona-wallet'>🪙 " + coins + " FoFo</span>" +
              "<span class='aurona-store-hint'>Buy Aurona's songs with FoFo Coin — owned songs play on her stage.</span>"
            : "";
    }

    gal.innerHTML = "";
    SONGS.forEach((song, i) => {
        const isOwned = ((owned >> i) & 1) === 1;
        const price = SONG_PRICE[i] || 0;
        const item = document.createElement("div");
        item.className = "aurona-thumb" + (isOwned ? "" : " locked");
        const cv = document.createElement("canvas"); cv.width = 220; cv.height = 220;
        drawCover(cv, song);
        item.appendChild(cv);
        const cap = document.createElement("div"); cap.className = "aurona-thumb-cap";
        cap.innerHTML = "<b>" + song.title + "</b><span>" + song.subtitle + "</span>";
        item.appendChild(cap);
        const action = document.createElement("button");
        action.className = "aurona-thumb-action";
        if (isOwned) {
            action.textContent = "▶  Play";
            action.addEventListener("click", () => openSong(song));
            cv.style.cursor = "pointer";
            cv.addEventListener("click", () => openSong(song));
        } else {
            const afford = coins >= price;
            action.innerHTML = "🔒 Buy · " + price + " 🪙";
            action.disabled = !afford;
            action.title = afford ? "" : "Not enough FoFo Coin";
            action.addEventListener("click", () => { if (storeApi && storeApi.buy) storeApi.buy(i); });
        }
        item.appendChild(action);
        gal.appendChild(item);
    });
}

function openSong(song) {
    stopPerf();
    perf.song = song;
    document.getElementById("aurona-gallery").style.display = "none";
    document.getElementById("aurona-bio").style.display = "none";
    document.getElementById("aurona-song").style.display = "block";
    drawCover(document.getElementById("aurona-cover-big"), song);
    document.getElementById("aurona-song-note").textContent = song.note;
    const ly = document.getElementById("aurona-lyrics");
    ly.innerHTML = "";
    perf.lineEls = song.lyrics.map((l) => {
        const isLabel = /^\s*\[/.test(l);
        const d = document.createElement("div");
        d.className = isLabel ? "aurona-label" : "aurona-line";
        d.textContent = isLabel ? l.replace(/[\[\]]/g, "") : l;
        ly.appendChild(d);
        return isLabel ? null : d;
    });
    updateControls();
}

function showGallery() {
    stopPerf();
    document.getElementById("aurona-song").style.display = "none";
    document.getElementById("aurona-gallery").style.display = "grid";
    document.getElementById("aurona-bio").style.display = "block";
}

function close() {
    stopPerf();
    const m = document.getElementById("aurona-modal");
    if (m) m.style.display = "none";
}

export function openAuronaStage() {
    build();
    document.getElementById("aurona-modal").style.display = "flex";
    document.getElementById("aurona-song").style.display = "none";
    document.getElementById("aurona-gallery").style.display = "grid";
    document.getElementById("aurona-bio").style.display = "block";
    renderGallery();
    // Warm up the voice list.
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}

// In-game entry point: open the Songbook as a store. `api` = { coins(), owned(),
// buy(songId) } — coins() returns the live FoFo balance, owned() the ownership
// bitmask, buy() sends the purchase action. Owned songs are playable; locked
// songs offer a Buy button priced in FoFo Coin.
export function openSongbookStore(api) {
    if (api) storeApi = api;
    build();
    document.getElementById("aurona-modal").style.display = "flex";
    document.getElementById("aurona-song").style.display = "none";
    document.getElementById("aurona-gallery").style.display = "grid";
    document.getElementById("aurona-bio").style.display = "block";
    renderGallery();
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}

// Host calls this after a player-state update so a just-bought song flips from
// locked → playable (and affordability refreshes) without reopening the modal.
export function songbookChanged() {
    const m = document.getElementById("aurona-modal");
    if (!m || m.style.display !== "flex") return;
    if (document.getElementById("aurona-gallery").style.display !== "none") renderGallery();
}

// ── Aurona's Fate Oracle ─────────────────────────────────────────────────
// Unbidden, dramatic: when a Farmer dies, Aurona steps onto the screen and
// SINGS their fate, offering the brain-chip escape. Reuses the song data +
// performance engine. `onAccept` / `onChip` send the server actions.
let oracleEl = null;
function ensureOracleEl() {
    if (oracleEl) return oracleEl;
    oracleEl = document.createElement("div");
    oracleEl.id = "aurona-oracle";
    document.body.appendChild(oracleEl);
    return oracleEl;
}
function closeOracle() {
    stopPerf();
    if (oracleEl) oracleEl.style.display = "none";
}
function chippedPhase(monarchName) {
    stopPerf();
    const song = SONGS[2]; // Hu Hu Humandroid
    const el = ensureOracleEl();
    const who = monarchName ? (" — owned by " + monarchName) : "";
    el.innerHTML =
        "<div id='oracle-card' class='chipped'>" +
          "<div class='oracle-badge chip'>⛓  FIFTY PERCENT FLESH · FIFTY PERCENT TIN</div>" +
          "<div class='oracle-top'><canvas class='oracle-cover' width='200' height='200'></canvas>" +
            "<div class='oracle-meta'>" +
              "<div class='oracle-title'>" + song.title + "</div>" +
              "<div class='oracle-sub'>you live" + who + "</div>" +
              "<div class='oracle-line'>The chip hums. An Innovator can still cut it out.</div>" +
            "</div>" +
          "</div>" +
          "<div class='oracle-choices'><button id='oracle-close' class='oracle-btn ghost'>Clock in.</button></div>" +
        "</div>";
    drawCover(el.querySelector(".oracle-cover"), song);
    startPerf(song);
    el.querySelector("#oracle-close").onclick = () => closeOracle();
}
export function openFateOracle(opts = {}) {
    const { songId = 0, offerChip = false, monarchName = "", onAccept, onChip } = opts;
    stopPerf();
    const song = SONGS[songId] || SONGS[0];
    const el = ensureOracleEl();
    el.innerHTML =
        "<div id='oracle-card'>" +
          "<div class='oracle-badge'>🎤  AURONA SINGS YOUR FATE</div>" +
          "<div class='oracle-top'><canvas class='oracle-cover' width='200' height='200'></canvas>" +
            "<div class='oracle-meta'>" +
              "<div class='oracle-title'>" + song.title + "</div>" +
              "<div class='oracle-sub'>" + song.subtitle + "</div>" +
              "<div class='oracle-line'>The Monarch's game has reached your row. You can die free…</div>" +
            "</div>" +
          "</div>" +
          "<div class='oracle-choices' id='oracle-choices'></div>" +
        "</div>";
    el.style.display = "flex";
    drawCover(el.querySelector(".oracle-cover"), song);
    startPerf(song);
    const choices = el.querySelector("#oracle-choices");
    if (offerChip) {
        choices.innerHTML =
            "<button id='oracle-accept' class='oracle-btn ghost'>Accept your fate</button>" +
            "<button id='oracle-chip' class='oracle-btn chip'>🧠  Plant the chip — live</button>";
        el.querySelector("#oracle-accept").onclick = () => { closeOracle(); if (onAccept) onAccept(); };
        el.querySelector("#oracle-chip").onclick = () => { if (onChip) onChip(); chippedPhase(monarchName); };
    } else {
        choices.innerHTML = "<button id='oracle-accept' class='oracle-btn ghost'>…accept your fate</button>";
        el.querySelector("#oracle-accept").onclick = () => { closeOracle(); if (onAccept) onAccept(); };
    }
}
