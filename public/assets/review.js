/* ==================================================================
   review.js — 검토 문서 페이지 엔진

   문서 페이지는 본문과 window.REVIEW_DOC 정의만 두면 되고,
   상단바 · 검토자 입력 · 회신 위젯 · 요약 · 전체 응답 화면은 여기서 만듭니다.

   window.REVIEW_DOC = {
     id:    "s04-purchase-progress-status",   // 저장 키 (변경 금지)
     code:  "MERP S04",
     title: "Purchase Progress Status Design",
     items: [ { id:"q1", sec:"01", label:"…", q:"…", hint:"…", variant:"inline" }, … ]
   }
   본문에는 <div data-review="q1"></div> 를 원하는 위치에 둡니다.
   ================================================================== */
(function () {
  "use strict";

  var DOC = window.REVIEW_DOC;
  if (!DOC) return;
  var B = window.Board;
  var ITEMS = DOC.items || [];
  var LSKEY = "board.doc." + DOC.id;
  var ANSWER_LABEL = { Y: "동의", N: "수정 필요", H: "보류" };
  var ANSWER_CLASS = { Y: "a-y", N: "a-n", H: "a-h" };

  var esc = B.esc, toast = B.toast;
  var state = loadLocal();
  var connected = false;
  var saveTimer = null, remoteTimer = null;

  /* ---------------- 로컬 저장 ---------------- */
  function blank() { return { name: "", team: "", overall: "", answers: {}, updatedAt: 0 }; }
  function loadLocal() {
    try {
      var v = JSON.parse(localStorage.getItem(LSKEY) || "null");
      if (!v || typeof v !== "object") return blank();
      return { name: v.name || "", team: v.team || "", overall: v.overall || "", answers: v.answers || {}, updatedAt: v.updatedAt || 0 };
    } catch (e) { return blank(); }
  }
  function saveLocal() {
    try { localStorage.setItem(LSKEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- 마운트: 상단바 ---------------- */
  function mountTopbar() {
    var host = document.getElementById("topbarMount");
    if (!host) return;
    host.outerHTML =
      '<div class="topbar">' +
        '<div class="topbar-in">' +
          '<div class="tb-id">' +
            '<b>' + esc(DOC.title) + '</b>' +
            '<span class="sub"><a href="../index.html">← 문서 목록</a><span id="roomName"></span></span>' +
          '</div>' +
          '<div class="tb-prog">' +
            '<div class="meter" role="progressbar" aria-label="응답 진행률" aria-valuemin="0" aria-valuemax="' + ITEMS.length + '" aria-valuenow="0" id="meter"><i id="meterFill"></i></div>' +
            '<div class="tb-count"><b id="cDone">0</b> / ' + ITEMS.length + ' 응답</div>' +
          '</div>' +
          '<div class="tb-actions">' +
            '<span class="sync off" id="syncBadge"><span class="dot"></span><span id="syncText">로컬 저장</span></span>' +
            '<button class="btn ghost" type="button" id="btnJump">미응답으로</button>' +
            '<button class="btn" type="button" id="btnAll">전체 응답</button>' +
            '<button class="btn primary" type="button" id="btnCopy">회신 복사</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 마운트: 검토자 입력 ---------------- */
  function mountReviewer() {
    var host = document.getElementById("reviewerMount");
    if (!host) return;
    host.outerHTML =
      '<div class="reviewer">' +
        '<div class="field"><label for="rvName">검토자 이름</label>' +
          '<input id="rvName" type="text" placeholder="예: 홍길동" autocomplete="name" /></div>' +
        '<div class="field"><label for="rvTeam">소속 / 역할</label>' +
          '<input id="rvTeam" type="text" placeholder="예: 구매팀 / 현업 담당" autocomplete="organization" /></div>' +
      '</div>';
  }

  /* ---------------- 마운트: 요약 + 전체 응답 ---------------- */
  function mountSummary() {
    var host = document.getElementById("summaryMount");
    if (!host) return;
    host.outerHTML =
      '<section class="section summary" id="summary">' +
        '<div class="sec-head"><div class="sec-num">회신</div><div>' +
          '<h2>내 회신 요약</h2><p>아래 내용이 그대로 저장·복사됩니다. 보내기 전에 확인해 주세요.</p>' +
        '</div></div>' +
        '<div class="tally">' +
          '<div><span class="k">동의 Y</span><span class="v yes" id="tYes">0</span></div>' +
          '<div><span class="k">수정 필요 N</span><span class="v no" id="tNo">0</span></div>' +
          '<div><span class="k">보류</span><span class="v hold" id="tHold">0</span></div>' +
          '<div><span class="k">미응답</span><span class="v" id="tNone">' + ITEMS.length + '</span></div>' +
        '</div>' +
        '<div class="card scroll-x"><table class="sumtbl">' +
          '<thead><tr><th>항목</th><th>회신</th><th>의견</th></tr></thead>' +
          '<tbody id="sumBody"></tbody>' +
        '</table></div>' +
        '<div class="field" style="margin-top:16px;">' +
          '<label for="rvOverall">총평 · 추가 논의 요청 (선택)</label>' +
          '<textarea id="rvOverall" rows="4" placeholder="문서 전체에 대한 의견이나, 회의에서 따로 다뤄야 할 주제를 적어주세요."></textarea>' +
        '</div>' +
        '<div class="send">' +
          '<p id="sendNote">회신은 공유 공간에 자동 저장됩니다.</p>' +
          '<button class="btn" type="button" id="btnReset">초기화</button>' +
          '<button class="btn primary" type="button" id="btnCopy2">회신 복사</button>' +
        '</div>' +
      '</section>' +
      '<section class="section allview" id="allview" hidden>' +
        '<div class="sec-head"><div class="sec-num">전체</div><div>' +
          '<h2>전체 응답</h2><p>같은 암호를 쓰는 사람들의 회신을 모두 모아 보여줍니다.</p>' +
        '</div></div>' +
        '<div class="allbar">' +
          '<p id="allCount">불러오는 중…</p>' +
          '<button class="btn" type="button" id="btnRefresh">새로고침</button>' +
          '<button class="btn" type="button" id="btnCopyAll">전체 취합본 복사</button>' +
        '</div>' +
        '<div class="card scroll-x"><table class="agg">' +
          '<thead><tr><th>항목</th><th>동의</th><th>수정</th><th>보류</th><th>분포</th></tr></thead>' +
          '<tbody id="aggBody"></tbody>' +
        '</table></div>' +
        '<div class="card" style="margin-top:14px;" id="peopleCard"><div class="empty-note">응답이 없습니다.</div></div>' +
      '</section>';
  }

  /* ---------------- 회신 위젯 ---------------- */
  function buildItems() {
    ITEMS.forEach(function (item, i) {
      var host = document.querySelector('[data-review="' + item.id + '"]');
      if (!host) return;
      var n = i + 1;
      var inline = (host.dataset.variant || item.variant) === "inline";
      host.className = "review" + (inline ? " inline" : "");
      host.id = "rv-" + item.id;

      host.innerHTML = inline
        ? '<div class="rv-mini">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            '<div class="choices" role="group" aria-label="' + esc(item.label) + ' 회신">' + choiceBtns() + '</div>' +
          '</div>' +
          '<textarea id="c-' + item.id + '" rows="2" aria-label="' + esc(item.label) + ' 의견" placeholder="의견을 적어주세요"></textarea>'
        : '<div class="rv-head">' +
            '<span class="rv-tag">Q' + n + '</span>' +
            '<div><div class="rv-q">' + esc(item.q) + (item.hint ? '<em>' + esc(item.hint) + '</em>' : '') + '</div></div>' +
          '</div>' +
          '<div class="rv-body">' +
            '<div class="choices" role="group" aria-label="' + esc(item.label) + ' 회신">' + choiceBtns() + '</div>' +
            '<div class="rv-comment">' +
              '<label for="c-' + item.id + '">의견</label>' +
              '<textarea id="c-' + item.id + '" rows="2" placeholder="의견을 적어주세요"></textarea>' +
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
    return '<button type="button" class="choice yes" data-v="Y" aria-pressed="false"><span class="mark"></span>동의 (Y)</button>' +
           '<button type="button" class="choice no" data-v="N" aria-pressed="false"><span class="mark"></span>수정 필요 (N)</button>' +
           '<button type="button" class="choice hold" data-v="H" aria-pressed="false"><span class="mark"></span>보류</button>';
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

  function paint(id) {
    var host = document.getElementById("rv-" + id);
    if (!host) return;
    var a = state.answers[id] || {};
    host.querySelectorAll(".choice").forEach(function (btn) {
      btn.setAttribute("aria-pressed", a.v === btn.dataset.v ? "true" : "false");
    });
    host.classList.toggle("answered", !!a.v);
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
    var n = document.getElementById("rvName"), t = document.getElementById("rvTeam"), o = document.getElementById("rvOverall");
    if (n) n.value = state.name;
    if (t) t.value = state.team;
    if (o) o.value = state.overall;
    refresh();
  }

  /* ---------------- 저장 ---------------- */
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
    setSync("busy", "저장 중…");
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(pushRemote, 1200);
  }

  function pushRemote() {
    if (!connected) return;
    B.saveMine(DOC.id, state).then(function () {
      setSync("on", "저장됨 · " + B.stamp(new Date().toISOString()).slice(11));
    }, function (err) {
      setSync("err", "저장 실패");
      console.warn("[board] save failed", err);
    });
  }

  /* ---------------- 진행률 · 요약 ---------------- */
  function counts(answers) {
    var src = answers || state.answers, c = { Y: 0, N: 0, H: 0, none: 0 };
    ITEMS.forEach(function (it) {
      var v = (src[it.id] || {}).v;
      if (v === "Y") c.Y++; else if (v === "N") c.N++; else if (v === "H") c.H++; else c.none++;
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

    var body = document.getElementById("sumBody");
    if (body) {
      body.innerHTML = ITEMS.map(function (it, i) {
        var a = state.answers[it.id] || {}, cm = (a.c || "").trim();
        return '<tr>' +
          '<td><span class="qn">Q' + (i + 1) + '</span> ' + esc(it.label) + '</td>' +
          '<td class="a"><span class="' + (a.v ? ANSWER_CLASS[a.v] : "a-x") + '">' + (a.v ? ANSWER_LABEL[a.v] : "미응답") + '</span></td>' +
          '<td class="c' + (cm ? "" : " empty") + '">' + (cm ? esc(cm) : "—") + '</td>' +
        '</tr>';
      }).join("");
    }
  }

  /* ---------------- 텍스트 회신본 ---------------- */
  function buildText(src) {
    var s = src || state;
    var c = counts(s.answers || {});
    var who = (s.name || "(이름 미기재)") + (s.team ? " / " + s.team : "");
    var L = [];
    L.push("[" + DOC.title + "] 검토 회신");
    L.push("검토자: " + who);
    L.push("회신일: " + B.today());
    L.push("응답: " + (ITEMS.length - c.none) + "/" + ITEMS.length +
      "  (동의 " + c.Y + " · 수정 필요 " + c.N + " · 보류 " + c.H + " · 미응답 " + c.none + ")");
    L.push("");
    ITEMS.forEach(function (it, i) {
      var a = (s.answers || {})[it.id] || {};
      L.push("Q" + (i + 1) + ". [" + it.sec + "] " + it.label + " — " + (a.v ? ANSWER_LABEL[a.v] + " (" + a.v + ")" : "미응답"));
      var cm = (a.c || "").trim();
      L.push("    의견: " + (cm ? cm.replace(/\n/g, "\n          ") : "-"));
    });
    if ((s.overall || "").trim()) {
      L.push("");
      L.push("총평 / 추가 논의 요청:");
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
      if (!ok) { toast("복사에 실패했습니다. 요약 표를 직접 선택해 복사해 주세요."); return; }
      var c = counts();
      if (c.none > 0) toast("복사했습니다. 미응답 " + c.none + "건이 포함되어 있습니다.");
      else if (missing) toast("복사했습니다. '수정 필요' 항목의 사유를 채워주시면 좋습니다.");
      else toast("회신 내용을 복사했습니다.");
    });
    if (missing) {
      var host = document.getElementById("rv-" + missing.id);
      if (host) host.classList.add("needs-note");
    }
  }

  /* ---------------- 전체 응답 ---------------- */
  var lastAll = [];

  function renderAll(list) {
    lastAll = list || [];
    var el = document.getElementById("allCount");
    if (el) el.textContent = lastAll.length ? (lastAll.length + "명이 회신했습니다.") : "아직 회신이 없습니다.";

    var agg = document.getElementById("aggBody");
    if (agg) {
      agg.innerHTML = ITEMS.map(function (it, i) {
        var y = 0, n = 0, h = 0;
        lastAll.forEach(function (r) {
          var v = ((r.answers || {})[it.id] || {}).v;
          if (v === "Y") y++; else if (v === "N") n++; else if (v === "H") h++;
        });
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
    if (!lastAll.length) { people.innerHTML = '<div class="empty-note">응답이 없습니다.</div>'; return; }

    people.innerHTML = lastAll.map(function (r) {
      var lines = ITEMS.map(function (it, i) {
        var a = (r.answers || {})[it.id] || {};
        if (!a.v && !(a.c || "").trim()) return "";
        var cm = (a.c || "").trim();
        return '<div class="pline">' +
          '<span class="q">Q' + (i + 1) + '</span>' +
          '<span class="v">' +
            '<span class="' + (a.v ? ANSWER_CLASS[a.v] : "a-x") + '">' + (a.v ? ANSWER_LABEL[a.v] : "미응답") + '</span>' +
            (cm ? '<span class="c">' + esc(cm) + '</span>' : "") +
          '</span>' +
        '</div>';
      }).join("");
      var ov = (r.overall || "").trim();
      return '<div class="person">' +
        '<div class="person-head">' +
          '<b>' + esc(r.name || "(이름 미기재)") + '</b>' +
          '<span>' + esc(r.team || "") + '</span>' +
          '<span class="when">' + esc(B.stamp(r.updatedAt)) + '</span>' +
        '</div>' +
        '<div class="person-body">' + (lines || '<div class="pline"><span class="q">—</span><span class="v">응답 없음</span></div>') +
          (ov ? '<div class="pline"><span class="q">총평</span><span class="v"><span class="c">' + esc(ov) + '</span></span></div>' : "") +
        '</div>' +
      '</div>';
    }).join("");
  }

  function loadAll() {
    if (!connected) { toast("공유 저장이 켜져 있지 않아 전체 응답을 볼 수 없습니다."); return; }
    var el = document.getElementById("allCount");
    if (el) el.textContent = "불러오는 중…";
    B.listAll(DOC.id).then(renderAll, function (err) {
      if (el) el.textContent = "불러오지 못했습니다: " + err.message;
    });
  }

  function copyAll() {
    if (!lastAll.length) { toast("복사할 응답이 없습니다."); return; }
    var L = ["[" + DOC.title + "] 전체 회신 취합 (" + lastAll.length + "명) · " + B.today(), ""];
    ITEMS.forEach(function (it, i) {
      var y = [], n = [], h = [];
      lastAll.forEach(function (r) {
        var a = (r.answers || {})[it.id] || {};
        var who = r.name || "(익명)";
        var cm = (a.c || "").trim();
        var entry = "      - " + who + (cm ? ": " + cm.replace(/\n/g, " ") : "");
        if (a.v === "Y") y.push(entry); else if (a.v === "N") n.push(entry); else if (a.v === "H") h.push(entry);
      });
      L.push("Q" + (i + 1) + ". [" + it.sec + "] " + it.label +
        "  (동의 " + y.length + " · 수정 " + n.length + " · 보류 " + h.length + ")");
      if (y.length) { L.push("   동의"); L = L.concat(y); }
      if (n.length) { L.push("   수정 필요"); L = L.concat(n); }
      if (h.length) { L.push("   보류"); L = L.concat(h); }
      L.push("");
    });
    var ovs = lastAll.filter(function (r) { return (r.overall || "").trim(); });
    if (ovs.length) {
      L.push("총평");
      ovs.forEach(function (r) { L.push("   - " + (r.name || "(익명)") + ": " + r.overall.trim().replace(/\n/g, " ")); });
    }
    copyToClipboard(L.join("\n")).then(function (ok) {
      toast(ok ? "전체 취합본을 복사했습니다." : "복사에 실패했습니다.");
    });
  }

  /* ---------------- 이벤트 배선 ---------------- */
  function wire() {
    var n = document.getElementById("rvName"), t = document.getElementById("rvTeam"), o = document.getElementById("rvOverall");
    n.value = state.name; t.value = state.team; o.value = state.overall;
    n.addEventListener("input", function () { state.name = n.value; B.ls(B.LS.name, n.value); touch(); });
    t.addEventListener("input", function () { state.team = t.value; B.ls(B.LS.team, t.value); touch(); });
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
        if (!(state.answers[ITEMS[i].id] || {}).v) { target = ITEMS[i]; break; }
      }
      if (!target) {
        document.getElementById("summary").scrollIntoView({ block: "start" });
        toast(ITEMS.length + "개 항목 모두 응답했습니다.");
        return;
      }
      var host = document.getElementById("rv-" + target.id);
      host.scrollIntoView({ block: "center" });
      var btn = host.querySelector(".choice");
      if (btn) btn.focus();
    });

    document.getElementById("btnReset").addEventListener("click", function () {
      if (!window.confirm("입력한 회신 내용을 모두 지웁니다. 계속할까요?")) return;
      state = blank();
      saveLocal();
      repaintAll();
      if (connected) pushRemote();
      toast("초기화했습니다.");
    });
  }

  /* ---------------- 시작 ---------------- */
  function start() {
    mountTopbar(); mountReviewer(); mountSummary();
    buildItems(); wire(); repaintAll();

    if (!state.name) {
      var savedName = B.ls(B.LS.name), savedTeam = B.ls(B.LS.team);
      if (savedName) { state.name = savedName; state.team = savedTeam || ""; repaintAll(); saveLocal(); }
    }

    if (!B.hasConfig) {
      setSync("off", "로컬 저장");
      var note = document.getElementById("sendNote");
      if (note) note.textContent = "공유 저장이 설정되지 않아 이 브라우저에만 저장됩니다. 회신을 복사해 담당자에게 보내주세요.";
      document.getElementById("btnAll").disabled = true;
      return;
    }

    setSync("busy", "연결 중…");
    B.enter().then(function (room) {
      if (!room || !room.key) { setSync("off", "로컬 저장"); return; }
      connected = true;
      var rn = document.getElementById("roomName");
      if (rn && room.label) rn.textContent = "· " + room.label;
      return B.loadMine(DOC.id).then(function (remote) {
        if (remote && remote.answers) {
          var remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          var localHasData = Object.keys(state.answers).length > 0 || state.name || state.overall;
          if (!localHasData || remoteTime >= (state.updatedAt || 0)) {
            state = {
              name: remote.name || "", team: remote.team || "",
              overall: remote.overall || "", answers: remote.answers || {},
              updatedAt: remoteTime
            };
            saveLocal(); repaintAll();
          } else {
            pushRemote();
          }
        }
        setSync("on", "공유 저장 켜짐");
      });
    }).catch(function (err) {
      console.warn("[board] connect failed", err);
      setSync("err", "연결 실패");
      toast("공유 저장에 연결하지 못했습니다. 입력값은 이 브라우저에 보관됩니다.");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
