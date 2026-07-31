/* ------------------------------------------------------------------
   Passcode that guards the board.

   Only the SHA-256 hash lives here — the passcode itself is never stored
   in the repository. To change it:

     node tools/passcode.mjs "new passcode"

   Leave passHash empty to drop the gate entirely.

   This is a client-side check on a static site: it keeps the link from
   being casually readable, but someone who has the URL and wants in can
   read the page source. Treat it like a meeting-link password, not like
   authentication — and keep confidential material off the board.
------------------------------------------------------------------ */
window.BOARD_ACCESS = {
  label: "MERP S04 Review",
  passHash: "f7d788664a5b0dde6d96fa9fd4456af058fc7bf50e0bdaa52f0f28103b99bfdb"
};
