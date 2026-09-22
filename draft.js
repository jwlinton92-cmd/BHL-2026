/* ---------------------------------------------------------------------------
   BHL live draft room.

   State lives in Firebase Realtime Database so every owner sees the same
   board. The page is a pure function of that state: every render comes from a
   snapshot, never from local assumptions about what just happened.

   Database shape:
     draft/config   {status, format, rounds, startedAt}
     draft/order    [teamId, ...]        randomized once, then fixed
     draft/picks/N  {n, round, teamId, player, pos, slot, at}
     draft/claims   {teamId: {uid, at}}
     draft/admin    uid of the commissioner
     draft/presence {uid: {teamId, at}}
--------------------------------------------------------------------------- */

import { firebaseConfig, COMMISSIONER_CODE, PICK_SECONDS }
  from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.5";
const app = document.getElementById("app");
const whoami = document.getElementById("whoami");

/* Roster shape, straight from the league rules. */
const SLOTS = [
  { key: "F", label: "Forward", count: 6, accepts: ["F"] },
  { key: "D", label: "Defense", count: 4, accepts: ["D"] },
  { key: "G", label: "Goalie", count: 2, accepts: ["G"] },
  { key: "GOON", label: "Goon", count: 1, accepts: ["F", "D"] },
  { key: "ROOKIE", label: "Rookie", count: 1, accepts: ["F", "D"] },
];
const ROUNDS = SLOTS.reduce((n, s) => n + s.count, 0); // 14

let db, auth, fb = {}, uid = null;
let players = [], teams = [];
let state = { config: {}, order: [], picks: {}, claims: {}, admin: null, presence: {} };
let myTeam = null, isAdmin = false, tick = null, lastErr = "";
let spectating = false;   // commissioner who isn't playing this year

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fp = (n) => (n == null ? "—" : Number(n).toFixed(1));

/* ------------------------------------------------------------ snake order */
/* Pick n (1-indexed) belongs to order[i]. Odd rounds run forward, even rounds
   run back, which is what "snake" means. */
function teamForPick(n, order) {
  if (!order.length) return null;
  const T = order.length;
  const round = Math.ceil(n / T);
  let i = (n - 1) % T;
  if (round % 2 === 0) i = T - 1 - i;
  return { teamId: order[i], round, indexInRound: i };
}

const pickCount = () => Object.keys(state.picks).length;
const nextPickNo = () => pickCount() + 1;
const totalPicks = () => ROUNDS * (state.order.length || teams.length);

function picksFor(teamId) {
  return Object.values(state.picks)
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => a.n - b.n);
}

/* Which roster slots a team still has open. */
function openSlots(teamId) {
  const taken = picksFor(teamId);
  return SLOTS.map((s) => ({
    ...s,
    filled: taken.filter((p) => p.slot === s.key).length,
  })).map((s) => ({ ...s, open: s.count - s.filled }));
}

/* Every roster slot this player could legally fill, natural position first.
   Goon and rookie both accept any skater, and the difference matters enormously
   — a goon only scores penalty minutes — so when more than one slot fits, the
   owner chooses rather than the page guessing. */
function slotOptions(teamId, player) {
  const open = openSlots(teamId).filter((s) => s.open > 0);
  const base = open.filter((s) => s.key === player.slot);
  const flex = open.filter((s) => s.key !== player.slot && s.accepts.includes(player.slot));
  return base.concat(flex).map((s) => s.key);
}
function slotFor(teamId, player) {
  return slotOptions(teamId, player)[0] || null;
}

const draftedNames = () => new Set(Object.values(state.picks).map((p) => p.player));

