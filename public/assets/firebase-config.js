/* ------------------------------------------------------------------
   Firebase connection settings — fill these two in and shared storage
   turns on.

   Firebase console → Project settings → General → "Your apps" → the web
   app's SDK snippet. Copy apiKey and projectId across.

   Left blank, every page falls back to local-only mode: entries stay in
   that one browser and are never shared.

   Both values are public identifiers that ship to the browser. Real
   access control comes from firestore.rules and the shared passcode.
   Never put a service-account key in this file.
------------------------------------------------------------------ */
window.FIREBASE_CONFIG = {
  apiKey: "",
  projectId: ""
};
