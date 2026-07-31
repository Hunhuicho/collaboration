/* ==================================================================
   nav.js — left rail listing every investigation

   Renders into <aside id="navMount"></aside>. Each row shows the date,
   the title and how far that investigation has got:

     Not started   nothing answered yet
     In progress   some items answered
     Complete      every item answered

   Progress comes from `board.progress.<docId>`, which review.js writes
   whenever an answer changes — so the rail and the document page can
   never disagree about what counts as answered.
   ================================================================== */
(function (global) {
  "use strict";

  var DOCS = global.BOARD_DOCS || [];
  var esc = (global.Board && global.Board.esc) || function (s) { return String(s == null ? "" : s); };

  /* Pages live at the root (index.html) or one level down (docs/*.html). */
  function base() {
    return /\/docs\//.test(location.pathname) ? "../" : "./";
  }

  function progressOf(doc) {
    var total = doc.items || 0, answered = 0, updated = 0;
    try {
      var raw = localStorage.getItem("board.progress." + doc.id);
      if (raw) {
        var v = JSON.parse(raw);
        answered = v.a || 0;
        total = v.t || total;
        updated = v.u || 0;
      }
    } catch (e) {}
    var state = answered === 0 ? "new" : (answered >= total ? "done" : "prog");
    return { answered: answered, total: total, updated: updated, state: state };
  }

  var STATE_LABEL = { new: "Not started", prog: "In progress", done: "Complete" };

  function shortDate(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function currentId() {
    var m = location.pathname.match(/([^/]+)\.html$/);
    if (!m) return null;
    for (var i = 0; i < DOCS.length; i++) {
      if (DOCS[i].href.indexOf(m[1] + ".html") !== -1) return DOCS[i].id;
    }
    return null;
  }

  function row(doc, cur) {
    var p = progressOf(doc);
    var pct = p.total ? Math.round(p.answered / p.total * 100) : 0;
    var when = p.updated ? "updated " + shortDate(p.updated) : "opened " + esc(doc.date || "");
    return '<a class="rail-item' + (doc.id === cur ? " is-current" : "") + '" href="' + base() + esc(doc.href) + '">' +
      '<span class="ri-top">' +
        '<span class="ri-code">' + esc(doc.code) + '</span>' +
        '<span class="ri-state ' + p.state + '">' + STATE_LABEL[p.state] + '</span>' +
      '</span>' +
      '<span class="ri-title">' + esc(doc.title) + '</span>' +
      '<span class="ri-bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="ri-foot">' +
        '<span class="ri-when">' + when + '</span>' +
        '<span class="ri-count">' + p.answered + '/' + p.total + '</span>' +
      '</span>' +
    '</a>';
  }

  function render() {
    var host = document.getElementById("navMount");
    if (!host) return;
    var cur = currentId();
    var done = 0, open = 0;
    DOCS.forEach(function (d) { progressOf(d).state === "done" ? done++ : open++; });

    host.className = "rail";
    host.innerHTML =
      '<div class="rail-head">' +
        '<a class="rail-home" href="' + base() + 'index.html">Investigations</a>' +
        '<span class="rail-sum">' + done + '/' + (done + open) + ' done</span>' +
      '</div>' +
      '<nav class="rail-list">' + DOCS.map(function (d) { return row(d, cur); }).join("") + '</nav>' +
      '<p class="rail-foot">Status is worked out from your own answers — an investigation counts as complete once every item has a value.</p>';
  }

  global.BoardNav = { refresh: render, progressOf: progressOf };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})(window);