/* ------------------------------------------------------------------ boot */
async function boot() {
  if (!firebaseConfig.databaseURL || !firebaseConfig.apiKey) return renderSetup();

  try {
    const [fbApp, fbAuth, fbDb] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
    ]);
    fb = { ...fbDb };
    const a = fbApp.initializeApp(firebaseConfig);
    auth = fbAuth.getAuth(a);
    db = fbDb.getDatabase(a);

    const cred = await fbAuth.signInAnonymously(auth);
    uid = cred.user.uid;
  } catch (e) {
    return renderFatal(e);
  }

  try {
    const [pRes, rRes] = await Promise.all([
      fetch("players.json?v=" + Date.now()),
      fetch("rosters.json?v=" + Date.now()),
    ]);
    players = (await pRes.json()).players;
    teams = (await rRes.json()).teams.map((t) => ({ id: t.id, name: t.name }));
  } catch (e) {
    return renderFatal(new Error("Could not load player data: " + e.message));
  }

  fb.onValue(fb.ref(db, "draft"), (snap) => {
    const v = snap.val() || {};
    state = {
      config: v.config || {},
      order: v.order || [],
      picks: v.picks || {},
      claims: v.claims || {},
      admin: v.admin || null,
      presence: v.presence || {},
    };
    isAdmin = !!uid && state.admin === uid;
    myTeam = Object.keys(state.claims).find((t) => state.claims[t].uid === uid) || null;
    render();
  });

  // Announce presence and clear it when this tab goes away.
  const me = fb.ref(db, "draft/presence/" + uid);
  fb.onDisconnect(me).remove();
  fb.set(me, { at: Date.now() });

  tick = setInterval(paintTimer, 1000);
}

/* ------------------------------------------------------------- rendering */
function renderSetup() {
  whoami.textContent = "Not configured yet";
  app.innerHTML = `
    <div class="gate">
      <h2>One setup step left</h2>
      <p class="muted">The draft room needs a free Firebase project so every
      owner stays in sync. It takes about ten minutes, once.</p>
      <div class="card"><div class="pad">
        <ol>
          <li>Go to <code>console.firebase.google.com</code> and create a project.
              Skip Google Analytics.</li>
          <li>In the left sidebar choose <b>Build → Realtime Database → Create
              database</b>. Pick any location and start in <b>locked mode</b>.</li>
          <li>Open the <b>Rules</b> tab, paste in the contents of
              <code>database-rules.json</code> from this repo, and publish.</li>
          <li>Go to <b>Build → Authentication → Get started</b> and enable
              <b>Anonymous</b>.</li>
          <li>In <b>Project settings → General</b>, scroll to "Your apps", add a
              <b>Web</b> app, and copy the <code>firebaseConfig</code> values.</li>
          <li>Paste them into <code>firebase-config.js</code>, change
              <code>COMMISSIONER_CODE</code>, and commit.</li>
        </ol>
        <p class="tiny">Full instructions are in the README under
        "Setting up the draft".</p>
      </div></div>
    </div>`;
}

function renderFatal(e) {
  whoami.textContent = "Connection problem";
  app.innerHTML = `<div class="note warn"><b>Couldn't reach the draft.</b>
    ${esc(e.message)}<br><span class="tiny">Check that the Realtime Database rules
    are published and Anonymous sign-in is enabled in the Firebase console.</span></div>`;
}

function render() {
  const claimed = myTeam ? teams.find((t) => t.id === myTeam) : null;
  whoami.textContent = claimed
    ? `You are ${claimed.name}${isAdmin ? " · commissioner" : ""}`
    : (isAdmin ? "Commissioner — pick a team below" : "Pick your team to join");

  // Everyone picks a team first — the commissioner included, since they almost
  // always play too. Running the draft without a team is an explicit choice.
  if (!myTeam && !spectating) return renderClaim();
  if (state.config.status !== "live" && state.config.status !== "done") return renderLobby();
  renderBoard();
}

