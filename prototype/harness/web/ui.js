/* Zurvival Reborn — Playable Beta UI. Drives the real bundled engine (window.Zurvival) by clicking.
   All run-state lives in JS memory only — NO localStorage/sessionStorage (artifacts forbid them). */
(function () {
  "use strict";
  var Z = window.Zurvival;
  var C = window.CONTENT;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, props, kids) {
    var n = document.createElement(tag); props = props || {};
    for (var k in props) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k === "html") n.innerHTML = props[k];
      else if (k.slice(0, 2) === "on" && typeof props[k] === "function") n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (props[k] != null) n.setAttribute(k, props[k]);
    }
    kids = kids == null ? [] : (Array.isArray(kids) ? kids : [kids]);
    for (var i = 0; i < kids.length; i++) { var c = kids[i]; if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
    return n;
  }

  var G = { state: null, graph: null, seed: "rivermouth-demo", over: false, lastFocus: null };

  function metaFor(seed, difficulty, ironman) {
    var m = { seed: (seed && seed.trim()) || "rivermouth-demo", createdAt: new Date().toISOString() };
    if (difficulty && difficulty !== "survivor") m.difficulty = difficulty; // Survivor = identity (omit)
    if (ironman) m.ironman = true;
    return m;
  }
  function newRun(seed, difficulty, ironman) {
    var r = Z.startRun(metaFor(seed, difficulty, ironman),
      C.regions, C.nodes, C.npcs,
      Z.STORY_ARCS.map(function (a) { return a.id; }),
      C.encounters, C.signals, C.recipes, C.jobs, C.factions, C.weapons, C.projects, C.endings, C.stands);
    G.state = r.state; G.graph = r.graph; G.seed = (seed && seed.trim()) || "rivermouth-demo"; G.over = false;
    render();
  }
  // Resume path — rebuild the transient region graph from content (arg order per playCli).
  function rebuildGraph() {
    return Z.buildRegionGraph(C.regions, C.nodes, C.encounters, C.signals, C.recipes, C.jobs, C.factions, C.npcs, C.weapons, C.projects, C.endings, C.stands);
  }

  // Presentation-only reflow of the scene prose, delegated to the harness's shared layoutStory so the
  // browser and the terminal game format narration identically (one source of truth). scene.narration is
  // never mutated, so determinism/saves/parity are unaffected. layoutStory lifts the "(Day N … at Place.)"
  // locator to a leading dateline and breaks the body into short paragraphs.
  function renderStory(story, rawStory) {
    var layout = Z.layoutStory(String(rawStory || ""));
    if (layout.dateline) story.appendChild(el("div", { "class": "dateline" }, [layout.dateline]));
    layout.paragraphs.forEach(function (p) { story.appendChild(el("p", { text: p })); });
  }

  function render() {
    var scene = Z.sceneOf(G.state, G.graph);
    var R = Z.renderRegions(scene, G.state, G.graph);
    G.over = Z.isRunOver(G.state);

    $("#meta").textContent = R.header[0] || "";
    var md = Z.modeInfo(Z.difficultyOf(G.state));
    var iron = Z.isIronman(G.state) ? " · Ironman" : "";
    $("#mode").textContent = "Mode: " + md.label + iron + " — " + md.gloss;

    var pane = $("#pane"); pane.innerHTML = "";
    var status = el("div", { "class": "status", "aria-label": "Status" });
    R.status.forEach(function (s) { status.appendChild(el("div", { "class": "s", text: s })); });
    pane.appendChild(status);

    if (R.soundscape && R.soundscape.length) {
      var snd = el("div", { "class": "soundscape", "aria-label": "What you hear" });
      snd.appendChild(el("span", { "class": "sub", text: "What you hear" }));
      R.soundscape.forEach(function (s) { snd.appendChild(el("div", { text: s })); });
      pane.appendChild(snd);
    }

    var story = el("div", { "class": "story" });
    renderStory(story, R.story[0]);
    pane.appendChild(story);
    pane.appendChild(el("div", { "class": "prompt", text: (R.prompt[0] || "What do you do?") }));

    var cwrap = $("#choices"); cwrap.innerHTML = "";
    if (G.over) {
      cwrap.appendChild(el("div", { "class": "ended" }, [
        el("h2", { text: "The run is over." }),
        el("div", { "class": "hint", text: "This run has ended. Start a new one to play again." }),
        el("div", { "class": "row", style: "justify-content:center;margin-top:12px" },
          [el("button", { "class": "btn accent", text: "New run", onclick: openNewRun })])
      ]));
    } else if (!scene.choices.length) {
      cwrap.appendChild(el("div", { "class": "hint", text: "No choices available." }));
    } else {
      scene.choices.forEach(function (c, i) {
        var free = !(c.timeCost > 0);
        var cost = free ? "free" : c.timeCost + "h";
        var btn = el("button", {
          "class": "choice", "aria-label": (i + 1) + ". " + c.label + ", " + (free ? "free" : c.timeCost + " hours"),
          onclick: function () { choose(c); }
        }, [
          el("span", { "class": "num", "aria-hidden": "true", text: String(i + 1) }),
          el("span", { "class": "label", text: c.label }),
          el("span", { "class": "cost" + (free ? " free" : ""), "aria-hidden": "true", text: cost })
        ]);
        cwrap.appendChild(btn);
      });
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function choose(c) {
    if (G.over) return;
    try { G.state = Z.applyAction(G.state, c.action, G.graph).state; }
    catch (e) { console.error(e); toast("Could not take that action.", "err"); return; }
    render();
  }

  /* ---------- modal machinery ---------- */
  function openModal(title, fill) {
    closeModal();
    G.lastFocus = document.activeElement;
    var closeBtn = el("button", { "class": "btn ghost iconbtn", "aria-label": "Close", text: "✕", onclick: closeModal });
    var body = el("div", { "class": "body" });
    var modal = el("div", { "class": "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      [el("div", { "class": "head" }, [el("h2", { text: title }), closeBtn]), body]);
    var backdrop = el("div", { "class": "backdrop", onclick: function (e) { if (e.target === backdrop) closeModal(); } }, [modal]);
    fill(body);
    $("#modal-root").appendChild(backdrop);
    var f = modal.querySelector("input,select,textarea,button");
    (f || closeBtn).focus();
  }
  function closeModal() {
    var root = $("#modal-root");
    if (root.firstChild) { root.innerHTML = ""; if (G.lastFocus && G.lastFocus.focus) { try { G.lastFocus.focus(); } catch (e) {} } }
  }

  function openScreen(id, title) {
    var lines = Z.renderDepthScreen(id, G.state, G.graph);
    openModal(title, function (body) { body.appendChild(el("pre", { "class": "screen", text: lines.join("\n") })); });
  }

  function openNewRun() {
    openModal("New run", function (body) {
      var seedIn = el("input", { type: "text", value: G.seed || "rivermouth-demo", "aria-label": "Seed" });
      var sel = el("select", { "aria-label": "Difficulty" });
      Z.DIFFICULTY_MODES.forEach(function (m) {
        var o = el("option", { value: m.mode, text: m.label }); if (m.mode === "survivor") o.selected = true; sel.appendChild(o);
      });
      var gloss = el("div", { "class": "gloss" });
      function setGloss() { var m = Z.DIFFICULTY_MODES.filter(function (x) { return x.mode === sel.value; })[0]; gloss.textContent = m ? m.gloss : ""; }
      sel.addEventListener("change", setGloss); setGloss();
      var iron = el("input", { type: "checkbox", id: "ironck" });
      body.appendChild(el("div", { "class": "field" }, [el("label", { text: "Seed (same seed → same run)" }), seedIn]));
      body.appendChild(el("div", { "class": "field" }, [el("label", { text: "Difficulty" }), sel, gloss]));
      body.appendChild(el("div", { "class": "field" }, [el("div", { "class": "check" },
        [iron, el("label", { "for": "ironck", style: "margin:0", text: "Ironman — one save, no take-backs (full-client enforced)" })])]));
      body.appendChild(el("div", { "class": "row" }, [el("button", {
        "class": "btn accent", text: "Start run",
        onclick: function () { newRun(seedIn.value, sel.value, iron.checked); closeModal(); }
      })]));
    });
  }

  function openSave() {
    var text = ""; try { text = Z.saveGame(G.state); } catch (e) { text = ""; }
    openModal("Save", function (body) {
      var ta = el("textarea", { readonly: "readonly", "aria-label": "Save data" }); ta.value = text;
      var msg = el("div", { "class": "msg" });
      var dl = el("button", {
        "class": "btn accent", text: "Download .json",
        onclick: function () {
          var blob = new Blob([text], { type: "application/json" });
          var url = URL.createObjectURL(blob);
          var a = el("a", { href: url, download: "zurvival-" + (G.seed || "run") + ".json" });
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          msg.className = "msg ok"; msg.textContent = "Downloaded.";
        }
      });
      var cp = el("button", {
        "class": "btn", text: "Copy",
        onclick: function () {
          function done() { msg.className = "msg ok"; msg.textContent = "Copied to clipboard."; }
          function manual() { ta.focus(); ta.select(); msg.className = "msg"; msg.textContent = "Press Ctrl/Cmd+C to copy."; }
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
          else manual();
        }
      });
      body.appendChild(el("div", { "class": "hint", text: "Your progress lives only in this page — there is no autosave. Download or copy this to keep it." }));
      body.appendChild(el("div", { "class": "field", style: "margin-top:12px" }, [ta]));
      body.appendChild(el("div", { "class": "row" }, [dl, cp]));
      body.appendChild(msg);
    });
  }

  function openLoad() {
    openModal("Load", function (body) {
      var ta = el("textarea", { "aria-label": "Paste save data", placeholder: "Paste a saved run here…" });
      var fileInput = el("input", { type: "file", accept: ".json,application/json", style: "position:absolute;left:-9999px" });
      var msg = el("div", { "class": "msg" });
      function doLoad(txt) {
        try {
          var st = Z.loadGame(txt);
          G.state = st; G.graph = rebuildGraph(); G.over = Z.isRunOver(st);
          try { if (st && st.meta && st.meta.seed) G.seed = st.meta.seed; } catch (e) {}
          closeModal(); render();
        } catch (e) { msg.className = "msg err"; msg.textContent = "Could not load: " + (e && e.message ? e.message : e); }
      }
      fileInput.addEventListener("change", function () {
        var f = fileInput.files[0]; if (!f) return;
        var rd = new FileReader(); rd.onload = function () { doLoad(String(rd.result)); }; rd.readAsText(f);
      });
      var uploadLabel = el("label", { "class": "btn ghost" }, ["Upload file…", fileInput]);
      body.appendChild(el("div", { "class": "hint", text: "Load a run you downloaded or copied earlier." }));
      body.appendChild(el("div", { "class": "field", style: "margin-top:12px" }, [el("label", { text: "Paste save text" }), ta]));
      body.appendChild(el("div", { "class": "row" }, [el("button", { "class": "btn accent", text: "Load pasted", onclick: function () { doLoad(ta.value); } }), uploadLabel]));
      body.appendChild(msg);
    });
  }

  var toastTimer = null;
  function toast(text, kind) {
    var t = $("#toast"); if (!t) { t = el("div", { id: "toast" }); document.body.appendChild(t); }
    t.textContent = text; t.className = kind || ""; t.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.opacity = "0"; }, 2200);
  }

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    if ($("#modal-root").firstChild) { if (e.key === "Escape") closeModal(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key) && !G.over) {
      var scene = Z.sceneOf(G.state, G.graph); var c = scene.choices[Number(e.key) - 1];
      if (c) { e.preventDefault(); choose(c); } return;
    }
    var k = e.key.toLowerCase();
    var s = Z.screenForKey(k);
    if (s) { e.preventDefault(); openScreen(s.id, s.title); return; }
    if (k === "n") { e.preventDefault(); openNewRun(); }
  });

  /* ---------- chrome wiring + boot ---------- */
  function boot() {
    $("#btn-new").addEventListener("click", openNewRun);
    $("#btn-save").addEventListener("click", openSave);
    $("#btn-load").addEventListener("click", openLoad);
    $("#btn-contrast").addEventListener("click", function () {
      var h = document.documentElement; h.dataset.contrast = h.dataset.contrast === "high" ? "normal" : "high";
    });
    var scale = 1;
    $("#btn-text").addEventListener("click", function () {
      scale = scale >= 1.3 ? 1 : scale + 0.15;
      document.documentElement.style.setProperty("--scale", scale.toFixed(2));
    });
    var sc = $("#screens");
    Z.DEPTH_SCREENS.forEach(function (s) {
      sc.appendChild(el("button", { "class": "btn ghost screenbtn", title: s.summary, onclick: function () { openScreen(s.id, s.title); } },
        [el("span", { "class": "k", "aria-hidden": "true", text: s.key.toUpperCase() + " " }), s.title]));
    });
    newRun("rivermouth-demo", "survivor", false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.__ZURV_UI = { get G() { return G; }, render: render }; // test hook
})();
