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
 // Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBcmsVXaws818Efub8b5WngrZoclrLKyI8",
  authDomain: "bhl-draft.firebaseapp.com",
  databaseURL: "https://bhl-draft-default-rtdb.firebaseio.com",
  projectId: "bhl-draft",
  storageBucket: "bhl-draft.firebasestorage.app",
  messagingSenderId: "957962543414",
  appId: "1:957962543414:web:7f13da824d3b62e4ebd397",
  measurementId: "G-78T65WBX7K"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);,
};

/* The word you type to unlock commissioner controls (start the draft, undo a
   pick, release a team). Change it before you share the link. This keeps
   leaguemates from bumping the controls by accident; it is not a secret, since
   anyone can read this file. The first person to enter it claims commissioner
   for the whole draft, so claim it yourself before sending the link out. */
export const COMMISSIONER_CODE = "linton";

/* Seconds on the clock per pick. Advisory only — nothing auto-picks when it
   runs out; the commissioner decides whether to nudge or pick for someone. */
export const PICK_SECONDS = 120;
