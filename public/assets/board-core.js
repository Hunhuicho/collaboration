/* ==================================================================
   board-core.js — 공유 암호 게이트 + Firestore(REST) 저장소

   · Firebase JS SDK를 쓰지 않고 REST API만 사용합니다(번들 없음, 버전 고정 불필요).
   · 신원은 익명 인증으로 만들고, 접근 통제는 "공유 암호"로 합니다.
     암호를 SHA-256 해시한 값이 곧 데이터가 저장되는 방 경로(roomKey)입니다.
     → 암호를 아는 사람만 그 방의 문서·응답을 읽고 쓸 수 있습니다.
   · 설정이 비어 있으면 로컬 저장 모드로 조용히 내려앉습니다.
   ================================================================== */
(function (global) {
  "use strict";

  var CFG = global.FIREBASE_CONFIG || {};
  var HAS_CFG = !!(CFG.apiKey && CFG.projectId);
  var LS = {
    pass: "board.pass",
    room: "board.room",
    label: "board.roomLabel",
    tok: "board.token",
    name: "board.name",
    team: "board.team"
  };

  /* ---------------- 작은 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function today() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function stamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 2800);
  }

  /* ---------------- 암호 → 방 키 ---------------- */
  function sha256hex(text) {
    if (!(global.crypto && global.crypto.subtle)) {
      return Promise.reject(new Error("insecure-context"));
    }
    var bytes = new TextEncoder().encode("merp-board:" + text);
    return global.crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
      var out = [], view = new Uint8Array(buf);
      for (var i = 0; i < view.length; i++) out.push(("0" + view[i].toString(16)).slice(-2));
      return out.join("");
    });
  }
  function roomKeyFor(pass) {
    return sha256hex(String(pass).trim()).then(function (hex) { return "r" + hex.slice(0, 40); });
  }

  /* ---------------- 익명 인증 ---------------- */
  var token = null; // {idToken, refreshToken, uid, exp}

  function loadToken() {
    try {
      var raw = ls(LS.tok);
      if (!raw) return null;
      var t = JSON.parse(raw);
      return t && t.idToken ? t : null;
    } catch (e) { return null; }
  }
  function storeToken(t) {
    token = t;
    ls(LS.tok, JSON.stringify(t));
  }
  function signInAnon() {
    return fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + encodeURIComponent(CFG.apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true })
    }).then(readJson).then(function (r) {
      storeToken({ idToken: r.idToken, refreshToken: r.refreshToken, uid: r.localId, exp: Date.now() + (Number(r.expiresIn || 3600) - 120) * 1000 });
      return token;
    });
  }
  function refreshToken(t) {
    var body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(t.refreshToken);
    return fetch("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(CFG.apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body
    }).then(readJson).then(function (r) {
      storeToken({ idToken: r.id_token, refreshToken: r.refresh_token, uid: r.user_id, exp: Date.now() + (Number(r.expires_in || 3600) - 120) * 1000 });
      return token;
    });
  }
  function auth() {
    if (token && token.exp > Date.now()) return Promise.resolve(token);
    var stored = token || loadToken();
    if (stored && stored.exp > Date.now()) { token = stored; return Promise.resolve(token); }
    if (stored && stored.refreshToken) {
      return refreshToken(stored).catch(function () { return signInAnon(); });
    }
    return signInAnon();
  }

  function readJson(res) {
    return res.text().then(function (txt) {
      var data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
      if (!res.ok) {
        var err = new Error((data && data.error && (data.error.message || data.error.status)) || ("HTTP " + res.status));
        err.status = res.status;
        err.detail = data;
        throw err;
      }
      return data;
    });
  }

  /* ---------------- Firestore 값 변환 ---------------- */
  function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    var fields = {};
    Object.keys(v).forEach(function (k) { fields[k] = toValue(v[k]); });
    return { mapValue: { fields: fields } };
  }
  function fromValue(v) {
    if (!v || typeof v !== "object") return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
    if ("mapValue" in v) return fromFields((v.mapValue && v.mapValue.fields) || {});
    return null;
  }
  function fromFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = fromValue(fields[k]); });
    return out;
  }
  function toFields(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) { out[k] = toValue(obj[k]); });
    return out;
  }

  function docBase() {
    return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(CFG.projectId) + "/databases/(default)/documents";
  }
  function req(path, opts) {
    opts = opts || {};
    return auth().then(function (t) {
      return fetch(docBase() + path, {
        method: opts.method || "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + t.idToken
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }).then(readJson);
    });
  }

  /* ---------------- 방(room) ---------------- */
  var room = { key: null, label: "", pass: "" };

  function metaPath(key) { return "/rooms/" + key + "/meta/room"; }

  function fetchRoom(key) {
    return req(metaPath(key)).then(function (d) { return fromFields(d.fields); });
  }
  function createRoom(key, label) {
    return req(metaPath(key) + "?currentDocument.exists=false", {
      method: "PATCH",
      body: { fields: toFields({ label: String(label || "").slice(0, 60), createdAt: new Date() }) }
    }).then(function (d) { return fromFields(d.fields); });
  }

  /* ---------------- 응답 문서 ---------------- */
  function responsesPath(docId) {
    return "/rooms/" + room.key + "/docs/" + encodeURIComponent(docId) + "/responses";
  }
  function myResponsePath(docId) {
    return responsesPath(docId) + "/" + token.uid;
  }

  function loadMine(docId) {
    return auth().then(function () {
      return req(myResponsePath(docId)).then(function (d) { return fromFields(d.fields); },
        function (err) { if (err.status === 404) return null; throw err; });
    });
  }
  function saveMine(docId, data) {
    var payload = {
      name: String(data.name || "").slice(0, 60),
      team: String(data.team || "").slice(0, 60),
      answers: data.answers || {},
      overall: String(data.overall || "").slice(0, 4000),
      updatedAt: new Date()
    };
    return auth().then(function () {
      return req(myResponsePath(docId), { method: "PATCH", body: { fields: toFields(payload) } });
    });
  }
  function listAll(docId) {
    return auth().then(function () {
      return req(responsesPath(docId) + "?pageSize=300").then(function (d) {
        return ((d && d.documents) || []).map(function (doc) {
          var o = fromFields(doc.fields);
          o.__id = doc.name.split("/").pop();
          return o;
        });
      });
    });
  }

  /* ---------------- 게이트 UI ---------------- */
  function gateMarkup(title) {
    return '' +
      '<div class="gate-box">' +
        '<span class="code">업무 검토 보드</span>' +
        '<h1>' + esc(title || "공유 암호를 입력하세요") + '</h1>' +
        '<p>같은 암호를 쓰는 사람끼리 문서와 회신을 공유합니다. 담당자에게 받은 암호를 넣어주세요.</p>' +
        '<div class="gate-msg" id="gateMsg" hidden></div>' +
        '<div class="field">' +
          '<label for="gatePass">공유 암호</label>' +
          '<input id="gatePass" type="password" autocomplete="current-password" placeholder="예: merp-s04" />' +
        '</div>' +
        '<div class="field" id="gateLabelWrap" hidden>' +
          '<label for="gateLabel">새 공간 이름</label>' +
          '<input id="gateLabel" type="text" placeholder="예: MERP S04 구매 검토" maxlength="60" />' +
        '</div>' +
        '<div class="gate-actions">' +
          '<button class="btn primary lg" type="button" id="gateGo">들어가기</button>' +
        '</div>' +
      '</div>';
  }

  function openGate(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var el = document.createElement("div");
      el.className = "gate";
      el.innerHTML = gateMarkup(opts.title);
      document.body.appendChild(el);

      var input = el.querySelector("#gatePass");
      var labelWrap = el.querySelector("#gateLabelWrap");
      var labelInput = el.querySelector("#gateLabel");
      var msg = el.querySelector("#gateMsg");
      var go = el.querySelector("#gateGo");
      var pendingKey = null;

      function say(text, kind) {
        msg.textContent = text;
        msg.className = "gate-msg" + (kind === "info" ? " info" : "");
        msg.hidden = !text;
      }

      function submit() {
        var pass = input.value.trim();
        if (!pass) { say("암호를 입력해 주세요."); input.focus(); return; }
        go.disabled = true;
        say("확인 중…", "info");

        roomKeyFor(pass).then(function (key) {
          if (pendingKey && pendingKey === key && !labelWrap.hidden) {
            var label = labelInput.value.trim();
            if (!label) { say("새 공간 이름을 입력해 주세요."); labelInput.focus(); go.disabled = false; return; }
            return createRoom(key, label).then(function (meta) { finish(pass, key, meta.label); });
          }
          return fetchRoom(key).then(function (meta) {
            finish(pass, key, meta && meta.label);
          }, function (err) {
            go.disabled = false;
            if (err.status === 404) {
              pendingKey = key;
              labelWrap.hidden = false;
              labelInput.focus();
              say("처음 쓰는 암호입니다. 이 암호로 새 공간을 만들려면 이름을 정해주세요. (오타라면 암호를 다시 확인하세요.)", "info");
              return;
            }
            if (err.status === 403 || err.status === 401) { say("접근이 거부되었습니다. Firestore 규칙과 익명 로그인 설정을 확인해 주세요."); return; }
            say("연결에 실패했습니다: " + err.message);
          });
        }).catch(function (err) {
          go.disabled = false;
          if (err && err.message === "insecure-context") say("HTTPS 주소에서만 사용할 수 있습니다.");
          else say("오류가 발생했습니다: " + (err && err.message ? err.message : err));
        });
      }

      function finish(pass, key, label) {
        room.pass = pass; room.key = key; room.label = label || "";
        ls(LS.pass, pass); ls(LS.room, key); ls(LS.label, room.label);
        el.remove();
        resolve(room);
      }

      go.addEventListener("click", submit);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      labelInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      setTimeout(function () { input.focus(); }, 30);
    });
  }

  /* 저장된 암호로 조용히 입장 시도 → 실패하면 게이트 표시 */
  function enter() {
    if (!HAS_CFG) return Promise.resolve(null);
    var pass = ls(LS.pass);
    if (!pass) return openGate();
    return roomKeyFor(pass).then(function (key) {
      return fetchRoom(key).then(function (meta) {
        room.pass = pass; room.key = key; room.label = (meta && meta.label) || ls(LS.label) || "";
        return room;
      }, function () {
        ls(LS.pass, null);
        return openGate();
      });
    }, function () { return openGate(); });
  }

  function leave() {
    ls(LS.pass, null); ls(LS.room, null); ls(LS.label, null); ls(LS.tok, null);
    token = null; room = { key: null, label: "", pass: "" };
  }

  global.Board = {
    hasConfig: HAS_CFG,
    room: room,
    enter: enter,
    leave: leave,
    openGate: openGate,
    loadMine: loadMine,
    saveMine: saveMine,
    listAll: listAll,
    uid: function () { return token && token.uid; },
    esc: esc,
    ls: ls,
    LS: LS,
    toast: toast,
    today: today,
    stamp: stamp
  };
})(window);
