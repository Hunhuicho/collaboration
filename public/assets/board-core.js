/* ==================================================================
   board-core.js — shared-passcode gate + Firestore storage (REST)

   · No Firebase SDK bundle. Plain REST calls, so there is no version to
     pin and nothing to build.
   · Identity comes from anonymous auth; access control comes from the
     shared passcode. The SHA-256 hash of the passcode IS the room path,
     so only people who know the passcode can reach that room's data.
   · With no config filled in, everything falls back to local-only mode.
   ================================================================== */
(function (global) {
  "use strict";

  var CFG = global.FIREBASE_CONFIG || {};
  var HAS_CFG = !!(CFG.apiKey && CFG.projectId);
  var LS = {
    pass: "board.pass",
    room: "board.room",
    label: "board.roomLabel",
    tok: "board.token"
  };

  /* ---------------- small helpers ---------------- */
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

  /* ---------------- passcode → room key ---------------- */
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

  /* ---------------- anonymous auth ---------------- */
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

  /* ---------------- Firestore value encoding ---------------- */
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

  /* ---------------- room ---------------- */
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

  /* ---------------- responses ---------------- */
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
          o.__mine = o.__id === token.uid;
          return o;
        });
      });
    });
  }

  /* ---------------- passcode gate ---------------- */
  function gateMarkup(title) {
    return '' +
      '<div class="gate-box">' +
        '<span class="code">Review Board</span>' +
        '<h1>' + esc(title || "Enter the shared passcode") + '</h1>' +
        '<p>Everyone using the same passcode sees the same documents and replies. Enter the passcode you were given.</p>' +
        '<div class="gate-msg" id="gateMsg" hidden></div>' +
        '<div class="field">' +
          '<label for="gatePass">Shared passcode</label>' +
          '<input id="gatePass" type="password" autocomplete="current-password" placeholder="e.g. merp-s04" />' +
        '</div>' +
        '<div class="field" id="gateLabelWrap" hidden>' +
          '<label for="gateLabel">Name this workspace</label>' +
          '<input id="gateLabel" type="text" placeholder="e.g. MERP S04 Procurement Review" maxlength="60" />' +
        '</div>' +
        '<div class="gate-actions">' +
          '<button class="btn primary lg" type="button" id="gateGo">Enter</button>' +
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
        if (!pass) { say("Enter a passcode."); input.focus(); return; }
        go.disabled = true;
        say("Checking…", "info");

        roomKeyFor(pass).then(function (key) {
          if (pendingKey && pendingKey === key && !labelWrap.hidden) {
            var label = labelInput.value.trim();
            if (!label) { say("Give the workspace a name."); labelInput.focus(); go.disabled = false; return; }
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
              say("This passcode is new. Name the workspace to create it — or check the passcode for a typo.", "info");
              return;
            }
            if (err.status === 403 || err.status === 401) { say("Access denied. Check the Firestore rules and that anonymous sign-in is enabled."); return; }
            say("Could not connect: " + err.message);
          });
        }).catch(function (err) {
          go.disabled = false;
          if (err && err.message === "insecure-context") say("This page works only over HTTPS.");
          else say("Something went wrong: " + (err && err.message ? err.message : err));
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

  /* Try the stored passcode first; fall back to the gate. */
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
