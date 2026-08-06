# Review Board

A static web board for putting a design or an open question in front of colleagues and collecting a
**Yes / No plus a comment on every item**. Everyone who enters the same **shared passcode** works on
the **same page**: one shared copy per investigation, filled in between them.

- Hosting: **Cloudflare Pages** (files served as-is, no build step)
- Storage: **Firebase Firestore**, called over REST — no SDK bundle, no version to pin
- Identity: **anonymous auth** — nobody is named; the passcode is the access control
- Gate: a passcode is required before any page renders (`public/assets/access.js`)

**Live:** <https://collaboration-a43.pages.dev> — Firebase project `collaboration-ae736`,
shared storage on. Section 2 is the one-time setup and is already done for this deployment.

Without a passcode the documents still open and you can answer — entries just stay in your browser.
Enter a passcode and shared storage switches on from that moment.

---

## 1. Layout

```
public/                         ← what Cloudflare serves
├─ index.html                   document list + passcode gate
├─ assets/
│  ├─ app.css                   shared styles (light/dark automatic)
│  ├─ board-core.js             passcode gate, anonymous auth, Firestore REST
│  ├─ review.js                 reply widgets, summary, live sync
│  └─ firebase-config.js        ★ the only file you have to fill in
└─ docs/
   └─ s04-purchase-progress-status.html     review document

firestore.rules                 security rules
firebase.json                   for deploying the rules
wrangler.toml                   Cloudflare deploy settings
public/_headers                 response headers (caching, referrer policy)
tools/inline.mjs                bundle one page into a single HTML file
tools/passcode.mjs              set the passcode
```

Data paths:

```
rooms/{roomKey}/meta/room       workspace label
rooms/{roomKey}/docs/{docId}    the shared document for one investigation
```

One document per investigation, shared by everyone on the passcode. Writes carry an
`updateMask` naming only the items that changed, so two people filling in different
items at the same time do not overwrite one another.

`roomKey` is the SHA-256 hash of the shared passcode. Without the passcode the path cannot be
constructed, so the data cannot be reached.

---

## 2. Setup (once)

### 2-1. Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. **Build → Firestore Database → Create database** (production mode; `asia-northeast3` is a good region)
3. **Build → Authentication → Sign-in method → Anonymous** — enable it. Miss this and nothing saves.
4. **Project settings → General → Your apps → add a web app**, then note `apiKey` and `projectId`
5. Paste both into `public/assets/firebase-config.js`

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  projectId: "my-project-id"
};
```

6. Publish the rules — paste `firestore.rules` into the console's **Firestore → Rules** tab, or:

```bash
npx firebase login
npx firebase use <projectId>
npm run rules
```

> `apiKey` and `projectId` are public identifiers that ship to the browser. The rules and the
> passcode do the actual gatekeeping. Never commit a service-account key.

### 2-2. Cloudflare

```bash
npm install
npx wrangler login
npm run deploy          # wrangler pages deploy public
```

From GitHub instead: Cloudflare dashboard → **Workers & Pages → Create → Pages →
Connect to Git**, pick this repository, production branch `main`:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `public` |
| Deploy command (if the project asks for one) | `npx wrangler pages deploy public` |

> It has to be a **Pages** project, not a Worker. Pages serves at
> `<project>.pages.dev`; a Worker serves at `<worker>.<account-subdomain>.workers.dev`,
> which drags the account subdomain into every URL. The project name in
> `wrangler.toml` must match the Pages project name.

### 2-3. The passcode

Every page stays blank until the passcode is entered. Change it with:

```bash
node tools/passcode.mjs "new passcode"
```

Only the SHA-256 hash is committed — the passcode itself is never in the repository,
so a forgotten passcode is replaced, not recovered. Clearing `passHash` in
`public/assets/access.js` removes the gate.

> This is a **client-side** check on a static site. It stops the link being casually
> readable and is the right weight for a meeting link, but someone who has the URL and
> wants in can read the page source. It is not authentication — keep confidential
> material off the board.

### 2-4. First entry

1. Open the deployed address and you get a passcode prompt.
2. A passcode nobody has used yet asks you to **name the workspace**, then creates it.
3. From then on, everyone entering that passcode lands in the same workspace.

> Typo protection: an unknown passcode does not silently let you in — it asks whether you meant to
> create a new workspace.

---

## 3. Running locally

```bash
npm run serve      # http://localhost:8080  (python static server)
# or
npm run dev        # http://localhost:8788  (wrangler pages dev)
```

Shared storage needs HTTPS or localhost — that is a WebCrypto requirement.

---

## 4. Adding a document

1. Drop a new HTML file into `public/docs/`. Copying an existing one is the quickest start.
2. Write the content however you like, and put a placeholder wherever a reply belongs:

```html
<div data-review="q1"></div>                          <!-- full reply box -->
<div data-review="q7" data-variant="inline"></div>     <!-- compact, sits inside a card -->
```

3. Define the document at the end of the file:

```html
<script src="../assets/firebase-config.js"></script>
<script src="../assets/board-core.js"></script>
<script>
window.REVIEW_DOC = {
  id: "s05-vendor-master",              // storage key — never change it once in use
  code: "MERP S05",
  title: "Vendor Master Design",
  items: [
    { id:"q1", sec:"01", label:"Code scheme", q:"Do you agree with the proposed code scheme?", hint:"Optional helper text" },
    { id:"q7", sec:"03", label:"Duplicate check", q:"Do you agree with the duplicate rules?", variant:"inline" }
  ]
};
</script>
<script src="../assets/review.js"></script>
```

4. Add one entry to `window.BOARD_DOCS` in `public/assets/docs.js` and it shows up in the left rail.

The top bar, the final-conclusion box and the summary are generated by `review.js`. A document page only needs
`<div id="topbarMount"></div>` and `<div id="summaryMount"></div>` as anchors.

### Item fields

| Field | Meaning |
| --- | --- |
| `id` | Storage key. Unique within the document; changing it later orphans existing entries |
| `sec` | Section number shown on screen |
| `label` | Short name used in the summary table |
| `q` | The question |
| `hint` | Optional helper line under the question |
| `variant` | Optional; `"inline"` renders the compact form for use inside a card, `"note"` a comment-only block |
| `choices` | Optional `[[code, label], …]` to replace Yes / No / Hold. An empty list means comment only |

---

## 5. For reviewers

- Pick **Yes**, **No — needs change**, or **Hold** on each item and add a comment. A reason is
  required whenever you pick No.
- Entries save as you type; the badge in the top bar switches to `Saved`.
- Everyone fills in the **same page**. What someone else writes appears within about 15 seconds,
  and immediately when you switch back to the tab. Whatever you are typing is never overwritten.
- Every document ends with a **Final conclusion** box — generated by the engine, so a new document gets it automatically.

---

## 6. Worth knowing

- Anyone with the passcode can **read, write and overwrite everything** in that workspace. There is
  no read-only role and no record of who wrote what.
- **Clear** wipes the page for everyone, not just for you.
- Anything typed into a browser before shared storage was switched on is lifted into the shared
  document the first time that browser opens the page. It only fills blanks; where someone had
  already answered, the other reply is appended after a `⚠ another reply:` marker rather than
  being thrown away, so the two can be reconciled by hand.
- To hand someone a single file, run `node tools/inline.mjs <path to document>`; it writes a
  self-contained HTML file to `dist/`. That copy runs in local-only mode.
