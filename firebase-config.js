/* ---------------------------------------------------------------------------
   BHL draft — Firebase settings.

   These values are public. Firebase web apps expose this configuration in the
   page source. Protect the database with database-rules.json, not by hiding
   these values.
--------------------------------------------------------------------------- */

export const firebaseConfig = {
  apiKey: "AIzaSyBcmsVXaws818Efub8b5WngrZoclrLKyI8",
  authDomain: "bhl-draft.firebaseapp.com",
  databaseURL: "https://bhl-draft-default-rtdb.firebaseio.com",
  projectId: "bhl-draft",
  storageBucket: "bhl-draft.firebasestorage.app",
  messagingSenderId: "957962543414",
  appId: "1:957962543414:web:7f13da824d3b62e4ebd397",
  measurementId: "G-78T65WBX7K",
};

/* The word used to unlock commissioner controls. This is only an accidental-
   use guard, not a true secret, because this file is publicly readable. */
export const COMMISSIONER_CODE = "linton";

/* Seconds on the clock per pick. Advisory only. */
export const PICK_SECONDS = 120;
