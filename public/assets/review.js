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

  var esc = B.esc, toast = B.toast;
  var state = loadLocal();
  var connected = false;
  var saveTimer = null, remoteTimer = null;

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
            '<button class="btn" type="button" id="btnAll">All replies</button>' +
            '<button class="btn primary" type="button" id="btnCopy">Copy reply</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- mount: summary + all replies ---------------- */
  function mountSummary() {
    var host = document.getElementById("summaryMount");
    if (!host) return;
    host.outerHTML =
      '<section class="section summary" id="summary">' +
        '<div class="sec-head"><div class="sec-num">REPLY</div><div>' +
          '<h2>My reply</h2><p>This is exactly what gets saved and copied. Check it before you send.</p>' +
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
        '<div class="field" style="margin-top:16px;">' +
          '<label for="rvOverall">Overall comments · topics to raise (optional)</label>' +
          '<textarea id="rvOverall" rows="4" placeholder="Anything about the document as a whole, or a topic to take to the meeting."></textarea>' +
        '</div>' +
        '<div class="send">' +
          '<p id="sendNote">Replies save to the shared workspace automatically.</p>' +
          '<button class="btn" type="button" id="btnReset">Clear</button>' +
          '<button class="btn primary" type="button" id="btnCopy2">Copy reply</button>' +
        '</div>' +
      '</section>' +
      '<section class="section allview" id="allview" hidden>' +
        '<div class="sec-head"><div class="sec-num">ALL</div><div>' +
          '<h2>All replies</h2><p>Everyone on this passcode, gathered per item.</p>' +
        '</div></div>' +
        '<div class="allbar">' +
          '<p id="allCount">Loading…</p>' +
          '<button class="btn" type="button" id="btnRefresh">Refresh</button>' +
          '<button class="btn" type="button" id="btnCopyAll">Copy all replies</button>' +
        '</div>' +
        '<div class="card scroll-x"><table class="agg">' +
          '<thead><tr><th>Item</th><th>Agree</th><th>Change</th><th>Hold</th><th>Split</th></tr></thead>' +
          '<tbody id="aggBody"></tbody>' +
        '</table></div>' +
        '<div class="card" style="margin-top:14px;" id="peopleCard"><div class="empty-note">No replies yet.</div></div>' +
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
              '<label for="c-' + item.id + '">Your view <span class="opt">comment only — no yes/no</span></label>' +
              '<textarea id="c-' + item.id + '" rows="3" placeholder="Write what you think it should be"></textarea>' +
            '</div>' +
          '</div>'
        : inline
        ? '<div class="rv-mini">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            '<div class="choices" role="group" aria-label="' + esc(item.label) + ' reply">' + choiceBtns() + '</div>' +
          '</div>' +
          '<textarea id="c-' + item.id + '" rows="2" aria-label="' + esc(item.label) + ' comment" placeholder="Add a comment"></textarea>'
        : '<div class="rv-head">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            '<div><div class="rv-q">' + esc(item.q) + (item.hint ? '<em>' + esc(item.hint) + '</em>' : '') + '</div></div>' +
          '</div>' +
          '<div class="rv-body">' +
            '<div class="choices" role="group" aria-label="' + esc(item.label) + ' reply">' + choiceBtns() + '</div>' +
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
  function choiceBtns() {
    return '<button type="button" class="choice yes" data-v="Y" aria-pressed="false"><span class="mark"></span>Yes</button>' +
           '<button type="button" class="choice no" data-v="N" aria-pressed="false"><span class="mark"></span>No — needs change</button>' +
           '<button type="button" class="choice hold" data-v="H" aria-pressed="false"><span class="mark"></span>Hold</button>';
  }

  function setAnswer(id, v, c) {
    var a = state.answers[id] || (state.answers[id] = { v: null, c: "" });
    if (v !== undefined) a.v = v;
    if (c !== undefined) a.c = c;
    if (!a.v && !(a.c || "").trim()) delete state.answers[id];
    touch();
    paint(id);
    refresh();
  }

  function itemById(id) {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
    return null;
  }
  function isNote(it) { return it && it.variant === "note"; }
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
        if (ta) ta.value = (state.answers[it.id] || {}).c || "";
        paint(it.id);
      }
    });
    var o = document.getElementById("rvOverall");
    if (o) o.value = state.overall;
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
    if (!connected) return;
    B.saveMine(DOC.id, state).then(function () {
      setSync("on", "Saved · " + B.stamp(new Date().toISOString()).slice(11));
    }, function (err) {
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
          : '<span class="' + (a.v ? ANSWER_CLASS[a.v] : "a-x") + '">' + (a.v ? ANSWER_LABEL[a.v] : "—") + '</span>';
        return '<tr>' +
          '<td><span class="qn">Q' + (i + 1) + '</span> ' + esc(it.label) + '</td>' +
          '<td class="a">' + reply + '</td>' +
          '<td class="c' + (cm ? "" : " empty") + '">' + (cm ? esc(cm) : "—") + '</td>' +
        '</tr>';
      }).join("");
    }
  }

  /* ---------------- plain-text reply ---------------- */
  function buildText(src) {
    var s = src || state;
    var c = counts(s.answers || {});
    var L = [];
    L.push("[" + DOC.title + "] Review reply");
    L.push("Date: " + B.today());
    L.push("Answered: " + (ITEMS.length - c.none) + "/" + ITEMS.length +
      "  (agree " + c.Y + " · needs change " + c.N + " · hold " + c.H +
      (c.note ? " · comment " + c.note : "") + " · no answer " + c.none + ")");
    L.push("");
    ITEMS.forEach(function (it, i) {
      var a = (s.answers || {})[it.id] || {};
      var cm = (a.c || "").trim();
      var head = isNote(it)
        ? (cm ? "comment" : "no answer")
        : (a.v ? ANSWER_LABEL[a.v] + " (" + a.v + ")" : "no answer");
      L.push("Q" + (i + 1) + ". [" + it.sec + "] " + it.label + " — " + head);
      L.push("    Comment: " + (cm ? cm.replace(/\n/g, "\n             ") : "-"));
    });
    if ((s.overall || "").trim()) {
      L.push("");
      L.push("Overall comments:");
      L.push(s.overall.trim());
    }
    return L.join("\n");
  }

  function copyToClipboard(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return legacyCopy(txt); });
    }
    return Promise.resolve(legacyCopy(txt));
  }
  function legacyCopy(txt) {
    try {
      var ta = document.createElement("textarea");
      ta.value = txt; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function copyMine() {
    var missing = null;
    for (var i = 0; i < ITEMS.length; i++) {
      var a = state.answers[ITEMS[i].id] || {};
      if (a.v === "N" && !(a.c || "").trim()) { missing = ITEMS[i]; break; }
    }
    copyToClipboard(buildText()).then(function (ok) {
      if (!ok) { toast("Copy failed. Select the summary table and copy it manually."); return; }
      var c = counts();
      if (c.none > 0) toast("Copied — " + c.none + " item(s) still unanswered.");
      else if (missing) toast("Copied. Adding a reason to the 'No' items would help.");
      else toast("Reply copied.");
    });
    if (missing) {
      var host = document.getElementById("rv-" + missing.id);
      if (host) host.classList.add("needs-note");
    }
  }

  /* ---------------- all replies ---------------- */
  var lastAll = [];

  function reviewerName(r, idx) {
    return r.__mine ? "You" : "Reviewer " + (idx + 1);
  }

  function renderAll(list) {
    lastAll = (list || []).slice().sort(function (a, b) {
      return String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
    });
    var el = document.getElementById("allCount");
    if (el) el.textContent = lastAll.length ? (lastAll.length + " reviewer(s) replied.") : "No replies yet.";

    var agg = document.getElementById("aggBody");
    if (agg) {
      agg.innerHTML = ITEMS.map(function (it, i) {
        var y = 0, n = 0, h = 0, notes = 0;
        lastAll.forEach(function (r) {
          var a = (r.answers || {})[it.id] || {};
          if (isNote(it)) { if ((a.c || "").trim()) notes++; return; }
          if (a.v === "Y") y++; else if (a.v === "N") n++; else if (a.v === "H") h++;
        });
        if (isNote(it)) {
          return '<tr>' +
            '<td><span class="qn">Q' + (i + 1) + '</span> ' + esc(it.label) + '</td>' +
            '<td class="n dash">—</td><td class="n dash">—</td><td class="n dash">—</td>' +
            '<td><span class="a-note">' + notes + ' comment' + (notes === 1 ? "" : "s") + '</span></td>' +
          '</tr>';
        }
        var tot = y + n + h || 1;
        return '<tr>' +
          '<td><span class="qn">Q' + (i + 1) + '</span> ' + esc(it.label) + '</td>' +
          '<td class="n"><span class="a-y">' + y + '</span></td>' +
          '<td class="n"><span class="a-n">' + n + '</span></td>' +
          '<td class="n"><span class="a-h">' + h + '</span></td>' +
          '<td><span class="bar">' +
            '<i class="y" style="width:' + (y / tot * 100) + '%"></i>' +
            '<i class="n" style="width:' + (n / tot * 100) + '%"></i>' +
            '<i class="h" style="width:' + (h / tot * 100) + '%"></i>' +
          '</span></td>' +
        '</tr>';
      }).join("");
    }

    var people = document.getElementById("peopleCard");
    if (!people) return;
    if (!lastAll.length) { people.innerHTML = '<div class="empty-note">No replies yet.</div>'; return; }

    people.innerHTML = lastAll.map(function (r, idx) {
      var lines = ITEMS.map(function (it, i) {
        var a = (r.answers || {})[it.id] || {};
        var cm = (a.c || "").trim();
        if (!a.v && !cm) return "";
        var reply = isNote(it)
          ? '<span class="a-note">Comment</span>'
          : '<span class="' + (a.v ? ANSWER_CLASS[a.v] : "a-x") + '">' + (a.v ? ANSWER_LABEL[a.v] : "—") + '</span>';
        return '<div class="pline">' +
          '<span class="q">Q' + (i + 1) + '</span>' +
          '<span class="v">' + reply +
            (cm ? '<span class="c">' + esc(cm) + '</span>' : "") +
          '</span>' +
        '</div>';
      }).join("");
      var ov = (r.overall || "").trim();
      return '<div class="person">' +
        '<div class="person-head">' +
          '<b>' + esc(reviewerName(r, idx)) + '</b>' +
          '<span class="when">' + esc(B.stamp(r.updatedAt)) + '</span>' +
        '</div>' +
        '<div class="person-body">' + (lines || '<div class="pline"><span class="q">—</span><span class="v">No answers</span></div>') +
          (ov ? '<div class="pline"><span class="q">Overall</span><span class="v"><span class="c">' + esc(ov) + '</span></span></div>' : "") +
        '</div>' +
      '</div>';
    }).join("");
  }

  function loadAll() {
    if (!connected) { toast("Shared storage is off, so other replies are not available."); return; }
    var el = document.getElementById("allCount");
    if (el) el.textContent = "Loading…";
    B.listAll(DOC.id).then(renderAll, function (err) {
      if (el) el.textContent = "Could not load replies: " + err.message;
    });
  }

  function copyAll() {
    if (!lastAll.length) { toast("Nothing to copy yet."); return; }
    var L = ["[" + DOC.title + "] All replies (" + lastAll.length + " reviewers) · " + B.today(), ""];
    ITEMS.forEach(function (it, i) {
      var y = [], n = [], h = [], notes = [];
      lastAll.forEach(function (r, idx) {
        var a = (r.answers || {})[it.id] || {};
        var cm = (a.c || "").trim();
        var entry = "      - " + reviewerName(r, idx) + (cm ? ": " + cm.replace(/\n/g, " ") : "");
        if (isNote(it)) { if (cm) notes.push(entry); return; }
        if (a.v === "Y") y.push(entry); else if (a.v === "N") n.push(entry); else if (a.v === "H") h.push(entry);
      });
      if (isNote(it)) {
        L.push("Q" + (i + 1) + ". [" + it.sec + "] " + it.label + "  (" + notes.length + " comment" + (notes.length === 1 ? "" : "s") + ")");
        L = L.concat(notes.length ? notes : ["      - none"]);
        L.push("");
        return;
      }
      L.push("Q" + (i + 1) + ". [" + it.sec + "] " + it.label +
        "  (agree " + y.length + " · change " + n.length + " · hold " + h.length + ")");
      if (y.length) { L.push("   Agree"); L = L.concat(y); }
      if (n.length) { L.push("   Needs change"); L = L.concat(n); }
      if (h.length) { L.push("   Hold"); L = L.concat(h); }
      L.push("");
    });
    var ovs = lastAll.filter(function (r) { return (r.overall || "").trim(); });
    if (ovs.length) {
      L.push("Overall comments");
      ovs.forEach(function (r, idx) { L.push("   - " + reviewerName(r, idx) + ": " + r.overall.trim().replace(/\n/g, " ")); });
    }
    copyToClipboard(L.join("\n")).then(function (ok) {
      toast(ok ? "All replies copied." : "Copy failed.");
    });
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    var o = document.getElementById("rvOverall");
    o.value = state.overall;
    o.addEventListener("input", function () { state.overall = o.value; touch(); });

    document.getElementById("btnCopy").addEventListener("click", copyMine);
    document.getElementById("btnCopy2").addEventListener("click", copyMine);
    document.getElementById("btnCopyAll").addEventListener("click", copyAll);
    document.getElementById("btnRefresh").addEventListener("click", loadAll);

    document.getElementById("btnAll").addEventListener("click", function () {
      var sec = document.getElementById("allview");
      sec.hidden = false;
      sec.scrollIntoView({ block: "start" });
      loadAll();
    });

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
      if (!window.confirm("Clear everything you have entered on this page?")) return;
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

    if (!B.hasConfig) {
      setSync("off", "Local only");
      var note = document.getElementById("sendNote");
      if (note) note.textContent = "Shared storage is not configured, so this stays in your browser. Copy your reply and send it on.";
      document.getElementById("btnAll").disabled = true;
      return;
    }

    setSync("busy", "Connecting…");
    B.enter().then(function (room) {
      if (!room || !room.key) { setSync("off", "Local only"); return; }
      connected = true;
      var rn = document.getElementById("roomName");
      if (rn && room.label) rn.textContent = "· " + room.label;
      return B.loadMine(DOC.id).then(function (remote) {
        if (remote && remote.answers) {
          var remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          var localHasData = Object.keys(state.answers).length > 0 || state.overall;
          if (!localHasData || remoteTime >= (state.updatedAt || 0)) {
            state = { overall: remote.overall || "", answers: remote.answers || {}, updatedAt: remoteTime };
            saveLocal(); repaintAll();
          } else {
            pushRemote();
          }
        }
        setSync("on", "Shared");
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
