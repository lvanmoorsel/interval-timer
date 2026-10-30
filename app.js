"use strict";

// ---------- Workout parsing ----------
// Twee invoervormen, beide bruikbaar als link (#...) of geplakte tekst:
//   JSON:     {"title":"…","work":20,"rest":10,"rounds":6,"exercises":[{"name":"…","detail":"…"}]}
//   Compact:  t=Titel&p=15&w=20&r=10&n=6&b=20&e=Push ups~Borst|Bent over row~Rug
// In een link staat JSON achter j= (percent-encoded).

function parseInput(raw) {
  let s = raw.trim();
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(hash + 1);
  if (s.startsWith("{")) return normalize(JSON.parse(s));
  const q = new URLSearchParams(s);
  if (q.has("j")) return normalize(JSON.parse(q.get("j")));
  if (q.has("e")) {
    return normalize({
      title: q.get("t") || "Workout",
      prepare: num(q.get("p")), work: num(q.get("w")), rest: num(q.get("r")),
      rounds: num(q.get("n")), betweenExercises: num(q.get("b")),
      exercises: q.get("e").split("|").map(x => {
        const [name, detail] = x.split("~");
        return { name: name.trim(), detail: (detail || "").trim() };
      }),
    });
  }
  throw new Error("Geen workout gevonden in deze tekst");
}

const num = v => (v === null || v === "" || v === undefined ? undefined : Number(v));

function normalize(w) {
  const out = {
    title: w.title || "Workout",
    prepare: w.prepare ?? 10,
    work: w.work ?? 20,
    rest: w.rest ?? 10,
    rounds: w.rounds ?? 1,
    betweenExercises: w.betweenExercises ?? w.rest ?? 10,
    exercises: (w.exercises || []).map(e => typeof e === "string" ? { name: e } : e),
  };
  if (!out.exercises.length) throw new Error("De workout heeft geen oefeningen");
  return out;
}

function buildPhases(w) {
  const ph = [];
  const exs = w.exercises;
  if (w.prepare > 0) ph.push({ type: "prepare", dur: w.prepare, ex: 0, round: 0, next: exs[0].name });
  exs.forEach((ex, i) => {
    const work = ex.work ?? w.work, rest = ex.rest ?? w.rest, rounds = ex.rounds ?? w.rounds;
    for (let r = 1; r <= rounds; r++) {
      ph.push({ type: "work", dur: work, ex: i, round: r, rounds, name: ex.name, detail: ex.detail });
      const lastRound = r === rounds, lastEx = i === exs.length - 1;
      if (lastRound && lastEx) break;
      const dur = lastRound ? w.betweenExercises : rest;
      if (dur > 0) ph.push({
        type: "rest", dur, ex: i, round: r, rounds, name: ex.name,
        next: lastRound ? exs[i + 1].name : ex.name, nextIsNewExercise: lastRound,
      });
    }
  });
  return ph;
}

// ---------- Geluid ----------
let ctx = null, muted = false;
function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
}
function beep(freq, dur, delay = 0, vol = 0.5) {
  if (muted || !ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur);
}
function speak(text) {
  if (muted || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "nl-NL"; u.rate = 1.05;
  speechSynthesis.speak(u);
}
const sound = {
  tick: () => beep(660, 0.12),                          // du, du, du
  work: () => beep(988, 0.6),                           // lange hoge toon: aan de slag
  rest: () => beep(440, 0.5),                           // lage toon: rust
  done: () => { beep(784, 0.18); beep(988, 0.18, 0.22); beep(1318, 0.5, 0.44); },
};

// ---------- Wake lock ----------
let wake = null;
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request("screen"); } catch { /* niet erg */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && running) keepAwake();
});

// ---------- Timer ----------
const $ = id => document.getElementById(id);
const fmt = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

let workout = null, phases = [], idx = 0, endAt = 0, remaining = 0, running = false, lastSec = null, timerId = null;

function startWorkout(w) {
  workout = w; phases = buildPhases(w); idx = 0;
  remaining = phases[0].dur * 1000; running = false; lastSec = null;
  saveRecent(w);
  $("home").hidden = true; $("run").hidden = false;
  $("title").textContent = w.title;
  render();
}

function enterPhase(i, announce = true) {
  idx = i;
  if (idx >= phases.length) return finish();
  const p = phases[idx];
  remaining = p.dur * 1000;
  endAt = Date.now() + remaining;
  lastSec = null;
  if (announce) {
    if (p.type === "work") { sound.work(); if (p.round === 1) speak(p.name); }
    else if (p.type === "rest") { sound.rest(); if (p.nextIsNewExercise) speak("Straks: " + p.next); }
    else if (p.type === "prepare") speak("Straks: " + p.next);
  }
  render();
}

function finish() {
  running = false; clearInterval(timerId); wake?.release?.();
  document.body.className = "done";
  $("phase").textContent = "KLAAR"; $("time").textContent = "00:00";
  $("exname").textContent = "Goed gedaan"; $("exdetail").textContent = "";
  $("next").textContent = ""; $("total").textContent = "00:00";
  $("toggle").textContent = "↺";
  sound.done(); speak("Klaar");
  idx = phases.length;
}

