"use strict";

const $ = id => document.getElementById(id);

// ---------- Iconen (dunne lijn) ----------
const ICONS = {
  moon: '<path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10z"/>',
  speaker: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/>',
  mute:    '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  play:    '<path d="M8 5.5v13l11-6.5z"/>',
  pause:   '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  prev:    '<path d="M6.5 5.5v13M18 6l-9 6 9 6z"/>',
  next:    '<path d="M17.5 5.5v13M6 6l9 6-9 6z"/>',
  close:   '<path d="M6 6l12 12M18 6L6 18"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  star:    '<path d="M12 4l2.5 5.2 5.7.8-4.1 4 1 5.7L12 17l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  edit:    '<path d="M5 19l1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L9 18z"/>',
  trash:   '<path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12"/>',
  replay:  '<path d="M5 12a7 7 0 1 0 2.2-5.1M5 4v4h4"/>',
};
const icon = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
document.querySelectorAll("[data-icon]").forEach(b => (b.innerHTML = icon(b.dataset.icon)));

// ---------- Workout-formaat ----------
// JSON: {"title","prepare","work","rest","rounds","cycles","restBetweenCycles","cooldown",
//        "restBetweenRounds","exercises":[{"name","detail","work?","rest?"}]}
// Compact (in een link): t= p= w= r= n= c= rc= cd= b= e=Naam~Detail|Naam~Detail   (JSON kan als j=)
const num = v => (v === null || v === undefined || v === "" ? undefined : Number(v));

function normalize(w) {
  const rest = w.rest ?? 10;
  const out = {
    id: w.id || null,
    title: w.title || "Workout",
    favorite: !!w.favorite,
    lastDone: w.lastDone || null,
    created: w.created || Date.now(),
    prepare: w.prepare ?? 10,
    work: w.work ?? 20,
    rest,
    rounds: w.rounds ?? 1,
    cycles: w.cycles ?? 1,
    restBetweenCycles: w.restBetweenCycles ?? 30,
    cooldown: w.cooldown ?? 0,
    restBetweenRounds: w.restBetweenRounds ?? w.betweenExercises ?? rest,
    exercises: (w.exercises || []).map(e => (typeof e === "string" ? { name: e } : e)),
  };
  if (!out.exercises.length) throw new Error("The workout has no exercises");
  return out;
}

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
      rounds: num(q.get("n")), cycles: num(q.get("c")), restBetweenCycles: num(q.get("rc")),
      cooldown: num(q.get("cd")), restBetweenRounds: num(q.get("b")),
      exercises: q.get("e").split("|").map(x => {
        const [name, detail] = x.split("~");
        return { name: name.trim(), detail: (detail || "").trim() };
      }),
    });
  }
  throw new Error("No workout found in this text");
}

function buildPhases(w) {
  const ph = [], exs = w.exercises, last = exs.length - 1;
  if (w.prepare > 0) ph.push({ type: "prepare", dur: w.prepare, ex: 0, round: 0, cycle: 1, next: exs[0].name });
  const add = p => {
    const prev = ph[ph.length - 1];
    if (p.type === "work") p.announceName = !prev || prev.type === "cooldown" || (prev.type === "work");
    ph.push(p);
  };
  // Een ronde = alle oefeningen één keer achter elkaar. Cyclus = alle rondes herhaald.
  for (let c = 1; c <= w.cycles; c++) {
    for (let r = 1; r <= w.rounds; r++) {
      exs.forEach((ex, i) => {
        const base = { ex: i, round: r, rounds: w.rounds, cycle: c };
        add({ ...base, type: "work", dur: ex.work ?? w.work, name: ex.name, detail: ex.detail });
        let dur = 0, next = null;
        if (i < last) { dur = ex.rest ?? w.rest; next = exs[i + 1].name; }
        else if (r < w.rounds) { dur = w.restBetweenRounds; next = exs[0].name; }
        else if (c < w.cycles) { dur = w.restBetweenCycles; next = exs[0].name; }
        if (dur > 0) add({ ...base, type: "rest", dur, name: ex.name, next });
      });
    }
  }
  if (w.cooldown > 0) ph.push({ type: "cooldown", dur: w.cooldown, ex: last, round: 0, cycle: w.cycles });
  return ph;
}
const totalSeconds = w => buildPhases(w).reduce((a, p) => a + p.dur, 0);