function renderClaim() {
  app.innerHTML = `
    <div class="gate">
      <h2>Who are you?</h2>
      <p class="muted">Claim your team to join the draft. One per person —
      if you grab the wrong one, the commissioner can release it.</p>
      <div class="card">
        <div class="teamgrid">
          ${teams.map((t) => {
            const c = state.claims[t.id];
            const mine = c && c.uid === uid;
            return `<button class="teambtn" data-claim="${esc(t.id)}"
              ${c && !mine ? "disabled" : ""}>
              <b>${esc(t.name)}</b>
              <span>${c ? (mine ? "you" : "taken") : "available"}</span>
            </button>`;
          }).join("")}
        </div>
      </div>
      <div class="card"><div class="pad">
        ${isAdmin ? `<p class="tiny" style="margin:0 0 9px">You have commissioner
          controls. Claim a team above if you're playing, or run the draft
          without one.</p>
          <button class="abtn" id="spectate">Run the draft without a team →</button>`
        : `<p class="tiny" style="margin:0 0 9px">Running the draft? Enter the
        commissioner code to unlock the controls.</p>
        <div style="display:flex;gap:8px">
          <input id="ccode" type="password" placeholder="commissioner code"
            style="flex:1;background:var(--bg);border:1px solid var(--line);
            color:var(--ink);border-radius:7px;padding:8px 10px;font:inherit">
          <button class="abtn" id="claimadmin">Unlock</button>
        </div>`}
        ${lastErr ? `<p class="err" style="padding:10px 0 0">${esc(lastErr)}</p>` : ""}
      </div></div>
    </div>`;
  wire();
}