function tick() {
  if (!running) return;
  let rem = endAt - Date.now();
  if (rem <= 0) {
    const next = phases[idx + 1];
    if (!next) return finish();
    const over = -rem;
    enterPhase(idx + 1);
    if (over < 1000) { endAt -= over; rem = endAt - Date.now(); }
  }
  const sec = Math.ceil(rem / 1000);
  if (sec !== lastSec) {
    lastSec = sec;
    if (sec >= 1 && sec <= 3 && phases[idx].dur > 3) sound.tick();
  }
  remaining = rem;
  paintTime();
}

function toggle() {
  unlockAudio();
  if (idx >= phases.length) return startWorkout(workout);
  running = !running;
  if (running) {
    endAt = Date.now() + remaining;
    keepAwake();
    if (!timerId) timerId = setInterval(tick, 100);
    if (idx === 0 && remaining === phases[0].dur * 1000 && phases[0].type === "prepare") speak("Straks: " + phases[0].next);
  } else {
    wake?.release?.();
  }
  $("toggle").textContent = running ? "⏸" : "▶";
}

function skip() { unlockAudio(); if (idx < phases.length) enterPhase(idx + 1); if (running) endAt = Date.now() + remaining; }
function prev() {
  unlockAudio();
  const elapsed = phases[Math.min(idx, phases.length - 1)].dur * 1000 - remaining;
  enterPhase(elapsed > 2000 || idx === 0 ? Math.min(idx, phases.length - 1) : idx - 1, false);
}

// ---------- Weergave ----------
const LABEL = { prepare: "VOORBEREIDEN", work: "WERK", rest: "RUST" };
function paintTime() {
  $("time").textContent = fmt(remaining);
  let tot = remaining;
  for (let i = idx + 1; i < phases.length; i++) tot += phases[i].dur * 1000;
  $("total").textContent = fmt(tot);
}
function render() {
  const p = phases[idx];
  document.body.className = p.type;
  $("phase").textContent = LABEL[p.type];
  const ex = workout.exercises[p.ex];
  if (p.type === "prepare") { $("exname").textContent = ""; $("exdetail").textContent = ""; $("next").textContent = "Straks: " + p.next; }
  else {
    $("exname").textContent = ex.name; $("exdetail").textContent = ex.detail || "";
    $("next").textContent = p.type === "rest" ? "Straks: " + p.next : "";
  }
  const exN = workout.exercises.length, rounds = p.rounds || 0;
  const dots = (n, at) => Array.from({ length: n }, (_, i) => (i < at ? "●" : "○")).join("");
  $("exdots").textContent = p.type === "prepare" ? dots(exN, 0) : dots(exN, p.ex + 1);
  $("rdots").textContent = rounds ? dots(rounds, p.type === "rest" ? p.round : p.round) : "";
  $("toggle").textContent = running ? "⏸" : "▶";
  paintTime();
}

// ---------- Home, recents, bediening ----------
function saveRecent(w) {
  try {
    const list = JSON.parse(localStorage.getItem("recent") || "[]").filter(x => x.title !== w.title);
    list.unshift(w);
    localStorage.setItem("recent", JSON.stringify(list.slice(0, 8)));
  } catch { /* privé-modus */ }
}
function renderRecent() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem("recent") || "[]"); } catch { /* leeg */ }
  const ul = $("recent"); ul.innerHTML = "";
  if (!list.length) { ul.innerHTML = "<li><small>Nog niets. Open een link uit ChatGPT.</small></li>"; return; }
  list.forEach(w => {
    const li = document.createElement("li");
    li.innerHTML = `<b></b><small></small>`;
    li.firstChild.textContent = w.title;
    li.lastChild.textContent = `${w.exercises.length} oefeningen · ${w.work}/${w.rest} sec`;
    li.onclick = () => startWorkout(w);
    ul.appendChild(li);
  });
}
function tryLoad(text) {
  try { $("err").textContent = ""; startWorkout(parseInput(text)); history.replaceState(null, "", location.pathname); }
  catch (e) { $("err").textContent = e.message; }
}

$("quick").onclick = () => startWorkout(normalize({ title: "Tabata", prepare: 15, work: 20, rest: 10, rounds: 8, exercises: [{ name: "Tabata" }] }));
$("load").onclick = () => tryLoad($("paste").value);
$("toggle").onclick = toggle;
$("skip").onclick = skip;
$("prev").onclick = prev;
$("mute").onclick = () => { muted = !muted; $("mute").textContent = muted ? "🔇" : "🔊"; if (muted) speechSynthesis?.cancel(); };
$("back").onclick = () => {
  running = false; clearInterval(timerId); timerId = null; wake?.release?.();
  document.body.className = "home"; $("run").hidden = true; $("home").hidden = false; renderRecent();
};

renderRecent();
if (location.hash.length > 1) tryLoad(location.hash);
window.addEventListener("hashchange", () => { if (location.hash.length > 1) tryLoad(location.hash); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