// ---------- Opslag ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privé-modus */ } },
};
let library = store.get("library", []).map(normalize);
let log = store.get("history", []);
const saveLib = () => store.set("library", library);
const newId = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

if (!library.length) {
  library.push(normalize({
    id: "tabata", title: "Tabata", prepare: 15, work: 20, rest: 10, rounds: 8, cycles: 4,
    restBetweenCycles: 30, cooldown: 30, exercises: [{ name: "Tabata" }],
  }));
  saveLib();
}

function upsert(w) {
  const same = library.find(x => x.title.toLowerCase() === w.title.toLowerCase());
  if (same) { Object.assign(same, w, { id: same.id, favorite: same.favorite, lastDone: same.lastDone, created: same.created }); return same; }
  w.id = newId(); w.fresh = true;
  library.unshift(w);
  return w;
}

// ---------- Helpers weergave ----------
const mmss = s => {
  s = Math.max(0, Math.ceil(s));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
const mins = s => Math.max(1, Math.round(s / 60)) + " min";
function dateLabel(ts) {
  if (!ts) return "not done yet";
  const d = new Date(ts), now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Home ----------
function cardHtml(w) {
  const names = w.exercises.length > 1 ? w.exercises.map(e => e.name).join(" · ") : "";
  const sub = [
    w.exercises.length > 1 ? `${w.exercises.length} exercises` : null,
    `${w.work}/${w.rest} sec`,
    w.rounds > 1 ? `${w.rounds} rounds` : null,
    w.cycles > 1 ? `${w.cycles} cycles` : null,
    mins(totalSeconds(w)),
  ].filter(Boolean).join(" · ");
  return `<div class="card" data-id="${w.id}">
    <div class="top">
      <div class="name">${esc(w.title)}${w.fresh ? '<span class="badge">New</span>' : ""}</div>
      <button class="mini fav ${w.favorite ? "on" : ""}" data-act="fav" aria-label="Favourite">${icon("star")}</button>
      <button class="mini" data-act="edit" aria-label="Edit">${icon("edit")}</button>
    </div>
    <div class="meta">${esc(sub)}</div>
    ${names ? `<div class="exs">${esc(names)}</div>` : ""}
    <div class="foot"><span>Last: ${dateLabel(w.lastDone)}</span><button class="start" data-act="start">Start</button></div>
  </div>`;
}

function renderHome() {
  const by = (a, b) => (b.lastDone || b.created) - (a.lastDone || a.created);
  const favs = library.filter(w => w.favorite).sort(by);
  const rest = library.filter(w => !w.favorite).sort((a, b) => (b.fresh ? 1 : 0) - (a.fresh ? 1 : 0) || by(a, b));
  $("favs-wrap").hidden = !favs.length;
  $("favs").innerHTML = favs.map(cardHtml).join("");
  $("all").innerHTML = rest.map(cardHtml).join("") || '<div class="empty">Everything is in your favourites.</div>';
  $("history").innerHTML = log.length
    ? log.slice(0, 12).map(h => `<li><span>${esc(h.title)}</span><small>${dateLabel(h.date)} · ${mins(h.seconds)}</small></li>`).join("")
    : '<li class="empty">No workouts completed yet.</li>';
}

function showView(v) {
  if (v !== "run") setDimmed(false);
  if (v === "home") setTimeout(applyPendingUpdate, 0);
  ["home", "edit", "run"].forEach(id => ($(id).hidden = id !== v));
  document.body.className = v === "run" ? document.body.className : "home";
  if (v !== "run") document.body.className = "home";
}

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-act]"), card = e.target.closest(".card");
  if (!btn || !card) return;
  const w = library.find(x => x.id === card.dataset.id);
  if (btn.dataset.act === "fav") { w.favorite = !w.favorite; saveLib(); renderHome(); }
  if (btn.dataset.act === "edit") openEditor(w);
  if (btn.dataset.act === "start") startWorkout(w);
});