function renderLobby() {
  const online = Object.keys(state.presence).length;
  app.innerHTML = `
    <div class="gate">
      <h2>Waiting to start</h2>
      <p class="muted">${Object.keys(state.claims).length} of ${teams.length} teams
      claimed · ${online} ${online === 1 ? "person" : "people"} here now.</p>
      <div class="card"><h3>Teams</h3>
        <div class="peers">${teams.map((t) => {
          const c = state.claims[t.id];
          return `<span class="peer ${c ? "on" : ""}">${esc(t.name)}${c ? " ✓" : ""}</span>`;
        }).join("")}</div>
      </div>
      ${state.order.length ? `<div class="card"><h3>Pick order</h3>
        <div class="peers">${state.order.map((id, i) =>
          `<span class="peer">${i + 1}. ${esc(nameOf(id))}</span>`).join("")}</div></div>` : ""}
      ${isAdmin ? `<div class="card"><h3>Commissioner</h3><div class="adminbar">
        <button class="abtn" id="randomize">Randomize pick order</button>
        <button class="abtn" id="start" ${state.order.length ? "" : "disabled"}>Start draft</button>
        <button class="abtn danger" id="release" ${Object.keys(state.claims).length ? "" : "disabled"}>Release a team</button>
        <button class="abtn danger" id="reset">Reset everything</button>
      </div>${state.order.length ? "" :
        `<p class="tiny" style="padding:0 14px 14px;margin:0">Randomize the order first.</p>`}
      </div>` : `<p class="tiny">The commissioner starts the draft when everyone's in.</p>`}
    </div>`;
  wire();
}

const nameOf = (id) => (teams.find((t) => t.id === id) || {}).name || id;

function renderBoard() {
  const n = nextPickNo();
  const done = state.config.status === "done" || n > totalPicks();
  const cur = done ? null : teamForPick(n, state.order);
  const onClock = cur ? cur.teamId : null;
  const mine = onClock && onClock === myTeam;

  app.innerHTML = `
    <div class="clockbar ${done ? "done" : mine ? "mine" : ""}" id="clockbar">
      <div>
        <div class="who">${done ? "Draft complete" : esc(nameOf(onClock))}</div>
        <div class="meta">${done
          ? `${pickCount()} picks made`
          : `Round ${cur.round} of ${ROUNDS} · pick ${n} of ${totalPicks()}${mine ? " · you're up" : ""}`}</div>
      </div>
      ${done ? "" : `<div class="timer" id="timer">--:--</div>`}
    </div>

    ${done ? renderExport() : ""}

    <div class="draftgrid">
      <div>
        <div class="card">
          <h3>Available players</h3>
          <div class="poolbar">
            <input id="psearch" type="search" placeholder="Search a player…" autocomplete="off">
            <select id="pfilter">
              <option value="">All positions</option>
              <option value="F">Forwards</option>
              <option value="D">Defense</option>
              <option value="G">Goalies</option>
            </select>
            <select id="psort">
              <option value="fp">Sort: fantasy points</option>
              <option value="pim">Sort: penalty minutes</option>
              <option value="gp">Sort: games played</option>
            </select>
            <label class="onlyfit"><input type="checkbox" id="ponlyfit" checked>
              Only slots I still need</label>
          </div>
          <p class="poolcount tiny" id="poolcount"></p>
          <div class="poolwrap"><table>
            <thead><tr><th class="l">Player</th><th class="hide-s">GP</th>
              <th>Last yr</th><th></th></tr></thead>
            <tbody id="poolbody"></tbody>
          </table></div>
        </div>
        <div class="card"><h3>Recent picks</h3><div class="feed" id="feed"></div></div>
      </div>

      <div>
        ${myTeam ? renderMyTeam() : ""}
        <div class="card"><h3>Draft order</h3><div class="peers">
          ${state.order.map((id, i) => {
            const isNow = !done && id === onClock;
            return `<span class="peer ${isNow ? "on" : ""}">${i + 1}. ${esc(nameOf(id))}</span>`;
          }).join("")}
        </div></div>
        ${isAdmin ? `<div class="card"><h3>Commissioner</h3><div class="adminbar">
          <button class="abtn" id="undo" ${pickCount() ? "" : "disabled"}>Undo last pick</button>
          <button class="abtn" id="forcepick" ${done ? "disabled" : ""}>Pick best available</button>
          <button class="abtn danger" id="release">Release a team</button>
        </div></div>` : ""}
      </div>
    </div>`;

  paintPool();
  paintFeed();
  paintTimer();
  wire();
}

function renderMyTeam() {
  const open = openSlots(myTeam);
  const taken = picksFor(myTeam);
  const rows = SLOTS.map((s) => {
    const got = taken.filter((p) => p.slot === s.key);
    return Array.from({ length: s.count }, (_, i) => {
      const p = got[i];
      return `<div class="slotrow">
        <span class="slotneed">${esc(s.key)}</span>
        <span class="sname ${p ? "" : "empty"}">${p ? esc(p.player) : "—"}</span>
      </div>`;
    }).join("");
  }).join("");
  const needs = open.filter((s) => s.open > 0);
  const picksLeft = ROUNDS - taken.length;
  return `<div class="card"><h3>Your roster</h3>
    <div class="pad" style="padding-bottom:8px">
      <div class="chips">${needs.map((s) => {
        const urgent = s.open >= picksLeft && picksLeft > 0;
        return `<span class="needpill ${urgent ? "urgent" : ""}">${esc(s.key)} ×${s.open}</span>`;
      }).join("") || `<span class="needpill">roster full</span>`}</div>
    </div>
    <div class="pad" style="padding-top:0">${rows}</div></div>`;
}

function renderExport() {
  const out = { season: "2026-27", teams: teams.map((t) => ({
    id: t.id, name: t.name,
    players: picksFor(t.id).map((p) => ({ name: p.player, slot: p.slot })),
  })) };
  return `<div class="card"><h3>Save the results</h3><div class="pad">
    <p class="tiny" style="margin:0 0 10px">Copy this and paste it over
    <code>rosters.json</code> in the repo. The standings rescore
    automatically once you commit.</p>
    <textarea class="export" id="exportbox" readonly>${esc(JSON.stringify(out, null, 2))}</textarea>
    <div class="adminbar" style="padding:12px 0 0">
      <button class="abtn" id="copyexport">Copy to clipboard</button>
    </div></div></div>`;
}

/* ------------------------------------------------------------ pool table */
function paintPool() {
  const body = document.getElementById("poolbody");
  if (!body) return;
  const q = (document.getElementById("psearch").value || "").toLowerCase().trim();
  const posF = document.getElementById("pfilter").value;
  const sort = document.getElementById("psort").value;
  const gone = draftedNames();

  const n = nextPickNo();
  const cur = teamForPick(n, state.order);
  const mine = cur && cur.teamId === myTeam && state.config.status === "live";

  let list = players.filter((p) => !gone.has(p.name));
  if (posF) list = list.filter((p) => p.slot === posF);
  if (q) list = list.filter((p) => (p.name + " " + p.team).toLowerCase().includes(q));

  // Without this the pool can show 120 goalies to a team that has no goalie
  // slot left, and look as though there is nobody to draft.
  const onlyFit = document.getElementById("ponlyfit");
  if (myTeam && onlyFit && onlyFit.checked) {
    list = list.filter((p) => slotOptions(myTeam, p).length > 0);
  }

  list = list.slice().sort((a, b) =>
    sort === "pim" ? (b.pim || 0) - (a.pim || 0)
    : sort === "gp" ? (b.gp || 0) - (a.gp || 0)
    : b.fp - a.fp);

  const shown = list.slice(0, 200);
  const countEl = document.getElementById("poolcount");
  if (countEl) {
    countEl.textContent = list.length > shown.length
      ? `Showing the top ${shown.length} of ${list.length} — search to narrow it down.`
      : `${list.length} player${list.length === 1 ? "" : "s"} available.`;
  }

  body.innerHTML = shown.map((p) => {
    const opts = myTeam ? slotOptions(myTeam, p) : [];
    const can = mine && opts.length > 0;
    const why = !mine ? "Not your pick"
      : !opts.length ? "No open slot for this position"
      : opts.length > 1 ? `Draft as ${opts.join(" or ")}` : `Draft as ${opts[0]}`;
    return `<tr>
      <td class="l"><span class="poslabel">${esc(p.pos)}</span> ${esc(p.name)}
        <span class="tiny">${esc(p.team)}</span></td>
      <td class="num hide-s muted">${p.gp}</td>
      <td class="num">${sort === "pim" ? (p.pim || 0) + " pim" : fp(p.fp)}</td>
      <td><button class="pickbtn" data-pick="${esc(p.name)}" ${can ? "" : "disabled"}
        title="${esc(why)}">${can ? "Draft" : "—"}</button></td>
    </tr>`;
  }).join("") || `<tr><td class="l muted">No players match.</td></tr>`;

  body.querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => makePick(b.getAttribute("data-pick"))));
}

function paintFeed() {
  const el = document.getElementById("feed");
  if (!el) return;
  const list = Object.values(state.picks).sort((a, b) => b.n - a.n).slice(0, 40);
  el.innerHTML = list.map((p) => `<div class="feeditem">
    <span class="feedpick">${p.round}.${String(((p.n - 1) % state.order.length) + 1).padStart(2, "0")}</span>
    <span class="feedteam">${esc(nameOf(p.teamId))}</span>
    <span class="feedname">${esc(p.player)}</span>
    <span class="tiny">${esc(p.slot)}</span>
  </div>`).join("") || `<p class="tiny" style="padding:12px 14px">No picks yet.</p>`;
}

/* The current pick's clock starts when the previous pick landed. */
function clockStartedAt() {
  const ps = Object.values(state.picks);
  if (!ps.length) return state.config.startedAt || null;
  return ps.reduce((m, p) => Math.max(m, p.at || 0), 0) || state.config.startedAt;
}

function paintTimer() {
  const el = document.getElementById("timer");
  if (!el) return;
  const started = clockStartedAt();
  if (!started) return;
  const left = Math.max(0, PICK_SECONDS - Math.floor((Date.now() - started) / 1000));
  const m = Math.floor(left / 60), s = left % 60;
  el.textContent = `${m}:${String(s).padStart(2, "0")}`;
  el.classList.toggle("low", left <= 20);
}

/* -------------------------------------------------------------- actions */
function makePick(playerName) {
  const p = players.find((x) => x.name === playerName);
  if (!p) return;
  const n = nextPickNo();
  const cur = teamForPick(n, state.order);
  if (!cur || cur.teamId !== myTeam) return;
  const opts = slotOptions(myTeam, p);
  if (!opts.length) return;
  if (opts.length === 1) return commitPick(n, cur, p, opts[0]);
  openSlotChooser(p, opts, (slot) => commitPick(n, cur, p, slot));
}

/* Slot chooser — shown whenever a player fits more than one open slot. */
function openSlotChooser(player, opts, done) {
  // When the player's own position still has an opening, that's the obvious
  // default. When the only spots left are goon and rookie, the difference is
  // worth a season of points — so nothing is preselected and the owner must say.
  const natural = opts[0] === player.slot;
  const wrap = document.createElement("div");
  wrap.className = "modalwrap";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle">
      <h3 id="mtitle">Draft ${esc(player.name)}</h3>
      <p class="tiny">${esc(player.pos)} · ${esc(player.team)} ·
        ${fp(player.fp)} pts last season · ${player.pim || 0} PIM</p>
      <p class="muted" style="font-size:13.5px;margin:14px 0 8px">Which roster spot?</p>
      <div class="slotpick">
        ${opts.map((k, i) => {
          const s = SLOTS.find((x) => x.key === k);
          const warn = k === "GOON" ? "scores penalty minutes only"
            : k === "ROOKIE" ? "full skater scoring — rookies only"
            : "full skater scoring";
          return `<label class="slotopt">
            <input type="radio" name="slotpick" value="${esc(k)}"
              ${natural && i === 0 ? "checked" : ""}>
            <span><b>${esc(s.label)}</b><em>${esc(warn)}</em></span>
          </label>`;
        }).join("")}
      </div>
      ${!natural ? `<p class="tiny" style="margin:10px 0 0">Your ${esc(player.slot === "D" ? "defense" : "forward")}
        spots are full — pick which of these to use.</p>` : ""}
      ${opts.includes("GOON") ? `<p class="note warn" style="margin-top:14px;font-size:12.5px">
        A goon earns 0.25 per penalty minute and nothing for goals or assists.
        ${esc(player.name)} would be worth ${fp((player.pim || 0) * 0.25)} points there
        versus ${fp(player.fp)} as a skater.</p>` : ""}
      <div class="adminbar" style="padding:16px 0 0;justify-content:flex-end">
        <button class="abtn" id="mcancel">Cancel</button>
        <button class="abtn" id="mok" ${natural ? "" : "disabled"}
          style="border-color:var(--accent);color:var(--accent)">Draft</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector("#mcancel").addEventListener("click", close);
  const okBtn = wrap.querySelector("#mok");
  wrap.querySelectorAll('input[name="slotpick"]').forEach((r) =>
    r.addEventListener("change", () => { okBtn.disabled = false; }));
  okBtn.addEventListener("click", () => {
    const sel = wrap.querySelector('input[name="slotpick"]:checked');
    if (!sel) return;
    close(); done(sel.value);
  });
  document.addEventListener("keydown", function esc2(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc2); }
  });
  wrap.querySelector("input").focus();
}

/* Writes to draft/picks/N only when N is still empty, so two people clicking at
   the same moment can't both land the pick — the rules reject the loser. */
async function commitPick(n, cur, p, slot) {
  const ref = fb.ref(db, "draft/picks/" + n);
  await fb.runTransaction(ref, (existing) =>
    existing === null
      ? { n, round: cur.round, teamId: cur.teamId, player: p.name,
          pos: p.pos, slot, at: Date.now() }
      : undefined);
  // Nothing else is written. The clock and the "draft is over" state are both
  // derived from the picks themselves, so an ordinary owner never needs write
  // access to the commissioner-only config node.
}

function wire() {
  const on = (id, fn, ev = "click") => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };

  document.querySelectorAll("[data-claim]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-claim");
      lastErr = "";
      try { await fb.set(fb.ref(db, "draft/claims/" + id), { uid, at: Date.now() }); }
      catch { lastErr = "That team is already claimed."; render(); }
    }));

  on("spectate", () => { spectating = true; render(); });

  on("claimadmin", async () => {
    const v = document.getElementById("ccode").value;
    if (v !== COMMISSIONER_CODE) { lastErr = "That code doesn't match."; return render(); }
    lastErr = "";
    try { await fb.set(fb.ref(db, "draft/admin"), uid); }
    catch { lastErr = "Someone already claimed commissioner."; render(); }
  });

  on("randomize", async () => {
    const ids = teams.map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    await fb.set(fb.ref(db, "draft/order"), ids);
  });

  on("start", async () => {
    // Starting with empty seats is allowed — someone is always late — but it
    // means their picks will need forcing, so say so first.
    const unclaimed = teams.filter((t) => !state.claims[t.id]).map((t) => t.name);
    if (unclaimed.length && !confirm(
      `${unclaimed.join(", ")} ${unclaimed.length === 1 ? "hasn't" : "haven't"} joined yet.\n\n` +
      `You can still start, but you'll have to use "Pick best available" when ` +
      `their turn comes. Start anyway?`)) return;
    await fb.update(fb.ref(db, "draft/config"), {
      status: "live", format: "snake", rounds: ROUNDS,
      startedAt: Date.now(),
    });
  });

  on("reset", async () => {
    if (!confirm("Wipe every pick and start over? This cannot be undone.")) return;
    // Each path is cleared on its own — a multi-path update rooted at "draft"
    // asks for write permission on "draft" itself, which nothing grants.
    await fb.remove(fb.ref(db, "draft/picks"));
    await fb.remove(fb.ref(db, "draft/order"));
    await fb.set(fb.ref(db, "draft/config"), { status: "setup" });
  });

  on("undo", async () => {
    const n = pickCount();
    if (!n) return;
    await fb.remove(fb.ref(db, "draft/picks/" + n));
    await fb.update(fb.ref(db, "draft/config"), { status: "live" });
  });

  on("forcepick", async () => {
    const n = nextPickNo();
    const cur = teamForPick(n, state.order);
    if (!cur) return;
    const gone = draftedNames();
    // Prefer a player whose natural position still has an opening, so an
    // auto-pick never burns a scorer in the goon slot.
    const fits = (p) => slotOptions(cur.teamId, p);
    const best = players.find((p) => !gone.has(p.name) && fits(p)[0] === p.slot)
              || players.find((p) => !gone.has(p.name) && fits(p).length);
    if (!best) return;
    const slot = fits(best)[0];
    if (!confirm(`Pick ${best.name} for ${nameOf(cur.teamId)} as ${slot}?`)) return;
    await commitPick(n, cur, best, slot);
  });

  on("release", async () => {
    const name = prompt("Release which team? Type the team name exactly.");
    if (!name) return;
    const t = teams.find((x) => x.name.toLowerCase() === name.toLowerCase().trim());
    if (!t) return alert("No team by that name.");
    await fb.remove(fb.ref(db, "draft/claims/" + t.id));
  });

  on("copyexport", () => {
    const box = document.getElementById("exportbox");
    box.select();
    navigator.clipboard.writeText(box.value)
      .then(() => { const b = document.getElementById("copyexport");
                    b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy to clipboard"), 1600); })
      .catch(() => alert("Select the text and copy it manually."));
  });

  ["psearch", "pfilter", "psort", "ponlyfit"].forEach((id) => on(id, paintPool, "input"));
}

boot();
