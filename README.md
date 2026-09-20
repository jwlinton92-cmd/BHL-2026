# Bush Hockey League

A self-updating website for the BHL fantasy hockey league. Scoring is ported
directly from `BHL 2026 Scoring.xlsx` and verified to match it to the penny.

Every morning a GitHub Action pulls season-to-date stats from the NHL's public
API, rescores all eight teams, and commits the result. The site is static, so
there's no server to run and nothing to pay for.

---

## One-time setup (about 10 minutes)

1. **Create the repo.** On GitHub, click **New repository**, name it `bhl`,
   make it **Public** (required for free GitHub Pages), and don't add a README.

2. **Upload these files.** On the empty repo page click
   **uploading an existing file**, drag in everything from this folder, and
   commit. Make sure the `.github` folder comes along — if your browser hides
   it, use the command line instead:

   ```bash
   git init && git branch -M main
   git add . && git commit -m "BHL site"
   git remote add origin https://github.com/YOUR-USERNAME/bhl.git
   git push -u origin main
   ```

3. **Turn on Pages.** Repo **Settings → Pages → Build and deployment →
   Source: GitHub Actions**.

4. **Allow the bot to commit.** Repo **Settings → Actions → General →
   Workflow permissions → Read and write permissions → Save**.

5. **Run it once.** Repo **Actions → Update BHL standings → Run workflow**.
   When it finishes, your site is live at
   `https://YOUR-USERNAME.github.io/bhl/` — send that link to the league.
   No accounts, no logins, works on phones.

---

## Setting up the draft

The draft room at `draft.html` is a live board — all eight owners open it on
their own devices and picks appear for everyone within a second. That needs a
tiny bit of shared storage, which Firebase provides free.

Do this once, before draft night:

1. **Create a Firebase project.** Go to `console.firebase.google.com` →
   **Add project**. Name it anything. Turn Google Analytics off.

2. **Create the database.** Left sidebar → **Build → Realtime Database →
   Create database**. Any location. Choose **Start in locked mode**.

3. **Install the rules.** Open the **Rules** tab, replace what's there with the
   contents of `database-rules.json` from this repo, and click **Publish**.
   These rules are what stop someone drafting for another team.

4. **Turn on anonymous sign-in.** **Build → Authentication → Get started →
   Anonymous → Enable.** Nobody makes an account; this just gives each browser
   a stable identity so the rules have something to check.

5. **Copy your config.** **Project settings** (gear icon) **→ General →
   Your apps → Web** (the `</>` icon). Register the app, then copy the
   `firebaseConfig` object it shows you.

6. **Paste it in.** Put those values into `assets/firebase-config.js`, change
   `COMMISSIONER_CODE` to something only you know, and commit.

Until step 6 is done the draft page shows these instructions instead of a board,
so it's safe to deploy early.

> The Firebase config values are public — every Firebase web app ships them in
> its page source, and that's fine. Your draft is protected by the rules from
> step 3, not by hiding the config. The commissioner code is in that file too,
> so treat it as a guard against accidents rather than a real secret.

### Draft night

1. **You go first.** Open the draft room, enter the commissioner code, and claim
   your team. Whoever enters the code first is commissioner for the whole draft,
   so do this before sending the link out.
2. **Send everyone the link** (`.../draft.html`). Each person claims their team.
   If somebody grabs the wrong one, use **Release a team**.
3. **Randomize the pick order**, then **Start draft**.
4. **Pick.** The board shows who's on the clock and turns green on your screen
   when it's you. Search or sort the pool, hit **Draft**, and it's locked in for
   everyone. Order snakes — 1 through 8, then 8 through 1.
5. **When it ends**, the board shows a **Save the results** box. Copy that and
   paste it over `data/rosters.json` in the repo. The standings rescore on their
   own once you commit.

A few things worth knowing:

- **The clock is advisory.** Nothing auto-picks when it hits zero. If someone
  goes quiet, you can use **Pick best available** for them, or just wait.
- **Undo last pick** walks the draft back one pick at a time.
- **Goon and rookie slots are the one place to be careful.** Both accept any
  skater, but a goon scores *only* penalty minutes. When a pick could go in
  either spot, the room makes you choose and shows what the player is worth
  each way.
- **Rookie eligibility isn't enforced.** The NHL API doesn't expose it cleanly,
  so the room lets any skater fill the rookie slot and trusts the league to
  police it — same as the spreadsheet always did.
- **Refreshing is safe.** All state lives in the database, so a closed laptop or
  a dead phone loses nothing.

---

## Running the league

### Changing a roster

Edit **`data/rosters.json`** on GitHub (click the file, then the pencil icon)
and commit. The standings rescore automatically within a minute or two — you
don't need to wait for the next morning.

Each team has exactly six `F`, four `D`, two `G`, one `GOON` and one `ROOKIE`.
Spell names as the NHL does; accents and punctuation don't matter
(`Tim Stutzle` finds `Tim Stützle`).

If a name doesn't match anything, that player scores zero and **a red banner
appears at the top of the site** naming them, so a typo can't quietly cost
someone a season. Fix the spelling, or add the mapping to `data/aliases.json`.

### Changing the scoring

Edit **`data/scoring.json`**. Every value the league uses lives there — point
values, the GAA bonus bands, and how many players at each position count.

---

## How scoring works

| | |
|---|---|
| **Skaters and rookies** | Goal 2 · Assist 1 · Plus/minus 0.5 · Game-winner 1 |
| **Goalies** | Win 2 · OT loss 1 · Save 0.1 · plus a GAA bonus |
| **GAA bonus** | Under 2.00 → 40 · 2.00–2.49 → 25 · 2.50–2.99 → 10 · 3.00+ → 0 |
| **Goons** | Penalty minutes only, at 0.25 each |

A team's total counts its **top 4 forwards**, **top 3 defensemen**, the
**better of its two goalies**, its **goon** and its **rookie**. Bench players
still show on the team page, greyed out, so you can see what you left out.

---

## Files

```
index.html                  the league site
draft.html                  the live draft room
assets/style.css            shared styling
assets/app.js               league site rendering
assets/draft.css            draft room styling
assets/draft.js             draft room logic
assets/firebase-config.js   ← paste your Firebase settings here
database-rules.json         ← paste this into the Firebase Rules tab
data/rosters.json           ← the file you edit between drafts
data/scoring.json           ← point values and lineup rules
data/aliases.json           name-spelling fixes
data/players.json           generated draft pool — don't edit by hand
data/standings.json         generated output — don't edit by hand
scripts/update.py           the daily updater
.github/workflows/          the daily cron and the Pages deploy
```

## Notes

- Before opening night the site shows **last season's stats as sample data**,
  clearly labelled, so the page isn't empty. It switches to live numbers on
  its own once real games are played.
- To preview locally: `python3 -m http.server 8000`, then open
  `http://localhost:8000`.
- To rescore locally: `python scripts/update.py` (no dependencies beyond
  Python 3).
- The daily job runs at 7:15am Central, after West Coast games are final.
- The draft pool ranks players by what they *would* have scored under BHL rules
  last season, so the ordering already reflects your league, not generic
  fantasy value. Note that goalies dominate it — saves at 0.1 each add up.
