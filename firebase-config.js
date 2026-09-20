/* ---------------------------------------------------------------------------
   BHL draft — Firebase settings.

   Fill these in once, following the "Setting up the draft" section of the
   README. Until you do, the draft page shows setup instructions instead of a
   draft board.

   These values are meant to be public — every Firebase web app ships its config
   in the page source. Your data is protected by the database rules you install
   (database-rules.json), not by hiding this. Do not put anything secret here.
--------------------------------------------------------------------------- */

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",   // must look like https://YOUR-PROJECT-default-rtdb.firebaseio.com
  projectId: "",
  appId: "",
};

/* The word you type to unlock commissioner controls (start the draft, undo a
   pick, release a team). Change it before you share the link. This keeps
   leaguemates from bumping the controls by accident; it is not a secret, since
   anyone can read this file. The first person to enter it claims commissioner
   for the whole draft, so claim it yourself before sending the link out. */
export const COMMISSIONER_CODE = "change-me";

/* Seconds on the clock per pick. Advisory only — nothing auto-picks when it
   runs out; the commissioner decides whether to nudge or pick for someone. */
export const PICK_SECONDS = 120;
