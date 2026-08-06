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
    id: "data-requests-urgent",
    code: "MERP S04",
    title: "Urgent Data Requests",
    desc: "Master data we are waiting on, most urgent first — material group L2, chemical name and group, purchasing group",
    items: 3,
    date: "2026-08-04",
    href: "docs/data-requests.html",
    tags: [["red", "URGENT"], ["amber", "DATA NEEDED"]]
  },
  {
    id: "s04-po-confirmation-split",
    code: "MERP S04",
    title: "PO Confirmation — What Ariba Allows",
    desc: "What can a supplier change or split when confirming a PO in Ariba, and does it apply immediately — six questions to put to the platform",
    items: 7,
    date: "2026-08-04",
    href: "docs/s04-po-confirmation-split.html",
    tags: [["red", "INVESTIGATION FIRST"], ["amber", "REVIEW REQUESTED"]]
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