function tryLoad(text) {
  try {
    $("err").textContent = "";
    const w = upsert(parseInput(text));
    saveLib(); renderHome(); showView("home");
    history_replace();
    $("paste").value = "";
    window.scrollTo(0, 0);
    return w;
  } catch (e) { $("err").textContent = e.message; }
}
const history_replace = () => window.history.replaceState(null, "", location.pathname);

// ---------- Editor ----------
let draft = null, draftIsNew = false, editing = null;
const ROWS = [
  { k: "prepare", label: "Prepare", sub: "Countdown before you start", color: "var(--prepare)", unit: "s" },
  { k: "work", label: "Work", sub: "Work for this long", color: "var(--work)", unit: "s" },
  { k: "rest", label: "Rest", sub: "Rest after each exercise", color: "var(--rest)", unit: "s" },
  { k: "rounds", label: "Rounds", sub: "One round = every exercise once", color: "var(--cool)", unit: "n" },
  { k: "cycles", label: "Cycles", sub: "How often all rounds are repeated", color: "var(--prepare)", unit: "n" },
  { k: "restBetweenCycles", label: "Rest between cycles", sub: "Recovery between cycles", color: "var(--prepare)", unit: "s" },
  { k: "restBetweenRounds", label: "Rest between rounds", sub: "Pause after the last exercise of a round", color: "var(--rest)", unit: "s" },
  { k: "cooldown", label: "Cooldown", sub: "Cooldown after the workout", color: "var(--cool)", unit: "s" },
];

function openEditor(w) {
  draftIsNew = !w;
  editing = w || null;
  draft = JSON.parse(JSON.stringify(w || normalize({ title: "New workout", prepare: 10, work: 40, rest: 20, rounds: 1, exercises: [{ name: "Exercise 1" }] })));
  $("e-title").value = draft.title;
  $("e-del").hidden = draftIsNew;
  paintEditor();
  showView("edit");
  window.scrollTo(0, 0);
}
function paintEditor() {
  $("e-rows").innerHTML = ROWS.map(r => `<div class="row" data-k="${r.k}">
      <span class="dot" style="background:${r.color}"></span>
      <div class="lbl"><b>${r.label}</b><span>${r.sub}</span></div>
      <div class="val">${r.unit === "s" ? ":" + String(draft[r.k]).padStart(2, "0") : draft[r.k]}</div>
      <span class="chev">›</span></div>`).join("");
  $("e-ex").innerHTML = draft.exercises.map((x, i) => `<div class="ex" data-i="${i}">
      <input class="n" value="${esc(x.name)}" placeholder="Exercise name">
      <input class="d" value="${esc(x.detail || "")}" placeholder="Detail (weight, muscle group)">
      <button data-del="${i}" aria-label="Remove">${icon("trash")}</button></div>`).join("");
}
$("e-rows").addEventListener("click", e => {
  const row = e.target.closest(".row"); if (!row) return;
  const r = ROWS.find(x => x.k === row.dataset.k);
  openSheet(r, draft[r.k], v => { draft[r.k] = v; paintEditor(); });
});
$("e-ex").addEventListener("input", e => {
  const i = +e.target.closest(".ex").dataset.i;
  if (e.target.classList.contains("n")) draft.exercises[i].name = e.target.value;
  else draft.exercises[i].detail = e.target.value;
});
$("e-ex").addEventListener("click", e => {
  const b = e.target.closest("[data-del]"); if (!b || draft.exercises.length < 2) return;
  draft.exercises.splice(+b.dataset.del, 1); paintEditor();
});
$("e-addex").onclick = () => { draft.exercises.push({ name: "Exercise " + (draft.exercises.length + 1) }); paintEditor(); };
$("e-cancel").onclick = () => { showView("home"); renderHome(); };
$("e-save").onclick = () => {
  draft.title = $("e-title").value.trim() || "Workout";
  draft.exercises = draft.exercises.filter(x => x.name.trim());
  if (!draft.exercises.length) return;
  delete draft.fresh;
  if (draftIsNew) { draft.id = newId(); library.unshift(draft); } else Object.assign(editing, draft);
  saveLib(); showView("home"); renderHome();
};
$("e-del").onclick = () => {
  if (!confirm(`Delete "${editing.title}"?`)) return;
  library = library.filter(x => x.id !== editing.id); saveLib(); showView("home"); renderHome();
};
$("new").onclick = () => openEditor(null);

