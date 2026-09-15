/* Zurvival Reborn — Playable Beta UI. Drives the real bundled engine (window.Zurvival) by clicking.
   Run state lives in JS memory only — NO localStorage/sessionStorage for the run. The six reader settings
   (T63) are the one exception, see `loadSettings`.

   T63 · NFR-ACC-01..04 — the accessibility model, verified with a real screen reader (Orca 46 over AT-SPI in
   Chromium; transcripts in docs/qa/at/). In one paragraph: the page has landmarks and a heading outline; a
   turn moves focus to the new scene's heading and ONE polite announcer speaks an ordered digest of the turn;
   choices are a real ordered list of buttons whose names carry their cost in words; dialogs are named,
   modal (the page behind is `inert`), trap Tab, close on Escape and hand focus back to something that still
   exists; depth screens render as headings and lists, not a <pre>; single-key shortcuts can be switched off
   (WCAG 2.1.4); text scales to 200%; contrast, reading font and spacing are reader settings; motion follows
   the OS; the pinned bars never cover what has focus. No hue carries a fact on its own — every coloured edge, tint
   or word sits beside words that say the same thing. */
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
      else if (k.slice(0, 2) === "on" && typeof props[k] === "function") n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (props[k] != null && props[k] !== false) n.setAttribute(k, props[k] === true ? "" : props[k]);
    }
    kids = kids == null ? [] : (Array.isArray(kids) ? kids : [kids]);
    for (var i = 0; i < kids.length; i++) { var c = kids[i]; if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
    return n;
  }

  // `spoken` is the condition/sound baseline of the last digest a screen reader actually RECEIVED — see announceTurn.
  var G = { state: null, graph: null, seed: "rivermouth-demo", over: false, lastFocus: null, spoken: null };

  /* ---------- reader settings (T63 · NFR-ACC-03 · ACCESSIBILITY §13.6 "settings … persist") ---------- */
  // The run is never stored. The reader settings are: a low-vision player should not have to re-enlarge the text
  // on every visit. Every access is guarded — a browser that refuses storage just gets the defaults back.
  var SETTINGS_KEY = "zurvival.reader-settings.v1";
  var TEXT_SIZES = [1, 1.25, 1.5, 1.75, 2];
  var DEFAULTS = { scale: 1, contrast: "auto", font: "serif", spacing: "normal", announce: "full", shortcuts: "on" };
  var CHOICES = {
    scale: TEXT_SIZES.map(String),
    contrast: ["auto", "normal", "high"],
    font: ["serif", "sans"],
    spacing: ["normal", "wide"],
    announce: ["full", "changes", "off"],
    shortcuts: ["on", "off"],
  };
  function sanitize(raw) {
    var s = {};
    for (var k in DEFAULTS) {
      var v = raw && Object.prototype.hasOwnProperty.call(raw, k) ? String(raw[k]) : String(DEFAULTS[k]);
      s[k] = CHOICES[k].indexOf(v) >= 0 ? v : String(DEFAULTS[k]);
    }
    s.scale = Number(s.scale);
    return s;
  }
  function loadSettings() {
    try { return sanitize(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "null")); } catch (e) { return sanitize(null); }
  }
  function saveSettings() { try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch (e) { /* storage refused */ } }
  var S = loadSettings();

  function prefersHighContrast() {
    try { return window.matchMedia("(prefers-contrast: more)").matches; } catch (e) { return false; }
  }
  function applySettings() {
    var h = document.documentElement;
    h.style.setProperty("--scale", String(S.scale));
    h.dataset.contrast = S.contrast === "high" || (S.contrast === "auto" && prefersHighContrast()) ? "high" : "normal";
    h.dataset.font = S.font;
    h.dataset.spacing = S.spacing;
    if ($("#topbar")) layoutBars();
  }

  /* ---------- run lifecycle ---------- */
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
    G.state = r.state; G.graph = r.graph; G.seed = (seed && seed.trim()) || "rivermouth-demo"; G.over = false; G.spoken = null;
  }
  // Resume path — rebuild the transient region graph from content (arg order per playCli).
  function rebuildGraph() {
    return Z.buildRegionGraph(C.regions, C.nodes, C.encounters, C.signals, C.recipes, C.jobs, C.factions, C.npcs, C.weapons, C.projects, C.endings, C.stands);
  }

  /* ---------- words ---------- */
  function hoursWords(h) { return h === 1 ? "1 hour" : h + " hours"; }
  /** "(Day 1, dawn 08:00 — at Corner Store.)" → "Day 1, dawn 08:00 — at Corner Store". */
  function sceneTitleFrom(dateline, header) {
    if (dateline) return String(dateline).replace(/^\(\s*/, "").replace(/\.?\s*\)$/, "");
    return String(header || "").split(" · ").slice(0, 2).join(", ") || "The scene";
  }
  /** Lines in `now` that `before` does not have (as a multiset), in `now`'s order. */
  function newLines(now, before) {
    if (!before) return now.slice();
    var seen = {};
    before.forEach(function (l) { seen[l] = (seen[l] || 0) + 1; });
    return now.filter(function (l) { if (seen[l] > 0) { seen[l] -= 1; return false; } return true; });
  }

  /**
   * Focus a heading (or any static element) without leaving it permanently focusable. A lasting tabindex="-1"
   * made Chromium expose a click action on it, and Orca read every such heading as "… heading level 2
   * clickable" whenever the browse cursor passed it; the attribute now lives only while the element has focus.
   */
  function focusStatic(n) {
    if (!n) return;
    n.setAttribute("tabindex", "-1");
    n.addEventListener("blur", function drop() { n.removeAttribute("tabindex"); n.removeEventListener("blur", drop); });
    n.focus({ preventScroll: true });
  }

  /* ---------- the one announcer (T63) ---------- */
  // A digest is written 250 ms after focus moves, so a screen reader queues it AFTER the heading instead of cutting
  // it off. That delay is a window in which the digest can be lost — a second turn, or a dialog opening (a modal
  // makes the announcer inert). So the pending digest is kept: a newer turn REPLACES it with one computed from the
  // last baseline actually spoken (nothing that changed in between goes unsaid), and a dialog DEFERS it until it
  // closes.
  var announceTimer = null;
  var pending = null; // { text, baseline }
  function flushAnnouncement() {
    if (announceTimer !== null) { clearTimeout(announceTimer); announceTimer = null; }
    if (!pending) return;
    var a = $("#announcer");
    a.textContent = "";               // cleared first, so an identical digest two turns running is still spoken
    var p = pending;                  // stays pending until it is really written: a dialog opening in the delay keeps it
    announceTimer = setTimeout(function () {
      announceTimer = null;
      if (pending !== p) return;
      a.textContent = p.text; G.spoken = p.baseline; pending = null;
    }, 250);
  }
  /**
   * The turn digest, in reading order: what is new about you and what is no longer so, what you now hear, the story,
   * and how many choices. "changes" drops the story (but never the ending's); "off" says nothing — the page is
   * still all there to read. With nothing spoken yet this run, the condition and the sounds are read in full.
   */
  function announceTurn(R, layout, choiceCount) {
    var status = R.status.slice(), sound = (R.soundscape || []).slice();
    var baseline = { status: status, soundscape: sound };
    if (S.announce === "off") { pending = null; clearTimeout(announceTimer); announceTimer = null; G.spoken = baseline; return; }
    var base = G.spoken;
    var parts = [];
    var added = base ? newLines(status, base.status) : status;
    var gone = base ? newLines(base.status, status) : [];
    var heard = base ? newLines(sound, base.soundscape) : sound;
    if (added.length) parts.push(added.join(" "));
    if (gone.length) parts.push("No longer: " + gone.join(" "));
    if (heard.length) parts.push("You hear: " + heard.join(" "));
    if (S.announce === "full" || !base || G.over) parts.push(layout.paragraphs.join(" "));
    if (G.over) parts.push("The run is over. Start a new run to play again.");
    else parts.push(choiceCount === 1 ? "1 choice." : choiceCount + " choices.");
    pending = { text: parts.filter(Boolean).join(" "), baseline: baseline };
    if (!isModalOpen()) flushAnnouncement();
  }

  /* ---------- render ---------- */
  function render(opts) {
    opts = opts || {};
    clearToast();
    var scene = Z.sceneOf(G.state, G.graph);
    var R = Z.renderRegions(scene, G.state, G.graph);
    G.over = Z.isRunOver(G.state);
    var layout = Z.layoutStory(String(R.story[0] || ""));
    var title = sceneTitleFrom(layout.dateline, R.header[0]);

    $("#meta").textContent = R.header[0] || "";
    var md = Z.modeInfo(Z.difficultyOf(G.state));
    $("#mode").textContent = "Mode: " + md.label + (Z.isIronman(G.state) ? " · Ironman" : "") + " — " + md.gloss;
    document.title = title + " — Zurvival Reborn";

    var sc = $("#scene"); sc.textContent = "";
    sc.appendChild(el("h2", { "class": "scene-title", id: "scene-title", text: title }));
    sc.appendChild(el("h3", { "class": "sr-only", text: "Your condition" }));
    var status = el("ul", { "class": "status" });
    R.status.forEach(function (s) { status.appendChild(el("li", { text: s })); });
    sc.appendChild(status);
    if (R.soundscape && R.soundscape.length) {
      var snd = el("div", { "class": "soundscape" });
      snd.appendChild(el("h3", { "class": "band-title", text: "What you hear" }));
      var ul = el("ul");
      R.soundscape.forEach(function (s) { ul.appendChild(el("li", { text: s })); });
      snd.appendChild(ul);
      sc.appendChild(snd);
    }
    sc.appendChild(el("h3", { "class": "sr-only", text: "The story" }));
    var story = el("div", { "class": "story" });
    (layout.paragraphs.length ? layout.paragraphs : [String(R.story[0] || "")]).forEach(function (p) { story.appendChild(el("p", { text: p })); });
    sc.appendChild(story);

    var cw = $("#choices-wrap"); cw.textContent = "";
    var focusTarget = null;
    if (G.over) {
      var endH = el("h2", { id: "choices-title", text: "The run is over." });
      cw.appendChild(el("div", { "class": "ended" }, [
        endH,
        el("p", { "class": "hint", text: "This run has ended. Start a new one to play again." }),
        el("div", { "class": "row", style: "justify-content:center;margin-top:12px" },
          [el("button", { type: "button", "class": "btn accent", text: "New run", onclick: openNewRun })])
      ]));
      focusTarget = endH;
    } else {
      cw.appendChild(el("h2", { "class": "prompt", id: "choices-title", text: (R.prompt[0] || "What do you do?") }));
      if (!scene.choices.length) {
        cw.appendChild(el("p", { "class": "empty", text: "No choices available." }));
      } else {
        var ol = el("ol", { id: "choices" });
        scene.choices.forEach(function (c, i) {
          var free = !(c.timeCost > 0);
          var n = i + 1;
          // The digit and the "2h" chip are visual shorthand, hidden from the accessibility tree because the list
          // position and the spelled cost in the name already say them.
          ol.appendChild(el("li", null, [el("button", {
            type: "button", "class": "choice", "data-choice": String(n),
            // The name is the label then the cost spelled out. It has to be an aria-label: any child element carrying
            // the spelled cost — a sibling flex item, or a visually-hidden span inside the label — is laid out as a
            // block and Chromium puts a space before its comma ("Travel to Corner Store , 2 hours", spoken by Orca).
            // The visible label is the start of the name, so speech input can still say it (WCAG 2.5.3).
            "aria-label": c.label + ", " + (free ? "free" : hoursWords(c.timeCost)),
            "aria-keyshortcuts": S.shortcuts === "on" && n <= 9 ? String(n) : null,
            onclick: function () { choose(c); }
          }, [
            el("span", { "class": "num", "aria-hidden": "true", text: String(n) }),
            el("span", { "class": "label", text: c.label }),
            el("span", { "class": "cost" + (free ? " free" : ""), "aria-hidden": "true", text: free ? "free" : c.timeCost + "h" })
          ])]));
        });
        cw.appendChild(ol);
      }
    }
    if (opts.turn) {
      // After a choice the button you pressed no longer exists; put focus somewhere meaningful rather than on
      // <body> — the new scene's heading (or, when the run has ended, the ending's).
      focusStatic(G.over ? focusTarget : $("#scene-title"));
      window.scrollTo(0, 0);
    }
    if (opts.turn || opts.announce) announceTurn(R, layout, scene.choices.length);
    syncShortcutHints();
  }

  function choose(c) {
    if (G.over || isModalOpen()) return;
    try { G.state = Z.applyAction(G.state, c.action, G.graph).state; }
    catch (e) { console.error(e); toast("Error: could not take that action.", "err"); return; }
    render({ turn: true });
  }

  /* ---------- dialogs ---------- */
  var dialogSeq = 0;
  /**
   * The dialog's Tab stops, in order. A radio group is ONE stop — its checked radio (or its first, if none is) —
   * because that is how the browser tabs; counting every radio made the last "stop" an unchecked radio the
   * browser never lands on, so Tab from the real last stop walked out of the Settings dialog (caught by
   * web/a11y-check.mjs).
   */
  function focusables(root) {
    var seenGroup = {};
    return Array.prototype.filter.call(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (n) {
        if (n.disabled || n.hidden || n.offsetParent === null) return false;
        if (n.type === "radio" && n.name) {
          if (seenGroup[n.name]) return false;
          var group = root.querySelectorAll('input[type=radio][name="' + n.name + '"]');
          var checked = Array.prototype.filter.call(group, function (r) { return r.checked; })[0];
          if (checked ? n !== checked : n !== group[0]) return false;
          seenGroup[n.name] = true;
        }
        return true;
      });
  }
  /**
   * A modal dialog, built on the native <dialog> + showModal() (T63). The first T63 build used a div with
   * role="dialog" and made #app inert by hand; verified with Orca, that was not enough — the reader's browse
   * cursor walked out of the dialog onto the skip links (which sit outside #app), Tab followed it, Escape then
   * did nothing, and the dialog's role was never announced because the backdrop's click handler made its
   * contents "clickable". showModal() puts the dialog in the top layer and makes EVERYTHING else inert. The
   * dialog is named by its heading, described by an optional summary; Escape (the native `cancel`) closes;
   * Tab cycles inside. `focusHeading` is for read-only dialogs — a screen reader starts at the title.
   */
  function openModal(title, fill, o) {
    o = o || {};
    closeModal(true);
    // Empty the page's live regions first. showModal() makes them inert, and Chromium re-exposes an inert live
    // region's CONTENT when the dialog closes — verified with Orca: closing Settings re-read the last turn's whole
    // digest aloud, as if a turn had happened. A digest still waiting to be spoken is NOT dropped: `pending` keeps
    // it and closeModal speaks it. (A toast is dropped: whatever it said, the dialog is now what the player acts on.)
    if (announceTimer !== null) { clearTimeout(announceTimer); announceTimer = null; }
    $("#announcer").textContent = "";
    clearTimeout(toastTimer); $("#toast").textContent = ""; $("#toast").className = "";
    G.lastFocus = document.activeElement;
    var id = "dlg-" + (++dialogSeq);
    var h = el("h2", { id: id + "-t", text: title });
    var closeBtn = el("button", { type: "button", "class": "btn ghost", text: "Close", onclick: function () { closeModal(); } });
    var body = el("div", { "class": "body" });
    var sheet = el("div", { "class": "sheet" }, [el("div", { "class": "head" }, [closeBtn, h]), body]);
    var dlg = el("dialog", { "class": "modal", "aria-labelledby": id + "-t" }, [sheet]);
    if (o.summary) {
      body.appendChild(el("p", { "class": "summary", id: id + "-d", text: o.summary }));
      dlg.setAttribute("aria-describedby", id + "-d");
    }
    fill(body);
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeModal(); });
    dlg.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = focusables(dlg); if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === h)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $("#modal-root").appendChild(dlg);
    var firstStop = dlg.querySelector("input,select,textarea") || closeBtn;
    firstStop.setAttribute("autofocus", "");
    dlg.showModal();
    // Where focus lands, verified with Orca. On the dialog's heading (tabindex -1) the FIRST dialog a page opened
    // was announced and every later one opened in silence: Chromium moves the text caret into the heading before it
    // fires focus, Orca takes the caret event as the new locus, and then drops the focus event as "existing locus of
    // focus". A real control has no text caret, so the first field — or, for a read-only dialog, the Close button —
    // is announced every time, with the dialog's name and description spoken as its context.
    if (document.activeElement !== firstStop) firstStop.focus();
  }
  function isModalOpen() { return !!$("#modal-root").firstChild; }
  // A click on the ::backdrop targets the <dialog> itself (the sheet fills it, so no click inside does). Listened
  // for on the document, not the dialog: Chromium reports every descendant of an element with a click listener
  // as "clickable", and Orca then read the dialog's heading as "Inventory heading level 2 clickable". The press
  // must START on the backdrop too — selecting text in the Save box and releasing outside it is not a close.
  var pressedOnBackdrop = false;
  document.addEventListener("mousedown", function (e) { var d = $("#modal-root").firstChild; pressedOnBackdrop = !!d && e.target === d; });
  document.addEventListener("click", function (e) {
    var d = $("#modal-root").firstChild;
    if (d && e.target === d && pressedOnBackdrop) closeModal();
    pressedOnBackdrop = false;
  });
  /**
   * Close the dialog. `replaced` is for a dialog whose action re-renders the page (Start run, Load): the node is
   * removed WITHOUT dialog.close(), because close() hands focus back to the opener first and a screen reader then
   * says "New run button" before the new scene; the render that follows places focus itself.
   */
  function closeModal(replaced) {
    var root = $("#modal-root");
    var dlg = root.firstChild;
    if (!dlg) return;
    if (!replaced) { try { if (dlg.open) dlg.close(); } catch (e) {} }
    root.textContent = "";
    if (replaced) return;
    // Give focus back to what opened the dialog. A heading focused by focusStatic lost its tabindex when the dialog
    // took focus, and focus() on it then does NOTHING, silently — so check that focus really arrived, re-arm a
    // static element, and fall back to the scene heading.
    var back = G.lastFocus;
    if (back && back.isConnected && back !== document.body) {
      try { back.focus(); } catch (e) {}
      if (document.activeElement !== back && /^H[1-6]$/.test(back.tagName)) focusStatic(back);
    }
    if (!back || document.activeElement !== back) focusStatic($("#scene-title"));
    flushAnnouncement();
  }

  /** A row's words, with ✗ / † kept visible but hidden from AT — the words beside them already say "locked" / "did not make it". */
  function appendMarked(parent, line) {
    if (line.mark === "✗" || line.mark === "†") parent.appendChild(el("span", { "aria-hidden": "true", text: line.mark + " " }));
    parent.appendChild(document.createTextNode(line.text));
  }

  /** Render a depth screen as a heading outline with real lists (T63) — `outlineScreen` recovers the structure. */
  function openScreen(id) {
    var screen = Z.screenById(id);
    var lines = Z.renderDepthScreen(id, G.state, G.graph);
    var o = Z.outlineScreen(lines, screen);
    openModal(screen.title, function (body) {
      var wrap = el("div", { "class": "screen" });
      o.blocks.forEach(function (b) {
        if (b.kind === "gap") return;
        if (b.kind === "heading") { wrap.appendChild(el("h3", { text: b.text })); return; }
        if (b.kind === "text") { wrap.appendChild(el("p", { text: b.text })); return; }
        var ul = el("ul");
        b.items.forEach(function (it) {
          var li = el("li", { "class": it.mark === "" ? "plain" : null });
          // ✗ and † are glyphs beside words that already say "locked" / "did not make it" — hidden from AT.
          appendMarked(li, it);
          it.more.forEach(function (m) { var sp = el("span", { "class": "more" }); appendMarked(sp, m); li.appendChild(sp); });
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      });
      body.appendChild(wrap);
      body.appendChild(el("p", { "class": "hint", text: "Press Escape or Close to return to the story. Opening a screen spends no time." }));
    }, { summary: o.summary, focusHeading: true });
  }

  function radioGroup(name, legend, options, current, onPick, gloss) {
    var lid = "set-" + name + "-legend";
    var fs = el("fieldset", { "class": "field" }, [el("legend", { id: lid, text: legend })]);
    var box = el("div", { "class": "opts" });
    options.forEach(function (op) {
      var id = "set-" + name + "-" + String(op.value).replace(/\W/g, "");
      var input = el("input", { type: "radio", name: name, id: id, value: String(op.value), checked: String(op.value) === String(current) });
      input.addEventListener("change", function () { if (input.checked) onPick(op.value); });
      box.appendChild(el("label", { "class": "opt", "for": id }, [input, op.label]));
    });
    fs.appendChild(box);
    if (gloss) fs.appendChild(el("p", { "class": "gloss", text: gloss }));
    return fs;
  }

  function openSettings() {
    openModal("Settings", function (body) {
      function set(k, v) { S[k] = k === "scale" ? Number(v) : v; applySettings(); saveSettings(); if (k === "shortcuts") render(); }
      body.appendChild(radioGroup("scale", "Text size", TEXT_SIZES.map(function (v) { return { value: v, label: Math.round(v * 100) + "%" }; }), S.scale, function (v) { set("scale", v); }));
      body.appendChild(radioGroup("contrast", "Contrast", [
        { value: "auto", label: "Follow my system" }, { value: "normal", label: "Standard" }, { value: "high", label: "High" }
      ], S.contrast, function (v) { set("contrast", v); }));
      body.appendChild(radioGroup("font", "Story font", [
        { value: "serif", label: "Serif (default)" }, { value: "sans", label: "Sans-serif, easier to read" }
      ], S.font, function (v) { set("font", v); }));
      body.appendChild(radioGroup("spacing", "Letter and line spacing", [
        { value: "normal", label: "Standard" }, { value: "wide", label: "Wide" }
      ], S.spacing, function (v) { set("spacing", v); }));
      body.appendChild(radioGroup("announce", "Screen reader: after each choice, announce", [
        { value: "full", label: "The story, with what changed" }, { value: "changes", label: "Only what changed" }, { value: "off", label: "Nothing" }
      ], S.announce, function (v) { set("announce", v); },
        "What changed means what is new about you, what no longer is, and new sounds. Focus always moves to the new scene's heading, so the whole scene can be read from there whatever you pick."));
      body.appendChild(radioGroup("shortcuts", "Single-key shortcuts (1–9 choose, I C B M L screens, N new run)", [
        { value: "on", label: "On" }, { value: "off", label: "Off" }
      ], S.shortcuts, function (v) { set("shortcuts", v); },
        "Turn these off if you use speech input or keep pressing keys by accident. Every action stays reachable with Tab and Enter."));
      body.appendChild(el("p", { "class": "hint", text: "Motion follows your system's reduce-motion setting. These settings are remembered in this browser; your run is not." }));
    }, { focusHeading: true });
  }

  function openNewRun() {
    openModal("New run", function (body) {
      var seedIn = el("input", { type: "text", id: "nr-seed", value: G.seed || "rivermouth-demo", "aria-describedby": "nr-seed-g" });
      var sel = el("select", { id: "nr-diff", "aria-describedby": "nr-diff-g" });
      Z.DIFFICULTY_MODES.forEach(function (m) {
        var op = el("option", { value: m.mode, text: m.label }); if (m.mode === "survivor") op.selected = true; sel.appendChild(op);
      });
      var gloss = el("p", { "class": "gloss", id: "nr-diff-g" });
      function setGloss() { var m = Z.DIFFICULTY_MODES.filter(function (x) { return x.mode === sel.value; })[0]; gloss.textContent = m ? m.gloss : ""; }
      sel.addEventListener("change", setGloss); setGloss();
      var iron = el("input", { type: "checkbox", id: "nr-iron" });
      body.appendChild(el("div", { "class": "field" }, [el("label", { "for": "nr-seed", text: "Seed" }), seedIn,
        el("p", { "class": "gloss", id: "nr-seed-g", text: "The same seed plays the same run." })]));
      body.appendChild(el("div", { "class": "field" }, [el("label", { "for": "nr-diff", text: "Difficulty" }), sel, gloss]));
      body.appendChild(el("div", { "class": "field" }, [el("label", { "class": "check", "for": "nr-iron" },
        [iron, "Ironman — one save, no take-backs (full-client enforced)"])]));
      body.appendChild(el("div", { "class": "row" }, [el("button", {
        type: "button", "class": "btn accent", text: "Start run",
        onclick: function () { newRun(seedIn.value, sel.value, iron.checked); closeModal(true); render({ turn: true }); }
      })]));
    });
  }

  function openSave() {
    var text = ""; try { text = Z.saveGame(G.state); } catch (e) { text = ""; }
    openModal("Save", function (body) {
      var ta = el("textarea", { readonly: "readonly", id: "sv-data" }); ta.value = text;
      var msg = el("p", { "class": "msg", role: "status" });
      var dl = el("button", {
        type: "button", "class": "btn accent", text: "Download .json",
        onclick: function () {
          var blob = new Blob([text], { type: "application/json" });
          var url = URL.createObjectURL(blob);
          var a = el("a", { href: url, download: "zurvival-" + (G.seed || "run") + ".json" });
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          msg.className = "msg ok"; msg.textContent = "Downloaded.";
        }
      });
      var cp = el("button", {
        type: "button", "class": "btn", text: "Copy",
        onclick: function () {
          function done() { msg.className = "msg ok"; msg.textContent = "Copied to clipboard."; }
          function manual() { ta.focus(); ta.select(); msg.className = "msg"; msg.textContent = "Selected — press Ctrl or Cmd plus C to copy."; }
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
          else manual();
        }
      });
      body.appendChild(el("p", { "class": "hint", text: "Your progress lives only in this page — there is no autosave. Download or copy this to keep it." }));
      body.appendChild(el("div", { "class": "field", style: "margin-top:12px" }, [el("label", { "for": "sv-data", text: "Save data" }), ta]));
      body.appendChild(el("div", { "class": "row" }, [dl, cp]));
      body.appendChild(msg);
    });
  }

  function openLoad() {
    openModal("Load", function (body) {
      var ta = el("textarea", { id: "ld-data", placeholder: "Paste a saved run here…" });
      var fileInput = el("input", { type: "file", accept: ".json,application/json", hidden: true, tabindex: "-1" });
      var msg = el("p", { "class": "msg", role: "status" });
      function doLoad(txt) {
        try {
          var st = Z.loadGame(txt);
          G.state = st; G.graph = rebuildGraph(); G.over = Z.isRunOver(st); G.spoken = null;
          try { if (st && st.meta && st.meta.seed) G.seed = st.meta.seed; } catch (e) {}
          closeModal(true); render({ turn: true });
        } catch (e) { msg.className = "msg err"; msg.textContent = "Error: could not load — " + (e && e.message ? e.message : e); }
      }
      fileInput.addEventListener("change", function () {
        var f = fileInput.files[0]; if (!f) return;
        var rd = new FileReader(); rd.onload = function () { doLoad(String(rd.result)); }; rd.readAsText(f);
      });
      // A real button that opens the picker — the old label-wrapped input was focusable while positioned off-screen.
      var upload = el("button", { type: "button", "class": "btn ghost", text: "Upload a file…", onclick: function () { fileInput.click(); } });
      body.appendChild(el("p", { "class": "hint", text: "Load a run you downloaded or copied earlier." }));
      body.appendChild(el("div", { "class": "field", style: "margin-top:12px" }, [el("label", { "for": "ld-data", text: "Paste save text" }), ta]));
      body.appendChild(el("div", { "class": "row" }, [el("button", { type: "button", "class": "btn accent", text: "Load pasted", onclick: function () { doLoad(ta.value); } }), upload, fileInput]));
      body.appendChild(msg);
    });
  }

  var toastTimer = null;
  /** A passing notice. An ERROR never times out (ACCESSIBILITY §5 "no auto-dismiss") — it stays until the next render. */
  function toast(text, kind) {
    var t = $("#toast");
    t.textContent = text; t.className = "show " + (kind || "");
    clearTimeout(toastTimer);
    if (kind !== "err") toastTimer = setTimeout(clearToast, 4000);
  }
  function clearToast() { var t = $("#toast"); if (t) { t.className = ""; t.textContent = ""; } }

  /* ---------- keyboard ---------- */
  function typingInto(t) {
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  document.addEventListener("keydown", function (e) {
    if (isModalOpen()) return; // the dialog owns its own keys
    if (S.shortcuts !== "on") return;        // WCAG 2.1.4 — single-key shortcuts can be turned off
    if (e.metaKey || e.ctrlKey || e.altKey || typingInto(e.target)) return;
    if (e.repeat) return;                    // a held key is ONE press — a tremor must not play six turns
    if (/^[1-9]$/.test(e.key) && !G.over) {
      var scene = Z.sceneOf(G.state, G.graph); var c = scene.choices[Number(e.key) - 1];
      if (c) { e.preventDefault(); choose(c); } return;
    }
    var k = e.key.toLowerCase();
    var s = Z.screenForKey(k);
    if (s) { e.preventDefault(); openScreen(s.id); return; }
    if (k === "n") { e.preventDefault(); openNewRun(); }
  });

  /* ---------- chrome wiring + boot ---------- */
  function boot() {
    applySettings();
    try { window.matchMedia("(prefers-contrast: more)").addEventListener("change", applySettings); } catch (e) {}
    window.addEventListener("resize", layoutBars);
    try { new ResizeObserver(layoutBars).observe($("#topbar")); new ResizeObserver(layoutBars).observe($("#screens")); } catch (e) {}
    $("#btn-new").addEventListener("click", openNewRun);
    $("#btn-save").addEventListener("click", openSave);
    $("#btn-load").addEventListener("click", openLoad);
    $("#btn-settings").addEventListener("click", openSettings);
    var sc = $("#screens");
    Z.DEPTH_SCREENS.forEach(function (s) {
      sc.appendChild(el("button", {
        // No aria-haspopup on any dialog trigger. Verified with Orca: a button with a popup is a "focus mode
        // widget", so focusing one flipped the reader out of browse mode and it stayed there — the NEXT dialog opened
        // silently, and H/L quick navigation inside it stopped working. (NVDA reports the same attribute as a menu.)
        type: "button", "class": "btn ghost screenbtn", "data-screen": s.id,
        onclick: function () { openScreen(s.id); }
      }, [el("span", { "class": "k", "aria-hidden": "true", text: s.key.toUpperCase() + " " }), s.title]));
    });
    newRun("rivermouth-demo", "survivor", false);
    render({ announce: true });
  }
  /**
   * The two pinned bars must never cover what has focus (WCAG 2.4.11). The page's scroll padding is kept equal to
   * their heights, so the browser scrolls a focused control clear of them; and when together they would take more
   * than a third of the window — a short screen, or text at 200% — they stop being pinned at all. A CSS height query
   * cannot do this: the Text size setting grows the bars without changing the viewport.
   */
  function layoutBars() {
    var top = $("#topbar"), bottom = $("#screens"), h = document.documentElement;
    h.removeAttribute("data-bars");
    var t = top.getBoundingClientRect().height, b = bottom.getBoundingClientRect().height;
    var tooTall = t + b > window.innerHeight / 3;
    if (tooTall) h.setAttribute("data-bars", "static");
    h.style.setProperty("--bar-top", (tooTall ? 0 : Math.ceil(t) + 8) + "px");
    h.style.setProperty("--bar-bottom", (tooTall ? 0 : Math.ceil(b) + 8) + "px");
  }

  /** aria-keyshortcuts is only true while shortcuts are on — never advertise a key that does nothing. */
  function syncShortcutHints() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-screen]"), function (b) {
      var s = Z.screenById(b.getAttribute("data-screen"));
      if (S.shortcuts === "on" && s) b.setAttribute("aria-keyshortcuts", s.key.toUpperCase()); else b.removeAttribute("aria-keyshortcuts");
      var k = b.querySelector(".k"); if (k) k.hidden = S.shortcuts !== "on";
    });
    var nb = $("#btn-new"); if (S.shortcuts === "on") nb.setAttribute("aria-keyshortcuts", "N"); else nb.removeAttribute("aria-keyshortcuts");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.__ZURV_UI = { get G() { return G; }, get settings() { return S; }, render: function (o) { render(o); } }; // test hook
})();
