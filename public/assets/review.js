/* ==================================================================
   review.js — review document page engine

   A document page only carries its own content plus a REVIEW_DOC
   definition. The top bar, reply widgets, summary and the all-responses
   view are generated here.

   window.REVIEW_DOC = {
     id:    "s04-purchase-progress-status",   // storage key — never change
     code:  "MERP S04",
     title: "Purchase Progress Status Design",
     items: [ { id:"q1", sec:"01", label:"…", q:"…", hint:"…", variant:"inline" }, … ]
   }
   Place <div data-review="q1"></div> wherever a reply box belongs.
   ================================================================== */
(function () {
  "use strict";

  var DOC = window.REVIEW_DOC;
  if (!DOC) return;
  var B = window.Board;
  var ITEMS = DOC.items || [];
  var LSKEY = "board.doc." + DOC.id;
  var ANSWER_LABEL = { Y: "Agree", N: "Needs change", H: "Hold" };
  var ANSWER_CLASS = { Y: "a-y", N: "a-n", H: "a-h" };
  var DEFAULT_CHOICES = [["Y", "Yes"], ["N", "No — needs change"], ["H", "Hold"]];

  /* An item may carry its own choice labels — an investigation question is not
     answered with "agree". An empty list means comment only. */
  function choicesOf(item) {
    return item && item.choices ? item.choices : DEFAULT_CHOICES;
  }
  function ansLabel(item, v) {
    var list = choicesOf(item);
    for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1];
    return ANSWER_LABEL[v] || v;
  }

  var esc = B.esc, toast = B.toast;
  var state = loadLocal();
  var connected = false;
  var saveTimer = null, remoteTimer = null, pollTimer = null;

  /* Items changed since the last successful push. Only these get written, so
     someone else editing a different item at the same time is not clobbered. */
  var dirty = {}, dirtyOverall = false, pushing = false;
  function markDirty(id) { dirty[id] = true; }

  /* ---------------- local storage ---------------- */
  function blank() { return { overall: "", answers: {}, updatedAt: 0 }; }
  function loadLocal() {
    try {
      var v = JSON.parse(localStorage.getItem(LSKEY) || "null");
      if (!v || typeof v !== "object") return blank();
      return { overall: v.overall || "", answers: v.answers || {}, updatedAt: v.updatedAt || 0 };
    } catch (e) { return blank(); }
  }
  function saveLocal() {
    try { localStorage.setItem(LSKEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- mount: top bar ---------------- */
  function mountTopbar() {
    var host = document.getElementById("topbarMount");
    if (!host) return;
    host.outerHTML =
      '<div class="topbar">' +
        '<div class="topbar-in">' +
          '<div class="tb-id">' +
            '<b>' + esc(DOC.title) + '</b>' +
            '<span class="sub"><a href="../index.html">← All documents</a><span id="roomName"></span></span>' +
          '</div>' +
          '<div class="tb-prog">' +
            '<div class="meter" role="progressbar" aria-label="Reply progress" aria-valuemin="0" aria-valuemax="' + ITEMS.length + '" aria-valuenow="0" id="meter"><i id="meterFill"></i></div>' +
            '<div class="tb-count"><b id="cDone">0</b> / ' + ITEMS.length + ' answered</div>' +
          '</div>' +
          '<div class="tb-actions">' +
            '<span class="sync off" id="syncBadge"><span class="dot"></span><span id="syncText">Local only</span></span>' +
            '<button class="btn ghost" type="button" id="btnJump">Next unanswered</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- mount: summary + all replies ---------------- */
  function mountSummary() {
    var host = document.getElementById("summaryMount");
    if (!host) return;
    host.outerHTML =
      '<section class="section closing" id="closing">' +
        '<div class="sec-head"><div class="sec-num">FINAL</div><div>' +
          '<h2>Final conclusion</h2><p>Where we land overall, once the items above have been worked through.</p>' +
        '</div></div>' +
        '<div class="card closing-card">' +
          '<label for="rvOverall">Conclusion</label>' +
          '<textarea id="rvOverall" rows="5" placeholder="What we conclude, what we would decide, and anything to take to the meeting."></textarea>' +
        '</div>' +
      '</section>' +
      '<section class="section summary" id="summary">' +
        '<div class="sec-head"><div class="sec-num">SUMMARY</div><div>' +
          '<h2>Summary</h2><p>Everything entered on this page, in one place.</p>' +
        '</div></div>' +
        '<div class="tally">' +
          '<div><span class="k">Agree</span><span class="v yes" id="tYes">0</span></div>' +
          '<div><span class="k">Needs change</span><span class="v no" id="tNo">0</span></div>' +
          '<div><span class="k">Hold</span><span class="v hold" id="tHold">0</span></div>' +
          '<div><span class="k">No answer</span><span class="v" id="tNone">' + ITEMS.length + '</span></div>' +
        '</div>' +
        '<div class="card scroll-x"><table class="sumtbl">' +
          '<thead><tr><th>Item</th><th>Reply</th><th>Comment</th></tr></thead>' +
          '<tbody id="sumBody"></tbody>' +
        '</table></div>' +
        '<div class="send">' +
          '<p id="sendNote">Everyone on this passcode fills in the same page. Entries save automatically and appear for everyone.</p>' +
          '<button class="btn" type="button" id="btnReset">Clear</button>' +
        '</div>' +
      '</section>';
  }

  /* ---------------- reply widgets ---------------- */
  function buildItems() {
    ITEMS.forEach(function (item, i) {
      var host = document.querySelector('[data-review="' + item.id + '"]');
      if (!host) return;
      var n = i + 1;
      var variant = host.dataset.variant || item.variant;
      var inline = variant === "inline";
      var note = variant === "note";
      host.className = "review" + (inline ? " inline" : "") + (note ? " note" : "");
      host.id = "rv-" + item.id;

      host.innerHTML = note
        ? '<div class="rv-head">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            '<div><div class="rv-q">' + esc(item.q) + (item.hint ? '<em>' + esc(item.hint) + '</em>' : '') + '</div></div>' +
          '</div>' +
          '<div class="rv-body">' +
            '<div class="rv-comment">' +
              '<label for="c-' + item.id + '">Your view</label>' +
              '<textarea id="c-' + item.id + '" rows="3" placeholder="Write what you think it should be"></textarea>' +
            '</div>' +
          '</div>'
        : inline
        ? '<div class="rv-mini">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            (choicesOf(item).length
              ? '<div class="choices" role="group" aria-label="' + esc(item.label) + ' reply">' + choiceBtns(item) + '</div>'
              : '') +
          '</div>' +
          '<textarea id="c-' + item.id + '" rows="2" aria-label="' + esc(item.label) + ' comment" placeholder="Add a comment"></textarea>'
        : '<div class="rv-head">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            '<div><div class="rv-q">' + esc(item.q) + (item.hint ? '<em>' + esc(item.hint) + '</em>' : '') + '</div></div>' +
          '</div>' +
          '<div class="rv-body">' +
            '<div class="choices" role="group" aria-label="' + esc(item.label) + ' reply">' + choiceBtns(item) + '</div>' +
            '<div class="rv-comment">' +
              '<label for="c-' + item.id + '">Comment</label>' +
              '<textarea id="c-' + item.id + '" rows="2" placeholder="Add a comment"></textarea>' +
            '</div>' +
          '</div>';

      var ta = host.querySelector("textarea");
      ta.value = (state.answers[item.id] || {}).c || "";
      ta.addEventListener("input", function () { setAnswer(item.id, undefined, ta.value); });

      host.querySelectorAll(".choice").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var cur = (state.answers[item.id] || {}).v;
          var next = cur === btn.dataset.v ? null : btn.dataset.v;
          setAnswer(item.id, next, undefined);
          if (next === "N") ta.focus();
        });
      });
    });
  }
  var CHOICE_CLASS = { Y: "yes", N: "no", H: "hold" };
  function choiceBtns(item) {
    return choicesOf(item).map(function (c) {
      return '<button type="button" class="choice ' + (CHOICE_CLASS[c[0]] || "") + '" data-v="' + c[0] +
             '" aria-pressed="false"><span class="mark"></span>' + esc(c[1]) + '</button>';
    }).join("");
  }

  function setAnswer(id, v, c) {
    var a = state.answers[id] || (state.answers[id] = { v: null, c: "" });
    if (v !== undefined) a.v = v;
    if (c !== undefined) a.c = c;
    if (!a.v && !(a.c || "").trim()) delete state.answers[id];
    markDirty(id);
    touch();
    paint(id);
    refresh();
  }

  function itemById(id) {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
    return null;
  }
  function isNote(it) { return !!it && (it.variant === "note" || (!!it.choices && it.choices.length === 0)); }
  function answered(it, src) {
    var a = (src || state.answers)[it.id] || {};
    return isNote(it) ? !!(a.c || "").trim() : !!a.v;
  }

  function paint(id) {
    var host = document.getElementById("rv-" + id);
    if (!host) return;
    var it = itemById(id) || {};
    var a = state.answers[id] || {};
    host.querySelectorAll(".choice").forEach(function (btn) {
      btn.setAttribute("aria-pressed", a.v === btn.dataset.v ? "true" : "false");
    });
    host.classList.toggle("answered", answered(it));
    host.classList.toggle("needs-note", a.v === "N" && !(a.c || "").trim());
  }

  function repaintAll() {
    ITEMS.forEach(function (it) {
      var host = document.getElementById("rv-" + it.id);
      if (host) {
        var ta = host.querySelector("textarea");
        /* Never rewrite the box being typed in — it would move the cursor. */
        if (ta && ta !== document.activeElement) ta.value = (state.answers[it.id] || {}).c || "";
        paint(it.id);
      }
    });
    var o = document.getElementById("rvOverall");
    if (o && o !== document.activeElement) o.value = state.overall;
    refresh();
  }

  /* ---------------- saving ---------------- */
  function touch() {
    state.updatedAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 200);
    queueRemote();
  }

  function setSync(kind, text) {
    var badge = document.getElementById("syncBadge");
    var label = document.getElementById("syncText");
    if (!badge || !label) return;
    badge.className = "sync " + kind;
    label.textContent = text;
  }

  function queueRemote() {
    if (!connected) return;
    setSync("busy", "Saving…");
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(pushRemote, 1200);
  }

  function pushRemote() {
    if (!connected || pushing) return;
    var ids = Object.keys(dirty), ov = dirtyOverall;
    if (!ids.length && !ov) return;

    pushing = true;
    dirty = {}; dirtyOverall = false;

    B.saveShared(DOC.id, state, ids, ov).then(function () {
      pushing = false;
      lastRemote = null;                      // our own write; do not treat it as someone else's
      setSync("on", "Saved · " + B.stamp(new Date().toISOString()).slice(11));
    }, function (err) {
      pushing = false;
      ids.forEach(function (id) { dirty[id] = true; });   // put it back so the next attempt retries
      if (ov) dirtyOverall = true;
      setSync("err", "Save failed");
      console.warn("[board] save failed", err);
    });
  }

  /* ---------------- progress · summary ---------------- */
  function counts(answers) {
    var src = answers || state.answers, c = { Y: 0, N: 0, H: 0, note: 0, none: 0 };
    ITEMS.forEach(function (it) {
      if (!answered(it, src)) { c.none++; return; }
      if (isNote(it)) { c.note++; return; }
      var v = (src[it.id] || {}).v;
      if (v === "Y") c.Y++; else if (v === "N") c.N++; else if (v === "H") c.H++;
    });
    return c;
  }

  function refresh() {
    var c = counts();
    var done = ITEMS.length - c.none;
    var set = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
    set("cDone", done); set("tYes", c.Y); set("tNo", c.N); set("tHold", c.H); set("tNone", c.none);
    var fill = document.getElementById("meterFill");
    if (fill) fill.style.width = (done / ITEMS.length * 100) + "%";
    var meter = document.getElementById("meter");
    if (meter) meter.setAttribute("aria-valuenow", String(done));

    try {
      localStorage.setItem("board.progress." + DOC.id,
        JSON.stringify({ a: done, t: ITEMS.length, u: state.updatedAt || 0 }));
    } catch (e) {}
    if (window.BoardNav) window.BoardNav.refresh();

    var body = document.getElementById("sumBody");
    if (body) {
      body.innerHTML = ITEMS.map(function (it, i) {
        var a = state.answers[it.id] || {}, cm = (a.c || "").trim();
        var reply = isNote(it)
          ? '<span class="' + (cm ? "a-note" : "a-x") + '">' + (cm ? "Comment" : "—") + '</span>'
          : '<span class="' + (a.v ? ANSWER_CLASS[a.v] : "a-x") + '">' + (a.v ? esc(ansLabel(it, a.v)) : "—") + '</span>';
        return '<tr>' +
          '<td><span class="qn">Q' + (i + 1) + '</span> ' + esc(it.label) + '</td>' +
          '<td class="a">' + reply + '</td>' +
          '<td class="c' + (cm ? "" : " empty") + '">' + (cm ? esc(cm) : "—") + '</td>' +
        '</tr>';
      }).join("");
    }
  }

  /* ---------------- live sync with the shared document ----------------
     Everyone on the passcode edits the same document. We poll for other
     people's changes and fold them in without disturbing whatever the person
     at this keyboard is currently typing. */
  var lastRemote = null;

  function remoteSig(r) {
    return JSON.stringify({ a: r.answers || {}, o: r.overall || "" });
  }

  function normAnswers(src) {
    var out = {};
    Object.keys(src || {}).forEach(function (k) {
      var a = src[k] || {};
      var v = a.v || null, c = a.c || "";
      if (v || String(c).trim()) out[k] = { v: v, c: c };
    });
    return out;
  }

  /* Apply what is on the server. Two things are protected from being
     overwritten: edits not yet pushed, and the field with the cursor in it. */
  function applyRemote(remote) {
    if (!remote) return;
    var sig = remoteSig(remote);
    if (sig === lastRemote) return;
    lastRemote = sig;

    var activeId = (document.activeElement && document.activeElement.id) || "";
    var next = { overall: remote.overall || "", answers: normAnswers(remote.answers), updatedAt: Date.now() };

    var hold = {};
    Object.keys(dirty).forEach(function (id) { hold[id] = true; });
    ITEMS.forEach(function (it) { if (activeId === "c-" + it.id) hold[it.id] = true; });

    Object.keys(hold).forEach(function (id) {
      if (state.answers[id]) next.answers[id] = state.answers[id];
      else delete next.answers[id];
    });
    if (dirtyOverall || activeId === "rvOverall") next.overall = state.overall;

    state = next;
    saveLocal();
    repaintAll();
  }

  function pollRemote() {
    if (!connected || pushing) return;
    if (Object.keys(dirty).length || dirtyOverall) return;   // our own edit is in flight
    if (document.visibilityState === "hidden") return;
    B.loadShared(DOC.id).then(function (r) { if (r) applyRemote(r); }, function () {});
  }

  /* ---------------- first connect ----------------
     Anything already typed into this browser is lifted into the shared
     document, so a person who filled the page in before sharing was switched
     on does not lose it. It only fills blanks — a value someone else has
     already put in is never overwritten. Done once per document; after that
     the shared document is simply the truth. */
  function syncedKey() { return "board.synced." + DOC.id; }
  function alreadySynced() {
    try { return localStorage.getItem(syncedKey()) === "1"; } catch (e) { return false; }
  }
  function markSynced() {
    try { localStorage.setItem(syncedKey(), "1"); } catch (e) {}
  }

  function hasValue(a) { return !!a && (!!a.v || !!String(a.c || "").trim()); }

  /* Older entries lived in one document per person. Fold them in the first
     time, so nothing written under the old model is stranded. */
  function legacyAnswers() {
    return B.listAll(DOC.id).then(function (list) {
      var merged = { answers: {}, overall: "" };
      (list || []).slice().sort(function (a, b) {
        return String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
      }).forEach(function (r) {
        Object.keys(r.answers || {}).forEach(function (k) {
          if (hasValue(r.answers[k])) merged.answers[k] = r.answers[k];
        });
        if (String(r.overall || "").trim()) merged.overall = r.overall;
      });
      return merged;
    }, function () { return { answers: {}, overall: "" }; });
  }

  function firstConnect() {
    return B.loadShared(DOC.id).then(function (shared) {
      var local = { answers: normAnswers(state.answers), overall: state.overall || "" };

      if (alreadySynced()) {
        if (shared) applyRemote(shared);
        else { dirtyOverall = !!local.overall; Object.keys(local.answers).forEach(markDirty); }
        return;
      }

      var pre = shared ? Promise.resolve(null) : legacyAnswers();
      return pre.then(function (legacy) {
        var base = { answers: normAnswers((shared || legacy || {}).answers), overall: (shared || legacy || {}).overall || "" };
        var lifted = 0;

        Object.keys(local.answers).forEach(function (id) {
          var mine = local.answers[id];
          if (!hasValue(base.answers[id])) {
            base.answers[id] = mine;
            markDirty(id);
            lifted++;
            return;
          }
          /* Someone got here first. Their answer stands, but nothing typed
             here is thrown away — a differing choice or comment is appended
             so both are visible and the difference can be settled by hand. */
          var theirs = base.answers[id];
          var add = [];
          if (mine.v && theirs.v && mine.v !== theirs.v) {
            add.push("[also marked: " + ansLabel(itemById(id) || {}, mine.v) + "]");
          }
          var mc = String(mine.c || "").trim(), tc = String(theirs.c || "").trim();
          if (mc && mc !== tc && tc.indexOf(mc) === -1) add.push(mc);
          if (!add.length) return;

          base.answers[id] = { v: theirs.v, c: (tc ? tc + "\n\n" : "") + "⚠ another reply: " + add.join(" ") };
          markDirty(id);
          lifted++;
        });
        if (!String(base.overall).trim() && String(local.overall).trim()) {
          base.overall = local.overall;
          dirtyOverall = true;
        }
        if (!shared && legacy) {
          Object.keys(base.answers).forEach(markDirty);
          if (String(base.overall).trim()) dirtyOverall = true;
        }

        state = { overall: base.overall, answers: base.answers, updatedAt: Date.now() };
        lastRemote = remoteSig(base);
        saveLocal();
        repaintAll();
        markSynced();

        if (lifted) toast(lifted + " entr" + (lifted === 1 ? "y" : "ies") + " from this browser added to the shared page.");
      });
    });
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    var o = document.getElementById("rvOverall");
    o.value = state.overall;
    o.addEventListener("input", function () { state.overall = o.value; dirtyOverall = true; touch(); });

    document.getElementById("btnJump").addEventListener("click", function () {
      var target = null;
      for (var i = 0; i < ITEMS.length; i++) {
        if (!answered(ITEMS[i])) { target = ITEMS[i]; break; }
      }
      if (!target) {
        document.getElementById("summary").scrollIntoView({ block: "start" });
        toast("All " + ITEMS.length + " items answered.");
        return;
      }
      var host = document.getElementById("rv-" + target.id);
      host.scrollIntoView({ block: "center" });
      var btn = host.querySelector(".choice");
      if (btn) btn.focus();
    });

    document.getElementById("btnReset").addEventListener("click", function () {
      var msg = connected
        ? "Clear this page for everyone on the passcode? This cannot be undone."
        : "Clear everything entered on this page?";
      if (!window.confirm(msg)) return;
      ITEMS.forEach(function (it) { markDirty(it.id); });
      dirtyOverall = true;
      state = blank();
      saveLocal();
      repaintAll();
      if (connected) pushRemote();
      toast("Cleared.");
    });
  }

  /* ---------------- start ---------------- */
  function start() {
    mountTopbar(); mountSummary();
    buildItems(); wire(); repaintAll();

    setSync(B.hasConfig ? "busy" : "off", B.hasConfig ? "Connecting…" : "Local only");

    B.enter().then(function (room) {
      if (!B.hasConfig) {
        var note = document.getElementById("sendNote");
        if (note) note.textContent = "Shared storage is not configured, so this stays in your browser.";
        var rn = document.getElementById("roomName");
        if (rn && room && room.label) rn.textContent = "· " + room.label;
        return;
      }
      if (!room || !room.key) { setSync("off", "Local only"); return; }
      connected = true;
      var name = document.getElementById("roomName");
      if (name && room.label) name.textContent = "· " + room.label;

      return firstConnect().then(function () {
        setSync("on", "Shared");
        if (Object.keys(dirty).length || dirtyOverall) pushRemote();

        /* Pick up what other people write, without a reload. */
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollRemote, 15000);
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") pollRemote();
        });
        window.addEventListener("focus", pollRemote);
      });
    }).catch(function (err) {
      console.warn("[board] connect failed", err);
      setSync("err", "Connection failed");
      toast("Could not reach shared storage. Your entries stay in this browser.");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