// Waarde-kiezer
function openSheet(row, value, onDone) {
  let v = value;
  const isSec = row.unit === "s";
  const paint = () => ($("s-value").textContent = isSec ? mmss(v) : v);
  $("s-label").textContent = row.label;
  const steps = isSec ? [-10, -5, -1, 1, 5, 10] : [-1, 1];
  $("s-btns").innerHTML = steps.map(s => `<button data-s="${s}">${s > 0 ? "+" : "−"}${Math.abs(s)}</button>`).join("");
  $("s-btns").onclick = e => {
    const b = e.target.closest("[data-s]"); if (!b) return;
    v = Math.max(row.k === "rounds" || row.k === "cycles" ? 1 : 0, v + +b.dataset.s); paint();
  };
  $("s-done").onclick = () => { $("sheet").hidden = true; onDone(v); };
  $("sheet").onclick = e => { if (e.target.id === "sheet") $("sheet").hidden = true; };
  paint(); $("sheet").hidden = false;
}

// ---------- Geluid ----------
let ctx = null, muted = false;
let countdownNodes = [];
function cancelCountdown() {
  countdownNodes.forEach(o => { try { o.stop(); } catch {} });
  countdownNodes = [];
}
function scheduleCountdown() {
  cancelCountdown();
  if (!running || muted || !ctx) return;
  for (const sec of [3, 2, 1]) {
    const delay = remaining / 1000 - sec;
    if (delay >= 0) countdownNodes.push(beep(880, 0.2, delay, 0.7));
  }
}
function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== "running") ctx.resume().catch(() => {});
}
function beep(freq, dur, delay = 0, vol = 0.5) {
  if (muted || !ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur);
  return o;
}
function speak(text) {
  if (muted || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "en-GB"; u.rate = 1.05;
  speechSynthesis.speak(u);
}
const sound = {
  tick: () => beep(660, 0.12),
  work: () => beep(988, 0.6),
  rest: () => beep(440, 0.5),
  done: () => { beep(784, 0.18); beep(988, 0.18, 0.22); beep(1318, 0.5, 0.44); },
};

// ---------- Wake lock ----------
let wake = null;
async function keepAwake() { try { wake = await navigator.wakeLock?.request("screen"); } catch { /* ok */ } }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && running) {
    unlockAudio(); tick(); keepAwake(); scheduleCountdown();
  }
});

// ---------- Timer ----------
let workout = null, phases = [], idx = 0, endAt = 0, remaining = 0, running = false, lastSec = null, timerId = null;
const CIRC = 2 * Math.PI * 86;

(function drawTicks() {
  let h = "";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI, big = i % 5 === 0, r1 = big ? 91 : 93, r2 = 97;
    h += `<line class="${big ? "big" : ""}" x1="${100 + r1 * Math.sin(a)}" y1="${100 - r1 * Math.cos(a)}" x2="${100 + r2 * Math.sin(a)}" y2="${100 - r2 * Math.cos(a)}"/>`;
  }
  $("ticks").innerHTML = h;
  $("ring").style.strokeDasharray = CIRC;
})();

