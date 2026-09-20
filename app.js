/* Bush Hockey League — reads data/standings.json and renders the site. */
(function () {
  "use strict";

  var D = null;
  var view = "standings";
  var currentTeam = null;
  var main = document.getElementById("main");

  var SLOT_LABEL = { F: "Forward", D: "Defense", G: "Goalie", GOON: "Goon", ROOKIE: "Rookie" };
  var SLOT_ORDER = { F: 0, D: 1, G: 2, GOON: 3, ROOKIE: 4 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n, dp) {
    if (n == null || n === "") return "—";
    return Number(n).toFixed(dp == null ? 2 : dp);
  }
  function plus(n) { return (n > 0 ? "+" : "") + n; }

  function ago(iso) {
    var t = new Date(iso), mins = Math.round((Date.now() - t) / 60000);
    if (isNaN(mins)) return "unknown";
    if (mins < 60) return mins + " min ago";
    var h = Math.round(mins / 60);
    if (h < 36) return h + " hr ago";
    return Math.round(h / 24) + " days ago";
  }

  /* ------------------------------------------------------- standings */
  function renderStandings() {
    var top = D.teams[0].total;
    var rows = D.teams.map(function (t) {
      var pct = top > 0 ? Math.max(2, (t.total / top) * 100) : 0;
      var gap = t.rank === 1 ? "—" : "-" + num(top - t.total);
      return (
        '<tr class="r' + t.rank + '">' +
        '<td class="rank">' + t.rank + "</td>" +
        '<td class="l"><button class="teamlink" data-team="' + esc(t.id) + '">' + esc(t.name) + "</button>" +
          '<div class="bar"><span style="width:' + pct.toFixed(1) + '%"></span></div></td>' +
        '<td class="num big">' + num(t.total) + "</td>" +
        '<td class="num gap">' + gap + "</td>" +
        '<td class="num muted hide-s">' + num(t.breakdown.forwards) + "</td>" +
        '<td class="num muted hide-s">' + num(t.breakdown.defense) + "</td>" +
        '<td class="num muted hide-s">' + num(t.breakdown.goalie) + "</td>" +
        '<td class="num muted hide-s">' + num(t.breakdown.goon + t.breakdown.rookie) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="card"><h2>League Standings</h2><div class="scroll"><table>' +
      "<thead><tr><th></th><th class='l'>Team</th><th>Points</th><th>Back</th>" +
      "<th class='hide-s'>FWD</th><th class='hide-s'>DEF</th><th class='hide-s'>GOALIE</th>" +
      "<th class='hide-s'>GOON+RK</th></tr></thead><tbody>" + rows +
      "</tbody></table></div></div>" +
      unmatchedNote() +
      '<div class="card"><h3>Top Performers</h3><div class="scroll"><table>' +
      "<thead><tr><th class='l'>Player</th><th class='l hide-s'>Slot</th><th class='l'>Owner</th>" +
      "<th>GP</th><th>Points</th></tr></thead><tbody>" +
      D.leaders.slice(0, 10).map(function (p) {
        return "<tr><td class='l'>" + esc(p.name) +
          " <span class='tiny'>" + esc(p.nhlTeam) + "</span></td>" +
          "<td class='l hide-s muted'>" + esc(SLOT_LABEL[p.slot] || p.slot) + "</td>" +
          "<td class='l muted'>" + esc(p.owner) + "</td>" +
          "<td class='num'>" + p.gp + "</td>" +
          "<td class='num big'>" + num(p.points) + "</td></tr>";
      }).join("") +
      "</tbody></table></div></div>"
    );
  }

  function unmatchedNote() {
    if (!D.unmatched || !D.unmatched.length) return "";
    return '<div class="note warn"><b>' + D.unmatched.length +
      " roster name(s) didn't match any NHL player</b> and are scoring zero: " +
      D.unmatched.map(function (u) { return esc(u.name) + " (" + esc(u.team) + ")"; }).join(", ") +
      ". Fix the spelling in <code>data/rosters.json</code> or add an entry to <code>data/aliases.json</code>.</div>";
  }

  /* ----------------------------------------------------------- teams */
  function renderTeamList() {
    return '<div class="grid2">' + D.teams.map(function (t) {
      var counting = t.players.filter(function (p) { return p.counting; }).length;
      return '<div class="card"><h3>#' + t.rank + " " + esc(t.name) + "</h3>" +
        '<div class="pad">' +
        '<div class="score">' + num(t.total) + '</div>' +
        '<div class="chips">' +
          '<span class="chip">FWD <b>' + num(t.breakdown.forwards) + "</b></span>" +
          '<span class="chip">DEF <b>' + num(t.breakdown.defense) + "</b></span>" +
          '<span class="chip">G <b>' + num(t.breakdown.goalie) + "</b></span>" +
          '<span class="chip">Goon <b>' + num(t.breakdown.goon) + "</b></span>" +
          '<span class="chip">Rookie <b>' + num(t.breakdown.rookie) + "</b></span>" +
        "</div>" +
        '<p class="tiny" style="margin:12px 0 0">' + counting + " of " + t.players.length +
        ' players counting · <button class="teamlink" data-team="' + esc(t.id) +
        '" style="color:var(--accent)">view roster →</button></p>' +
        "</div></div>";
    }).join("") + "</div>";
  }

  function statLine(p) {
    var L = p.line || {}, out = [];
    Object.keys(L).forEach(function (k) {
      var v = L[k];
      if (v == null) return;
      if (k === "+/-") v = plus(v);
      else if (k === "GAA") v = Number(v).toFixed(2);
      else if (k === "SV%") v = Number(v).toFixed(3).replace(/^0/, "");
      out.push(k + " " + v);
    });
    return out.join("  ·  ");
  }

  function renderTeam(id) {
    var t = D.teams.filter(function (x) { return x.id === id; })[0];
    if (!t) return "<p>Team not found.</p>";
    var players = t.players.slice().sort(function (a, b) {
      return (SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]) || (b.points - a.points);
    });
    var rows = players.map(function (p) {
      var cls = p.missing ? "miss" : (p.counting ? "" : "bench");
      return '<tr class="' + cls + '">' +
        "<td class='l'><span class='slot'>" + esc(SLOT_LABEL[p.slot] || p.slot) + "</span> " +
          esc(p.name) + " <span class='tiny'>" + esc(p.nhlTeam) + "</span></td>" +
        "<td class='l statline hide-s'>" + esc(statLine(p)) + "</td>" +
        "<td class='num'>" + (p.gp || 0) + "</td>" +
        "<td class='num big'>" + num(p.points) + "</td></tr>";
    }).join("");

    return '<button class="back" id="back">← All teams</button>' +
      '<div class="teamhead"><div><h2>' + esc(t.name) + "</h2>" +
      '<p class="muted" style="margin:4px 0 0">Rank #' + t.rank + " of " + D.teams.length + "</p></div>" +
      '<div style="text-align:right"><div class="score">' + num(t.total) + "</div>" +
      '<div class="tiny">total points</div></div></div>' +
      '<div class="chips" style="margin-bottom:16px">' +
        '<span class="chip">Top 4 FWD <b>' + num(t.breakdown.forwards) + "</b></span>" +
        '<span class="chip">Top 3 DEF <b>' + num(t.breakdown.defense) + "</b></span>" +
        '<span class="chip">Best G <b>' + num(t.breakdown.goalie) + "</b></span>" +
        '<span class="chip">Goon <b>' + num(t.breakdown.goon) + "</b></span>" +
        '<span class="chip">Rookie <b>' + num(t.breakdown.rookie) + "</b></span>" +
      "</div>" +
      '<div class="card"><div class="scroll"><table><thead><tr>' +
      "<th class='l'>Player</th><th class='l hide-s'>Stat line</th><th>GP</th><th>Points</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div></div>" +
      '<p class="tiny">Faded rows are bench players — their points don\'t count toward the team total ' +
      "(top 4 forwards, top 3 defensemen, and the better of two goalies count).</p>";
  }

  /* --------------------------------------------------------- players */
  function renderPlayers() {
    return '<div class="filters">' +
      '<input id="q" type="search" placeholder="Search player, team or owner…" autocomplete="off">' +
      '<select id="slotf"><option value="">All slots</option>' +
      Object.keys(SLOT_LABEL).map(function (k) {
        return '<option value="' + k + '">' + SLOT_LABEL[k] + "</option>";
      }).join("") + "</select>" +
      '<select id="pool"><option value="rostered">Rostered players</option>' +
      '<option value="free">Best available (unrostered)</option></select>' +
      "</div><div id="+'"plist"'+"></div>";
  }

  function drawPlayers() {
    var q = (document.getElementById("q").value || "").toLowerCase().trim();
    var slot = document.getElementById("slotf").value;
    var pool = document.getElementById("pool").value;
    var list, isFree = pool === "free";

    if (isFree) {
      list = (D.freeAgents || []).filter(function (p) {
        return !q || (p.name + " " + p.nhlTeam).toLowerCase().indexOf(q) >= 0;
      });
    } else {
      list = D.leaders.filter(function (p) {
        if (slot && p.slot !== slot) return false;
        return !q || (p.name + " " + p.nhlTeam + " " + p.owner).toLowerCase().indexOf(q) >= 0;
      });
    }

    var head = isFree
      ? "<th class='l'>Player</th><th class='l hide-s'>Pos</th><th>GP</th><th>Would score</th>"
      : "<th style='width:34px'></th><th class='l'>Player</th><th class='l hide-s'>Slot</th>" +
        "<th class='l'>Owner</th><th>GP</th><th>Points</th>";

    var rows = list.slice(0, 200).map(function (p, i) {
      if (isFree) {
        return "<tr><td class='l'>" + esc(p.name) + " <span class='tiny'>" + esc(p.nhlTeam) +
          "</span></td><td class='l hide-s muted'>" + esc(p.pos || "") + "</td>" +
          "<td class='num'>" + p.gp + "</td><td class='num big'>" + num(p.points) + "</td></tr>";
      }
      return "<tr><td class='rank'>" + (i + 1) + "</td>" +
        "<td class='l'>" + esc(p.name) + " <span class='tiny'>" + esc(p.nhlTeam) + "</span>" +
        (p.counting ? "" : " <span class='tiny'>(bench)</span>") + "</td>" +
        "<td class='l hide-s muted'>" + esc(SLOT_LABEL[p.slot] || p.slot) + "</td>" +
        "<td class='l muted'>" + esc(p.owner) + "</td>" +
        "<td class='num'>" + p.gp + "</td>" +
        "<td class='num big'>" + num(p.points) + "</td></tr>";
    }).join("");

    document.getElementById("plist").innerHTML =
      '<div class="card"><div class="scroll"><table><thead><tr>' + head +
      "</tr></thead><tbody>" + (rows || "<tr><td class='l muted'>No players match.</td></tr>") +
      "</tbody></table></div></div>" +
      (isFree ? '<p class="tiny">Unrostered skaters, scored under BHL skater rules for comparison.</p>' : "");
  }

  /* ---------------------------------------------------------- rules */
  function renderRules() {
    var s = D.scoring;
    function block(title, rules) {
      return '<div class="card"><h3>' + title + "</h3><div class='pad'>" +
        rules.map(function (r) {
          return '<div class="rule"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>";
        }).join("") + "</div></div>";
    }
    return '<div class="grid2">' +
      block("Skaters &amp; Rookies", [
        ["Goal", s.skater.goal], ["Assist", s.skater.assist],
        ["Plus / minus", s.skater.plusMinus], ["Game-winning goal", s.skater.gameWinningGoal],
      ]) +
      block("Goalies", [
        ["Win", s.goalie.win], ["Overtime loss", s.goalie.otLoss], ["Save", s.goalie.save],
        ["GAA under 2.00", 40], ["GAA 2.00 – 2.49", 25],
        ["GAA 2.50 – 2.99", 10], ["GAA 3.00 and up", 0],
      ]) +
      block("Goon", [["Penalty minute", s.goon.penaltyMinute]]) +
      block("Lineup", [
        ["Forwards counted", "top " + s.lineup.forwardsCounted + " of 6"],
        ["Defensemen counted", "top " + s.lineup.defenseCounted + " of 4"],
        ["Goalies counted", "best " + s.lineup.goaliesCounted + " of 2"],
        ["Goon counted", s.lineup.goonCounted], ["Rookie counted", s.lineup.rookieCounted],
      ]) +
      "</div>" +
      '<div class="note">Goons score penalty minutes only — goals and assists don\'t count for them. ' +
      "Rookies score under the full skater rules. Every team's total is the sum of its counted " +
      "forwards, defensemen, best goalie, goon and rookie.</div>";
  }

  /* ----------------------------------------------------------- shell */
  function draw() {
    if (view === "standings") main.innerHTML = renderStandings();
    else if (view === "teams") main.innerHTML = currentTeam ? renderTeam(currentTeam) : renderTeamList();
    else if (view === "players") { main.innerHTML = renderPlayers(); drawPlayers(); }
    else main.innerHTML = renderRules();

    Array.prototype.forEach.call(main.querySelectorAll("[data-team]"), function (b) {
      b.addEventListener("click", function () {
        currentTeam = b.getAttribute("data-team");
        view = "teams"; setTab("teams"); draw(); window.scrollTo(0, 0);
      });
    });
    var back = document.getElementById("back");
    if (back) back.addEventListener("click", function () { currentTeam = null; draw(); });

    ["q", "slotf", "pool"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", drawPlayers);
    });
  }

  function setTab(v) {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.classList.toggle("active", t.getAttribute("data-view") === v);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.addEventListener("click", function () {
      view = t.getAttribute("data-view");
      if (view !== "teams") currentTeam = null;
      setTab(view); draw();
    });
  });

  fetch("data/standings.json?v=" + Date.now())
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (json) {
      D = json;
      document.getElementById("seasonLine").textContent =
        D.seasonLabel + " season" + (D.seed ? " · sample data from last season until opening night" : "");
      document.getElementById("updatedLine").textContent = "updated " + ago(D.updated);
      var stale = (Date.now() - new Date(D.updated)) > 48 * 3600 * 1000;
      document.getElementById("freshDot").className = "dot" + (stale ? " stale" : "");
      draw();
    })
    .catch(function (e) {
      main.innerHTML = '<div class="note warn"><b>Could not load league data.</b> ' +
        esc(e.message) + " — the daily update may not have run yet.</div>";
    });
})();
