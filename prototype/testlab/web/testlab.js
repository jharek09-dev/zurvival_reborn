/* Zurvival Test Lab — the page. Drives the bundled core (window.ZL: engine + harness renderers + the
   Test Lab runner) entirely in memory. No network, no storage: everything you see came from this file. */
(function () {
  "use strict";
  var ZL = window.ZL;
  var CONTENT = window.CONTENT;

  /* ---------- tiny DOM helpers ---------- */
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
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function fmt(n, d) { return (typeof n === "number" && isFinite(n)) ? n.toFixed(d == null ? 1 : d) : "—"; }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "application/json" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }
  function copyText(text, msgEl) {
    function ok() { toast("Copied.", "ok"); if (msgEl) { msgEl.className = "msg ok"; msgEl.textContent = "Copied to clipboard."; } }
    function no() { toast("Copy failed — select and copy by hand.", "err"); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, no); else no();
  }
  var toastTimer = null;
  function toast(text, kind) {
    var t = $("#toast"); if (!t) { t = el("div", { id: "toast" }); document.body.appendChild(t); }
    t.textContent = text; t.className = kind || ""; t.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.opacity = "0"; }, 2200);
  }

  /* ---------- modal ---------- */
  var lastFocus = null;
  function openModal(title, fill) {
    closeModal();
    lastFocus = document.activeElement;
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
    if (root.firstChild) { clear(root); if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} } }
  }

  /* ---------- app state ---------- */
  var A = {
    fromState: null,       // a loaded save every run starts from (null = boot from seed)
    fromLabel: "",
    batch: { running: false, stopped: false, reports: [], specs: [], spec: null },
    watch: { run: null, playing: false, human: false, timer: null, pickedId: null, lastStep: null },
  };

  /* ---------- setup panel → BatchSpec ---------- */
  function readSpec() {
    var pol = [];
    document.querySelectorAll("#in-policies input:checked").forEach(function (i) { pol.push(i.value); });
    if (pol.length === 0) pol = ["careful"];
    var list = $("#in-seedlist").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var n = Math.max(1, Math.min(200, parseInt($("#in-seeds").value, 10) || 8));
    var stocked = [];
    if ($("#in-stocked").checked) stocked.push(true);
    if ($("#in-unstocked").checked) stocked.push(false);
    if (stocked.length === 0) stocked = [true];
    var diff = $("#in-difficulty").value;
    var spec = {
      seeds: list.length ? list : ZL.defaultSeeds(n),
      policies: pol,
      stocked: stocked,
      turns: Math.max(1, parseInt($("#in-turns").value, 10) || 400),
      budgetMs: Math.max(0, parseFloat($("#in-budget").value) || 0),
      saveSample: Math.max(0, parseInt($("#in-savesample").value, 10) || 0),
      detSample: Math.max(0, parseInt($("#in-detsample").value, 10) || 0),
      replay: $("#in-replay").checked,
    };
    if (diff && diff !== "survivor") spec.difficulty = diff;
    if ($("#in-ironman").checked) spec.ironman = true;
    return spec;
  }

  /* ---------- batch ---------- */
  function startBatch() {
    if (A.batch.running) return;
    var spec = readSpec();
    var specs = ZL.expandBatch(spec);
    A.batch = { running: true, stopped: false, reports: [], specs: specs, spec: spec, t0: Date.now() };
    $("#btn-run").disabled = true; $("#btn-stop").disabled = false;
    $("#progress").hidden = false;
    updateProgress();
    var i = 0;
    function tick() {
      if (A.batch.stopped || i >= specs.length) return finishBatch();
      var r;
      try { r = ZL.runToEnd(CONTENT, specs[i], A.fromState || undefined); }
      catch (e) {
        // The runner catches engine throws itself; this would be a bug in the Lab. Show it, don't hide it.
        console.error(e); toast("Lab error: " + (e && e.message ? e.message : e), "err");
        r = null;
      }
      if (r) A.batch.reports.push(r);
      i++;
      updateProgress();
      setTimeout(tick, 0);
    }
    setTimeout(tick, 0);
  }
  function updateProgress() {
    var b = A.batch, n = b.specs.length, done = b.reports.length;
    var fails = b.reports.reduce(function (a, r) { return a + r.failures.length; }, 0);
    var fill = $("#progress-fill");
    fill.style.width = n ? ((done / n) * 100).toFixed(1) + "%" : "0%";
    fill.className = "fill" + (fails > 0 ? " bad" : "");
    $("#progress-text").textContent = done + "/" + n + " runs · " + fails + " failure" + (fails === 1 ? "" : "s") +
      (b.running ? "" : " · " + ((Date.now() - b.t0) / 1000).toFixed(1) + " s");
    var pill = $("#results-pill");
    pill.hidden = done === 0;
    pill.textContent = fails > 0 ? fails + " ✕" : done + " ✓";
    pill.className = "pill " + (fails > 0 ? "bad" : "good");
  }
  function finishBatch() {
    A.batch.running = false;
    $("#btn-run").disabled = false; $("#btn-stop").disabled = true;
    $("#btn-export").disabled = A.batch.reports.length === 0;
    updateProgress();
    renderResults();
    var s = ZL.summarize(A.batch.reports);
    toast(s.runs + " runs · " + s.failed + " failed", s.failed ? "err" : "ok");
    if (s.failed > 0) showTab("results");
  }

  /* ---------- results view ---------- */
  var sortKey = "seed", sortDir = 1;
  var COLS = [
    { k: "seed", t: "Seed", get: function (r) { return r.spec.seed; } },
    { k: "policy", t: "Policy", get: function (r) { return r.spec.policy; } },
    { k: "stocked", t: "Pack", get: function (r) { return r.resumed ? "from save" : (r.spec.stocked ? "stocked" : "unstocked"); } },
    { k: "actions", t: "Actions", num: true, get: function (r) { return r.actions; } },
    { k: "resolvedTurns", t: "Turns", num: true, get: function (r) { return r.resolvedTurns; } },
    { k: "end", t: "End", get: function (r) { return r.end; } },
    { k: "endDay", t: "Day", num: true, get: function (r) { return r.endDay; } },
    { k: "fails", t: "Fails", num: true, get: function (r) { return r.failures.length; } },
    { k: "p95", t: "p95 ms", num: true, get: function (r) { return r.perf.p95; }, fmt: function (v) { return fmt(v, 2); } },
    { k: "max", t: "max ms", num: true, get: function (r) { return r.perf.max; }, fmt: function (v) { return fmt(v, 1); } },
    { k: "kinds", t: "Verbs", num: true, get: function (r) { return Object.keys(r.coverage.kinds).length; } },
    { k: "inf", t: "Infection", get: function (r) { return r.coverage.deepestInfection; } },
    { k: "combats", t: "Combats", num: true, get: function (r) { return r.coverage.combatsEntered; } },
    { k: "enc", t: "Encounters", num: true, get: function (r) { return r.coverage.encountersFired; } },
    { k: "hist", t: "Hist/turn", num: true, get: function (r) { return r.historyPerTurn; }, fmt: function (v) { return fmt(v, 2); } },
    { k: "save", t: "Save KiB", num: true, get: function (r) { return r.saveBytes / 1024; }, fmt: function (v) { return fmt(v, 1); } },
  ];
  function renderResults() {
    var reports = A.batch.reports;
    var s = ZL.summarize(reports);
    var tiles = clear($("#tiles"));
    function tile(n, l, cls) { tiles.appendChild(el("div", { "class": "tile" }, [el("div", { "class": "n " + (cls || ""), text: String(n) }), el("div", { "class": "l", text: l })])); }
    tile(s.runs, "runs");
    tile(s.passed, "passed", s.passed === s.runs && s.runs > 0 ? "good" : "");
    tile(s.failed, "failed", s.failed > 0 ? "bad" : "good");
    tile(s.crashed, "crashed", s.crashed > 0 ? "bad" : "");
    tile(s.failures, "failures", s.failures > 0 ? "bad" : "good");
    tile(fmt(s.perfP95, 2) + " ms", "p95 turn", s.perfP95 > 50 ? "warn" : "");
    tile(fmt(s.perfMax, 1) + " ms", "slowest turn", s.perfMax > 100 ? "bad" : "");
    tile(fmt(s.meanEndDay, 1), "mean end day");
    tile(s.deepestInfection, "deepest infection");
    tile(s.combatsEntered, "combats");
    tile(s.encountersFired, "encounters");
    tile((s.verbatimRepeatRateMax * 100).toFixed(1) + "%", "verbatim repeats (max)", s.verbatimRepeatRateMax >= ZL.VERBATIM_REPEAT_TARGET ? "bad" : "good");
    tile(fmt(s.historyPerTurnMax, 2), "history/turn (max)");
    tile(fmt(s.saveBytesMax / 1024, 0) + " KiB", "largest save");
    $("#results-hint").textContent = reports.length ? "Click a column to sort · click a row to watch that run from its start." : "Run a batch from the Lab tab to fill this in.";

    var thead = clear($("#runs-table thead")), tbody = clear($("#runs-table tbody"));
    var tr = el("tr");
    COLS.forEach(function (c) {
      tr.appendChild(el("th", { "class": (c.num ? "num " : "") + (sortKey === c.k ? "sorted" : ""), text: c.t + (sortKey === c.k ? (sortDir > 0 ? " ▲" : " ▼") : ""), onclick: function () {
        if (sortKey === c.k) sortDir = -sortDir; else { sortKey = c.k; sortDir = 1; }
        renderResults();
      } }));
    });
    tr.appendChild(el("th", { text: "" }));
    thead.appendChild(tr);
    var col = COLS.filter(function (c) { return c.k === sortKey; })[0] || COLS[0];
    var sorted = reports.slice().sort(function (a, b) {
      var x = col.get(a), y = col.get(b);
      if (x === y) return 0;
      return (x > y ? 1 : -1) * sortDir;
    });
    sorted.forEach(function (r) {
      var row = el("tr", { "class": r.ok ? "" : "bad", onclick: function () { watchReport(r, 0); } , style: "cursor:pointer" });
      COLS.forEach(function (c) {
        var v = c.get(r);
        var td = el("td", { "class": c.num ? "num" : "" });
        if (c.k === "end") td.appendChild(el("span", { "class": "end-" + v, text: v }));
        else if (c.k === "fails" && v > 0) { td.textContent = String(v) + " "; td.appendChild(el("span", { "class": "ids", text: Object.keys(r.failuresByCheck).join(" ") })); }
        else td.textContent = c.fmt ? c.fmt(v) : String(v);
        row.appendChild(td);
      });
      row.appendChild(el("td", {}, [el("button", { "class": "btn small", text: "Watch", onclick: function (e) { e.stopPropagation(); watchReport(r, 0); } })]));
      tbody.appendChild(row);
    });

    var fl = clear($("#failures"));
    var failing = reports.filter(function (r) { return !r.ok; });
    if (!failing.length) { fl.appendChild(el("div", { "class": "hint", text: reports.length ? "No failures. Every check held on every turn of every run." : "—" })); return; }
    ZL.CHECK_IDS.forEach(function (id) {
      var items = [];
      failing.forEach(function (r) { r.failures.forEach(function (f) { if (f.id === id) items.push({ r: r, f: f }); }); });
      if (!items.length) return;
      var info = ZL.checkInfo(id);
      var g = el("div", { "class": "failgroup" });
      g.appendChild(el("h3", { text: id + " × " + items.length + " — " + info.title }));
      g.appendChild(el("div", { "class": "why", text: info.why + "  (" + info.traces + ")" }));
      items.slice(0, 40).forEach(function (it) { g.appendChild(failureCard(it.r, it.f)); });
      if (items.length > 40) g.appendChild(el("div", { "class": "hint", text: "… " + (items.length - 40) + " more in the exported report." }));
      fl.appendChild(g);
    });
  }
  function failureCard(r, f) {
    var step = f.step == null ? Math.max(0, r.choiceIds.length - 1) : f.step;
    var card = el("div", { "class": "fail" });
    card.appendChild(el("div", {}, [el("span", { "class": "id", text: f.id }), " ", el("span", { text: ZL.checkInfo(f.id).title })]));
    card.appendChild(el("div", { "class": "d", text: f.detail }));
    card.appendChild(el("div", { "class": "where", text: ZL.reproLine(r, step) + " · turn " + f.turn + (f.action ? " · after " + f.action : "") }));
    var row = el("div", { "class": "row" });
    row.appendChild(el("button", { "class": "btn small accent", text: "Jump to turn", onclick: function () { watchReport(r, step); } }));
    row.appendChild(el("button", { "class": "btn small", text: "Download save at turn", onclick: function () { downloadSaveAt(r, step); } }));
    row.appendChild(el("button", { "class": "btn small", text: "Copy repro", onclick: function () { copyText(ZL.reproLine(r, step) + "\n" + ZL.reproCommand(r)); } }));
    row.appendChild(el("button", { "class": "btn small", text: "Transcript", onclick: function () { downloadTranscript(r); } }));
    if (f.stack) row.appendChild(el("button", { "class": "btn small ghost", text: "Stack", onclick: function () { openModal("Stack trace", function (b) { b.appendChild(el("pre", { "class": "screen", text: f.stack })); }); } }));
    card.appendChild(row);
    return card;
  }

  /** Rebuild a run to just before `step` (deterministic) and drop it into the Watch pane, paused. */
  function replayTo(r, step) {
    var run = new ZL.RunSession(CONTENT, r.spec, A.fromState || undefined);
    var k = Math.min(step, r.choiceIds.length);
    for (var i = 0; i < k && !run.done; i++) run.step(r.choiceIds[i]);
    return run;
  }
  function watchReport(r, step) {
    stopPlaying();
    A.watch.run = replayTo(r, step);
    A.watch.human = false; A.watch.pickedId = null; A.watch.lastStep = null;
    $("#w-policy").value = r.spec.policy; $("#w-seed").value = r.spec.seed; $("#w-stocked").checked = !!r.spec.stocked;
    showTab("lab");
    renderWatch();
    toast(step > 0 ? "At step " + step + " of " + r.spec.seed + " (" + r.spec.policy + "). Paused." : "Watching " + r.spec.seed + " (" + r.spec.policy + ") from the start.", "ok");
  }
  function downloadSaveAt(r, step) {
    var run = replayTo(r, step);
    download("zurvival-" + r.spec.seed + "-" + r.spec.policy + "-step" + step + ".json", ZL.saveGame(run.state, true));
  }
  function downloadTranscript(r) {
    var init = A.fromState || ZL.bootCity(CONTENT, r.spec.seed, { stocked: r.spec.stocked, difficulty: r.spec.difficulty, ironman: r.spec.ironman }).state;
    var graph = A.fromState ? ZL.graphFor(CONTENT) : ZL.bootCity(CONTENT, r.spec.seed, { stocked: r.spec.stocked }).graph;
    var ids = r.end === "crashed" ? r.choiceIds.slice(0, -1) : r.choiceIds;
    var text;
    try { text = ZL.transcript(ZL.playSession(init, graph, ids), graph).join("\n"); }
    catch (e) { text = "transcript failed: " + (e && e.message ? e.message : e); }
    download("zurvival-" + r.spec.seed + "-" + r.spec.policy + "-transcript.txt", text, "text/plain");
  }

  /* ---------- watch pane ---------- */
  function watchSpec() {
    var base = readSpec();
    return {
      seed: ($("#w-seed").value || "tl-1").trim() || "tl-1",
      policy: $("#w-policy").value || "careful",
      stocked: $("#w-stocked").checked,
      turns: base.turns, budgetMs: base.budgetMs, saveSample: base.saveSample, detSample: base.detSample, replay: base.replay,
      difficulty: base.difficulty, ironman: base.ironman,
    };
  }
  function newWatch() {
    stopPlaying();
    var spec = watchSpec();
    if (spec.difficulty === undefined) delete spec.difficulty;
    if (spec.ironman === undefined) delete spec.ironman;
    try { A.watch.run = new ZL.RunSession(CONTENT, spec, A.fromState || undefined); }
    catch (e) { console.error(e); toast("Could not start: " + (e && e.message ? e.message : e), "err"); return; }
    A.watch.human = false; A.watch.pickedId = null; A.watch.lastStep = null;
    renderWatch();
  }
  function stopPlaying() {
    A.watch.playing = false;
    if (A.watch.timer) { clearTimeout(A.watch.timer); A.watch.timer = null; }
    $("#w-play").textContent = "▶ Play";
  }
  function togglePlay() {
    var w = A.watch;
    if (!w.run || w.run.done) return;
    if (w.playing) { stopPlaying(); renderWatch(); return; }
    w.human = false; w.playing = true;
    $("#w-play").textContent = "❚❚ Pause";
    scheduleTick();
  }
  function speedMs() { return 1000 / Math.max(1, parseInt($("#w-speed").value, 10) || 6); }
  function scheduleTick() {
    var w = A.watch;
    if (!w.playing) return;
    // Two phases per action: show the bot's pick, then take it. Fast speeds skip the preview.
    var ms = speedMs();
    var preview = ms >= 120;
    if (preview) {
      w.pickedId = w.run.peek() ? w.run.peek().id : null;
      renderChoices();
      w.timer = setTimeout(function () { doStep(); w.timer = setTimeout(scheduleTick, ms * 0.45); }, ms * 0.55);
    } else {
      doStep();
      w.timer = setTimeout(scheduleTick, ms);
    }
  }
  function doStep(pickId) {
    var w = A.watch;
    if (!w.run || w.run.done) { stopPlaying(); renderWatch(); return; }
    var res;
    try { res = w.run.step(pickId); }
    catch (e) { console.error(e); toast("Step failed: " + (e && e.message ? e.message : e), "err"); stopPlaying(); return; }
    w.lastStep = res; w.pickedId = null;
    if (res.failures.length) toast(res.failures.map(function (f) { return f.id; }).join(", ") + " at turn " + w.run.state.meta.turn, "err");
    if (w.run.done) { stopPlaying(); try { w.run.finish(); } catch (e) { console.error(e); } }
    renderWatch();
  }
  function takeOver() {
    var w = A.watch;
    if (!w.run) return;
    stopPlaying();
    w.human = !w.human;
    w.pickedId = null;
    renderWatch();
  }

  function renderWatch() {
    var w = A.watch, run = w.run;
    var who = $("#w-who");
    if (!run) { who.textContent = "no run"; who.className = "who"; return; }
    var state = run.state, graph = run.graph;
    var scene = ZL.sceneOf(state, graph);
    var R = ZL.renderRegions(scene, state, graph);
    $("#meta").textContent = (R.header[0] || "") + "  ·  " + run.spec.seed + " · " + run.spec.policy + (run.resumed ? " · from save" : (run.spec.stocked ? " · stocked" : " · unstocked")) + "  ·  action " + run.choiceIds.length + "/" + run.spec.turns;
    var pane = clear($("#pane"));
    var status = el("div", { "class": "status" });
    R.status.forEach(function (s) { status.appendChild(el("div", { "class": "s", text: s })); });
    pane.appendChild(status);
    if (R.soundscape && R.soundscape.length) {
      var snd = el("div", { "class": "soundscape" });
      snd.appendChild(el("span", { "class": "sub", text: "What you hear" }));
      R.soundscape.forEach(function (s) { snd.appendChild(el("div", { text: s })); });
      pane.appendChild(snd);
    }
    var story = el("div", { "class": "story" });
    var layout = ZL.layoutStory(String(R.story[0] || ""));
    if (layout.dateline) story.appendChild(el("div", { "class": "dateline", text: layout.dateline }));
    layout.paragraphs.forEach(function (p) { story.appendChild(el("p", { text: p })); });
    pane.appendChild(story);
    if (!run.done) pane.appendChild(el("div", { "class": "prompt", text: w.human ? "Your move — click a choice or press its number." : (R.prompt[0] || "What do you do?") }));
    renderChoices();

    who.textContent = run.done ? "run over · " + run.end : (w.human ? "you" : (w.playing ? "bot · playing" : "bot · paused"));
    who.className = "who" + (run.done ? " over" : (w.human ? " human" : ""));
    $("#w-ms").textContent = w.lastStep ? fmt(w.lastStep.ms, 2) + " ms" : "";
    $("#w-takeover").textContent = w.human ? "Hand back" : "Take over";
    $("#w-play").disabled = run.done; $("#w-step").disabled = run.done || w.human; $("#w-takeover").disabled = run.done;
    renderCheckStrip();
    renderTelemetry();
  }
  function renderChoices() {
    var w = A.watch, run = w.run;
    var cwrap = clear($("#choices"));
    if (!run) return;
    var choices = run.choices();
    if (run.done) {
      var rep = run.report();
      cwrap.appendChild(el("div", { "class": "ended" }, [
        el("h2", { text: run.end === "alive" ? "Action cap reached — still alive." : run.end === "crashed" ? "The engine threw." : run.end === "soft-locked" ? "Soft-lock: no choice offered." : "The run is over: " + run.end + "." }),
        el("div", { "class": "hint", text: rep.actions + " actions · " + rep.resolvedTurns + " turns · day " + rep.endDay + " · " + rep.failures.length + " failure" + (rep.failures.length === 1 ? "" : "s") }),
        el("div", { "class": "row", style: "margin-top:8px" }, [
          el("button", { "class": "btn accent", text: "New run", onclick: newWatch }),
          el("button", { "class": "btn", text: "Download save", onclick: function () { download("zurvival-" + run.spec.seed + "-end.json", ZL.saveGame(run.state, true)); } }),
        ]),
      ]));
      return;
    }
    if (!choices.length) { cwrap.appendChild(el("div", { "class": "hint", text: "No choices offered (soft-lock — CHK-LEGAL will flag this on step)." })); return; }
    var last = w.lastStep && w.lastStep.choice ? w.lastStep.choice.id : null;
    choices.forEach(function (c, i) {
      var free = !(c.timeCost > 0);
      var cls = "choice" + (w.human ? " human" : "") + (w.pickedId === c.id ? " picked" : "");
      var btn = el("button", { "class": cls, "aria-label": (i + 1) + ". " + c.label + ", " + (free ? "free" : c.timeCost + " hours"),
        onclick: function () { if (w.human) doStep(c.id); } }, [
        el("span", { "class": "num", "aria-hidden": "true", text: String(i + 1) }),
        el("span", { "class": "label", text: c.label }),
        w.pickedId === c.id ? el("span", { "class": "bot", text: "bot picks" }) : null,
        el("span", { "class": "cost" + (free ? " free" : ""), "aria-hidden": "true", text: free ? "free" : c.timeCost + "h" }),
      ]);
      if (!w.human) btn.disabled = false;
      cwrap.appendChild(btn);
    });
    void last;
  }
  function renderCheckStrip() {
    var w = A.watch, run = w.run;
    var strip = clear($("#checkstrip"));
    if (!run) return;
    var step = w.lastStep;
    var failed = {};
    if (step) step.failures.forEach(function (f) { failed[f.id] = f; });
    var idx = run.choiceIds.length - 1;
    var sampled = { "CHK-DET": run.spec.detSample > 0 && idx >= 0 && idx % run.spec.detSample === 0,
                    "CHK-SAVE": run.spec.saveSample > 0 && (idx + 1) % run.spec.saveSample === 0,
                    "CHK-RESUME": run.spec.saveSample > 0 && (idx + 1) % run.spec.saveSample === 0,
                    "CHK-END": run.done, "CHK-REPLAY": run.done, "CHK-LEGAL": true };
    ZL.CHECK_IDS.forEach(function (id) {
      var cls = "chk";
      var t = id.replace("CHK-", "");
      if (failed[id]) cls += " bad";
      else if (!step) cls += " skip";
      else if (id in sampled && !sampled[id]) cls += " skip";
      else cls += " ok";
      strip.appendChild(el("span", { "class": cls, title: ZL.checkInfo(id).title + (failed[id] ? " — " + failed[id].detail : ""), text: t }));
    });
    var total = run.failures.length;
    strip.appendChild(el("span", { "class": "chk" + (total ? " bad" : ""), text: total + " fail" + (total === 1 ? "" : "s") + " so far" }));
  }

  /* ---------- telemetry + sparklines ---------- */
  function spark(points, keys, colors, max) {
    var W = 280, H = 44, n = points.length;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("preserveAspectRatio", "none");
    if (n < 2) return svg;
    var mx = max;
    if (mx == null) { mx = 1; points.forEach(function (p) { keys.forEach(function (k) { if (p[k] > mx) mx = p[k]; }); }); }
    keys.forEach(function (k, ki) {
      var d = "";
      for (var i = 0; i < n; i++) {
        var x = (i / (n - 1)) * W, y = H - 2 - (Math.min(mx, Math.max(0, points[i][k])) / mx) * (H - 4);
        d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", colors[ki]); path.setAttribute("stroke-width", "1.5"); path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(path);
    });
    // failure ticks
    for (var j = 0; j < n; j++) if (points[j].failures > 0) {
      var t = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      t.setAttribute("x", ((j / (n - 1)) * W - 1).toFixed(1)); t.setAttribute("y", "0"); t.setAttribute("width", "2"); t.setAttribute("height", String(H));
      t.setAttribute("fill", "#D84334"); t.setAttribute("opacity", ".6"); svg.appendChild(t);
    }
    return svg;
  }
  function chart(label, right, points, keys, colors, max) {
    var c = el("div", { "class": "chart" });
    var lbl = el("div", { "class": "lbl" }); lbl.appendChild(el("span", { text: label })); lbl.appendChild(el("b", { text: right }));
    c.appendChild(lbl); c.appendChild(spark(points, keys, colors, max));
    return c;
  }
  function kv(container, rows) {
    var c = clear(container);
    rows.forEach(function (r) { c.appendChild(el("span", { "class": "k", text: r[0] })); c.appendChild(el("span", { "class": "v " + (r[2] || ""), text: String(r[1]) })); });
  }
  function renderTelemetry() {
    var run = A.watch.run;
    if (!run) return;
    var st = run.state, tl = run.timeline, last = tl[tl.length - 1];
    var needs = st.player.condition.needs;
    var here = st.nodes[st.player.location] || {};
    kv($("#run-kv"), [
      ["seed · policy", run.spec.seed + " · " + run.spec.policy],
      ["actions / turns", run.choiceIds.length + " / " + (st.meta.turn - run.initial.meta.turn)],
      ["day · hour", st.meta.day + " · " + st.meta.hour + ":00 " + st.meta.phase],
      ["location", st.player.location.replace(/^node\./, "")],
      ["walkers here", here.walkers != null ? here.walkers + " (" + here.zombieState + ")" : "—"],
      ["needs h/t/f", needs.hunger + " / " + needs.thirst + " / " + needs.fatigue, (needs.thirst >= 85 || needs.hunger >= 85) ? "bad" : ""],
      ["infection", st.player.condition.infection.stage, st.player.condition.infection.stage !== "none" ? "bad" : "good"],
      ["wounds", st.player.condition.wounds.length, st.player.condition.wounds.length ? "bad" : ""],
      ["combat", st.combat ? st.combat.enemy + " hp " + st.combat.hp + "/" + st.combat.maxHp : "—"],
      ["pressure / threat", (last ? last.pressure : "—") + " / " + st.world.globalThreat],
      ["hordes on map", st.hordes.length],
      ["history entries", st.history.length],
      ["last turn", last ? fmt(last.ms, 2) + " ms" : "—", last && last.ms > run.spec.budgetMs ? "bad" : ""],
    ]);
    var ch = clear($("#charts"));
    if (tl.length >= 2) {
      ch.appendChild(chart("needs", "hunger · thirst · fatigue", tl, ["hunger", "thirst", "fatigue"], ["#E0A33B", "#5C7A94", "#93A63E"], 100));
      ch.appendChild(chart("pressure · walkers here", "0–100 · count", tl, ["pressure", "walkersHere"], ["#D84334", "#B7B3A9"]));
      ch.appendChild(chart("ms per turn", "budget " + run.spec.budgetMs, tl, ["ms"], ["#F2803A"]));
      ch.appendChild(chart("history length", String(st.history.length), tl, ["historyLen"], ["#5FB3A1"]));
    } else ch.appendChild(el("div", { "class": "hint", text: "Charts appear after a couple of actions." }));
    var rep = run.report();
    var cov = rep.coverage;
    kv($("#cov-kv"), [
      ["verbs used", Object.keys(cov.kinds).length + " (" + Object.keys(cov.kinds).sort().join(", ") + ")"],
      ["nodes · regions", cov.nodesVisited + " · " + cov.regionsVisited],
      ["combats · overruns", cov.combatsEntered + " · " + cov.overrunsMet],
      ["escapes · fights", cov.escapesTaken + " · " + cov.fightsTaken],
      ["wounds suffered", cov.woundsSuffered],
      ["deepest infection", cov.deepestInfection],
      ["companions (max)", cov.companionsMax],
      ["encounters fired", cov.encountersFired],
      ["verbatim repeats", (rep.repetition.verbatimRepeatRate * 100).toFixed(1) + "%", rep.repetition.verbatimRepeatRate >= ZL.VERBATIM_REPEAT_TARGET ? "bad" : "good"],
    ]);
    var rf = clear($("#run-failures"));
    if (!run.failures.length) rf.textContent = "none";
    else run.failures.slice(-8).reverse().forEach(function (f) {
      rf.appendChild(el("div", { "class": "fail" }, [el("span", { "class": "id", text: f.id }), " turn " + f.turn + (f.action ? " · " + f.action : ""), el("div", { "class": "d", text: f.detail })]));
    });
  }

  /* ---------- depth screens ---------- */
  function openScreen(id, title) {
    var run = A.watch.run; if (!run) return;
    var lines = ZL.renderDepthScreen(id, run.state, run.graph);
    openModal(title, function (body) { body.appendChild(el("pre", { "class": "screen", text: lines.join("\n") })); });
  }

  /* ---------- load save ---------- */
  function openLoad() {
    openModal("Load a saved run", function (body) {
      var ta = el("textarea", { "aria-label": "Paste save data", placeholder: "Paste a zurvival-save.json here…" });
      var fileInput = el("input", { type: "file", accept: ".json,application/json", style: "position:absolute;left:-9999px" });
      var msg = el("div", { "class": "msg" });
      function doLoad(txt) {
        try {
          var st = ZL.loadGame(txt);
          A.fromState = st;
          A.fromLabel = "seed " + st.meta.seed + " · day " + st.meta.day + " · turn " + st.meta.turn + " · " + st.player.location.replace(/^node\./, "");
          $("#from-save").hidden = false; $("#from-save-text").textContent = A.fromLabel;
          $("#w-seed").value = st.meta.seed;
          closeModal(); newWatch();
          toast("Loaded. Every run now starts from this save.", "ok");
        } catch (e) { msg.className = "msg err"; msg.textContent = "Could not load: " + (e && e.message ? e.message : e); }
      }
      fileInput.addEventListener("change", function () {
        var f = fileInput.files[0]; if (!f) return;
        var rd = new FileReader(); rd.onload = function () { doLoad(String(rd.result)); }; rd.readAsText(f);
      });
      body.appendChild(el("div", { "class": "hint", text: "A save from the terminal client (press S) or the browser client. The Lab will watch the bot continue from it, and batches will start every run from it — the way to auto-check a tester's bug report." }));
      body.appendChild(el("div", { "class": "field", style: "margin-top:12px" }, [el("label", { text: "Paste save text" }), ta]));
      body.appendChild(el("div", { "class": "row" }, [
        el("button", { "class": "btn accent", text: "Load pasted", onclick: function () { doLoad(ta.value); } }),
        el("label", { "class": "btn ghost" }, ["Upload file…", fileInput]),
      ]));
      body.appendChild(msg);
    });
  }
  function clearSave() {
    A.fromState = null; A.fromLabel = "";
    $("#from-save").hidden = true;
    toast("Back to booting from the seed.", "ok");
  }

  /* ---------- tabs / checks view ---------- */
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false"); });
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.dataset.view !== name; });
  }
  function renderChecksView() {
    var list = clear($("#checks-list"));
    ZL.CHECKS.forEach(function (c) {
      list.appendChild(el("div", { "class": "checkrow" }, [
        el("span", { "class": "id", text: c.id }), el("span", { "class": "t", text: c.title }),
        el("span", { "class": "w", text: c.why }), el("span", { "class": "tr", text: c.traces }),
      ]));
    });
  }

  /* ---------- export ---------- */
  function exportReport() {
    var b = A.batch;
    if (!b.reports.length) return;
    download("zurvival-testlab-report.json", JSON.stringify({ generatedAt: new Date().toISOString(), built: window.BUILT, fromSave: A.fromLabel || null, spec: b.spec, summary: ZL.summarize(b.reports), reports: b.reports }, null, 2));
  }

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    if ($("#modal-root").firstChild) { if (e.key === "Escape") closeModal(); return; }
    var tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var w = A.watch;
    if (e.key === " ") { e.preventDefault(); togglePlay(); return; }
    if (e.key === ".") { e.preventDefault(); if (w.run && !w.human) doStep(); return; }
    if (/^[1-9]$/.test(e.key) && w.run && w.human && !w.run.done) {
      var c = w.run.choices()[Number(e.key) - 1];
      if (c) { e.preventDefault(); doStep(c.id); }
      return;
    }
    var k = e.key.toLowerCase();
    var s = ZL.screenForKey(k);
    if (s && w.run) { e.preventDefault(); openScreen(s.id, s.title); }
  });

  /* ---------- boot ---------- */
  function boot() {
    // build info
    var counts = Object.keys(CONTENT).map(function (k) { return CONTENT[k].length + " " + k; }).join(" · ");
    var probe = ZL.bootCity(CONTENT, "probe").state;
    $("#build").textContent = counts + " · save v" + probe.meta.version + " · built " + (window.BUILT || "").replace("T", " ").slice(0, 16);

    // policies
    var pol = $("#in-policies"), wp = $("#w-policy");
    ZL.POLICY_NAMES.forEach(function (p) {
      var info = ZL.POLICY_INFO[p];
      pol.appendChild(el("label", { "class": "check", title: info.gloss }, [el("input", { type: "checkbox", value: p, checked: "checked" }), info.title]));
      wp.appendChild(el("option", { value: p, text: info.title, title: info.gloss }));
    });
    wp.value = "careful";
    // difficulty
    var sel = $("#in-difficulty");
    ZL.DIFFICULTY_MODES.forEach(function (m) { var o = el("option", { value: m.mode, text: m.label, title: m.gloss }); if (m.mode === "survivor") o.selected = true; sel.appendChild(o); });
    // depth screens
    var sc = $("#screens");
    ZL.DEPTH_SCREENS.forEach(function (s) {
      sc.appendChild(el("button", { "class": "btn ghost screenbtn", title: s.summary, onclick: function () { openScreen(s.id, s.title); } },
        [el("span", { "class": "k", "aria-hidden": "true", text: s.key.toUpperCase() + " " }), s.title]));
    });
    // wiring
    document.querySelectorAll(".tab").forEach(function (t) { t.addEventListener("click", function () { showTab(t.dataset.tab); }); });
    $("#btn-run").addEventListener("click", startBatch);
    $("#btn-stop").addEventListener("click", function () { A.batch.stopped = true; });
    $("#btn-export").addEventListener("click", exportReport);
    $("#btn-copy-summary").addEventListener("click", function () { if (A.batch.reports.length) copyText(ZL.summaryText(A.batch.reports)); });
    $("#btn-load").addEventListener("click", openLoad);
    $("#btn-clear-save").addEventListener("click", clearSave);
    $("#w-new").addEventListener("click", newWatch);
    $("#w-play").addEventListener("click", togglePlay);
    $("#w-step").addEventListener("click", function () { if (A.watch.run && !A.watch.human) { stopPlaying(); doStep(); } });
    $("#w-takeover").addEventListener("click", takeOver);
    $("#w-speed").addEventListener("input", function () { $("#w-speed-val").textContent = $("#w-speed").value; });
    $("#btn-contrast").addEventListener("click", function () { var h = document.documentElement; h.dataset.contrast = h.dataset.contrast === "high" ? "normal" : "high"; });
    var scale = 1;
    $("#btn-text").addEventListener("click", function () { scale = scale >= 1.3 ? 1 : scale + 0.15; document.documentElement.style.setProperty("--scale", scale.toFixed(2)); });
    renderChecksView();
    newWatch();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.__TESTLAB = { get A() { return A; }, readSpec: readSpec, startBatch: startBatch, newWatch: newWatch, doStep: doStep, renderWatch: renderWatch }; // test hook
})();