function startWorkout(w) {
  setDimmed(false);
  cancelCountdown();
  workout = w; phases = buildPhases(w); idx = 0;
  remaining = phases[0].dur * 1000; running = false; lastSec = null;
  delete w.fresh;
  showView("run");
  $("title").textContent = w.title;
  render();
}

function enterPhase(i, announce = true) {
  idx = i;
  if (idx >= phases.length) return finish();
  const p = phases[idx];
  remaining = p.dur * 1000; endAt = Date.now() + remaining; lastSec = null;
  if (announce) {
    if (p.type === "work") { sound.work(); if (p.announceName) speak(p.name); }
    else if (p.type === "rest") { sound.rest(); if (p.next) speak("Next: " + p.next); }
    else if (p.type === "cooldown") { sound.rest(); speak("Cooldown"); }
  }
  scheduleCountdown();
  render();
}

function finish() {
  cancelCountdown();
  running = false; clearInterval(timerId); timerId = null; wake?.release?.();
  idx = phases.length;
  document.body.className = "done";
  setDimmed(false);
  $("phase").textContent = "DONE"; $("time").textContent = "00:00";
  $("ring").style.strokeDashoffset = CIRC;
  $("exname").textContent = "Well done"; $("exdetail").textContent = ""; $("next").textContent = "";
  $("total").textContent = "00:00";
  $("toggle").innerHTML = icon("replay");
  sound.done(); speak("Done");
  const secs = totalSeconds(workout), now = Date.now();
  workout.lastDone = now; saveLib();
  log.unshift({ title: workout.title, date: now, seconds: secs });
  log = log.slice(0, 60); store.set("history", log);
}

function tick() {
  if (!running) return;
  let rem = endAt - Date.now();
  if (rem <= 0) {
    // Advance against the original deadline, including every phase missed while suspended.
    let deadline = endAt, next = idx;
    while (deadline <= Date.now()) {
      next++;
      if (next >= phases.length) return finish();
      deadline += phases[next].dur * 1000;
    }
    enterPhase(next, false);
    endAt = deadline;
    rem = endAt - Date.now();
    remaining = rem;
    scheduleCountdown();
    const p = phases[idx];
    if (p.type === "work") { sound.work(); if (p.announceName) speak(p.name); }
    else if (p.type === "rest") { sound.rest(); if (p.next) speak("Next: " + p.next); }
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
    scheduleCountdown();
    if (!timerId) timerId = setInterval(tick, 100);
    if (idx === 0 && phases[0].type === "prepare" && remaining === phases[0].dur * 1000) speak("Next: " + phases[0].next);
  } else {
    remaining = Math.max(0, endAt - Date.now());
    cancelCountdown(); wake?.release?.();
  }
  $("toggle").innerHTML = icon(running ? "pause" : "play");
  paintDimmed();
}
function skip() { unlockAudio(); if (idx < phases.length) { enterPhase(idx + 1); if (running) endAt = Date.now() + remaining; } }
function prev() {
  unlockAudio();
  const i = Math.min(idx, phases.length - 1), elapsed = phases[i].dur * 1000 - remaining;
  enterPhase(elapsed > 2000 || i === 0 ? i : i - 1, false);
}

