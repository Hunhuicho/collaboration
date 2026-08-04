/* ------------------------------------------------------------------
   Investigation registry — one entry per document.

   Add a new investigation here and it appears in the left rail on every
   page, with its date and progress.

     id     storage key, must match REVIEW_DOC.id in the document page
     code   short project tag shown above the title
     title  what appears in the rail and on the card
     desc   one line on the card
     items  how many review items the document has
     date   the day the investigation was opened (YYYY-MM-DD)
     href   path to the document page, relative to the site root
     tags   optional [class, label] pairs rendered as pills
------------------------------------------------------------------ */
window.BOARD_DOCS = [
  {
    id: "s04-po-confirmation-split",
    code: "MERP S04",
    title: "PO Confirmation — Split Schedules",
    desc: "Can Ariba split a PO confirmation at all? Then: confirm / reject / conditional acceptance, and what MERP has to receive over EDI",
    items: 12,
    date: "2026-08-04",
    href: "docs/s04-po-confirmation-split.html",
    tags: [["red", "BLOCKED ON ARIBA"], ["amber", "REVIEW REQUESTED"]]
  },
  {
    id: "s04-purchase-progress-status",
    code: "MERP S04",
    title: "Purchase Progress Status Design",
    desc: "One end-user status for PR and PO screens, task status per business process, cancellation triggers, PR and PO modification policy",
    items: 20,
    date: "2026-07-31",
    href: "docs/s04-purchase-progress-status.html",
    tags: [["blue", "WORKING DRAFT"], ["amber", "REVIEW REQUESTED"]]
  }
];