// ---------- Timer-weergave ----------
const LABEL = { prepare: "GET READY", work: "WORK", rest: "REST", cooldown: "COOLDOWN" };
const dots = (n, at) => Array.from({ length: n }, (_, i) => (i < at ? "●" : "○")).join("");
function paintTime() {
  $("time").textContent = mmss(remaining / 1000);
  paintDimmed();
  const dur = phases[Math.min(idx, phases.length - 1)].dur * 1000;
  $("ring").style.strokeDashoffset = CIRC * (1 - Math.max(0, Math.min(1, remaining / dur)));
  let tot = remaining;
  for (let i = idx + 1; i < phases.length; i++) tot += phases[i].dur * 1000;
  $("total").textContent = mmss(tot / 1000);
}
function render() {
  const p = phases[idx];
  document.body.className = p.type;
  document.body.classList.toggle("dimmed", !$("dim-screen").hidden);
  $("phase").textContent = LABEL[p.type];
  const ex = workout.exercises[p.ex];
  if (p.type === "prepare") { $("exname").textContent = ""; $("exdetail").textContent = ""; $("next").textContent = "Next: " + p.next; }
  else if (p.type === "cooldown") { $("exname").textContent = "Cool down"; $("exdetail").textContent = ""; $("next").textContent = ""; }
  else {
    $("exname").textContent = ex.name; $("exdetail").textContent = ex.detail || "";
    $("next").textContent = p.type === "rest" && p.next ? "Next: " + p.next : "";
  }
  const multiEx = workout.exercises.length > 1, rounds = p.rounds || 0;
  $("row-cycle").hidden = workout.cycles < 2;
  $("row-ex").hidden = !multiEx;
  $("cydots").textContent = dots(workout.cycles, p.cycle);
  $("exdots").textContent = dots(workout.exercises.length, p.type === "prepare" ? 0 : p.ex + 1);
  $("rdots").textContent = rounds ? dots(rounds, p.round) : "";
  $("toggle").innerHTML = icon(running ? "pause" : "play");
  paintTime();
}

function paintDimmed() {
  if ($("dim-screen").hidden) return;
  $("dim-time").textContent = mmss(remaining / 1000);
  $("dim-phase").textContent = LABEL[phases[idx]?.type] || "DONE";
  $("dim-status").textContent = running ? "" : "Paused";
}
function setDimmed(dimmed) {
  $("dim-screen").hidden = !dimmed;
  $("run").inert = dimmed;
  document.body.classList.toggle("dimmed", dimmed);
  if (dimmed) {
    paintDimmed();
    if (running) keepAwake();
    $("undim").focus();
  } else if (!$("run").hidden) $("dim").focus();
}
$("dim").onclick = () => setDimmed(true);
$("undim").onclick = () => setDimmed(false);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("dim-screen").hidden) setDimmed(false);
});

$("toggle").onclick = toggle;
$("skip").onclick = skip;
$("prev").onclick = prev;
const paintMute = () => { $("mute").innerHTML = icon(muted ? "mute" : "speaker"); };
$("mute").onclick = () => { muted = !muted; paintMute(); scheduleCountdown(); if (muted) speechSynthesis?.cancel(); };
$("back").onclick = () => {
  cancelCountdown();
  running = false; clearInterval(timerId); timerId = null; wake?.release?.(); speechSynthesis?.cancel();
  showView("home"); renderHome();
};
$("load").onclick = () => tryLoad($("paste").value);

// ---------- Start ----------
paintMute();
renderHome();
if (location.hash.length > 1) tryLoad(location.hash);
window.addEventListener("hashchange", () => { if (location.hash.length > 1) tryLoad(location.hash); });
// A new worker gets fresh assets, then reload only when no workout/editor is open.
let pendingUpdate = false, reloadingForUpdate = false, updateRegistration = null;
function applyPendingUpdate() {
  if (!pendingUpdate || reloadingForUpdate || $("home").hidden) return;
  reloadingForUpdate = true;
  location.reload();
}
async function checkForUpdates(manual = false) {
  if (!updateRegistration) return;
  if (manual) $("update-status").textContent = "Checking for updates…";
  try {
    await updateRegistration.update();
    if (manual) $("update-status").textContent = updateRegistration.installing || pendingUpdate
      ? "Downloading update…" : "Version 13 · Update check complete";
    applyPendingUpdate();
  } catch {
    if (manual) $("update-status").textContent = "Offline · Try again when connected";
  }
}
$("check-update").onclick = () => checkForUpdates(true);
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    pendingUpdate = true;
    $("update-status").textContent = "Update ready · Applies on the Workouts screen";
    applyPendingUpdate();
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    updateRegistration = reg;
    checkForUpdates();
  }).catch(() => { $("update-status").textContent = "Version 13 · Offline mode unavailable"; });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdates();
  });
  window.addEventListener("online", () => checkForUpdates());
}
