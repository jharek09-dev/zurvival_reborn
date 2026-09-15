/**
 * The web client's accessibility check (T63 · NFR-ACC-01..04 · ACCESSIBILITY §12 "automated").
 *
 *   node a11y-check.mjs <page.html> [--chrome <path>] [--json <out.json>]
 *
 * Drives the BUILT single-file page in a real headless Chromium over the DevTools protocol — no npm dependency
 * (Node 22's global WebSocket and fetch) — and fails, exit 1, on any violation. Where it can, it reads the page the
 * way assistive technology does: through Chromium's ACCESSIBILITY TREE (what AT-SPI, UIA and NSAccessibility hand
 * to a screen reader), plus real key events and real computed styles.
 *
 * What it asserts, in order:
 *   A. structure   — one h1; banner / main / navigation landmarks; the scene has an h2 and is NOT a named region (that
 *                    doubled its title in Orca); the choices are the one named region, an ordered list of buttons
 *                    whose names end with their cost in words; every focusable node
 *                    except dialog/heading/region containers has an accessible name; no <pre>; no aria-haspopup; the
 *                    live regions are exactly the announcer and the toast; and from a fresh load, Tab alone reaches
 *                    the skip links, the four top-bar buttons, every choice and every depth-screen button, in order.
 *   B. a turn      — Enter on a choice moves focus to the new scene heading and the announcer then carries a digest
 *                    ending in the choice count; two turns inside the announcer's delay lose nothing; a turn followed
 *                    at once by a dialog is still announced when the dialog closes; a HELD digit key takes one turn;
 *                    closing a dialog opened from the focused scene heading puts focus back on it (not <body>);
 *                    Start run never lands focus on the New run button on the way to the new scene; the last turn of a
 *                    run puts focus, visibly, on "The run is over.", and a screen opened from there gives focus back to it.
 *   C. dialogs     — on a state with two companions and a death (so ✗ and † really occur): every depth screen and
 *                    every top-bar dialog opens as a MODAL dialog named by its heading; Tab and Shift+Tab never leave
 *                    it; Escape closes it; focus returns to the opener; neither live region holds stale text after
 *                    it closes; a depth screen renders exactly its outline — one h3 per heading, one ul per list, one
 *                    li per row, one continuation span per continuation line, no <pre>; every ✗/† is aria-hidden and
 *                    no accessible name contains one. A drag from inside a dialog onto the backdrop does not close it.
 *   D. shortcuts   — with single-key shortcuts ON, "i" opens a screen; switched OFF in Settings, "i", "n" and "1" do
 *                    nothing and no control advertises aria-keyshortcuts (WCAG 2.1.4).
 *   E. contrast    — every visible text node clears WCAG AA (4.5, or 3 for large text) against its composited
 *                    background, and each pass must actually measure the text it exists for — in: standard; a hovered
 *                    choice; high contrast; sans + wide spacing; every depth screen, Settings, New run, Save and Load
 *                    open; a Load error; both toasts; the run-over panel. Plus: placeholder text ≥ 4.5:1, and the edge
 *                    of a text field ≥ 3:1 against its surroundings (WCAG 1.4.11).
 *   F. reflow      — at 320 CSS px wide with text at 200%, nothing scrolls horizontally, no control or text is clipped,
 *                    the pinned bars are not pinned, and a depth screen fits; and at three window sizes (1280×900
 *                    100%, 400×760 100%, 1366×657 200%) no Tab stop is covered by the pinned bars (WCAG 1.4.10, 2.4.11).
 *   G. targets     — every visible button, select, textarea, text input and option label measures at least 44×44 CSS px
 *                    — on the page and inside every dialog (tokens.css `--tap-min`).
 *   H. motion      — under prefers-reduced-motion no element transitions or animates (and without it, something does,
 *                    so the check can fail); under forced colours every button keeps a border and focus a ring.
 *   I. persistence — reader settings survive a reload; the run does not.
 *
 * It is NOT a screen reader. The real-AT verification is `web/at/` (Orca 46 over AT-SPI; transcripts in
 * docs/qa/at/); this is the part of that verification a CI runner can repeat on every push. Chromium only.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const pagePath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--chrome" && args[i - 1] !== "--json");
if (!pagePath || !fs.existsSync(pagePath)) {
  console.error("usage: node a11y-check.mjs <page.html> [--chrome <path>] [--json <out.json>]");
  process.exit(2);
}

function findChrome() {
  const fromEnv = flag("--chrome") ?? process.env.CHROME_BIN;
  if (fromEnv) return fromEnv;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; }
  }
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const p = path.join(pw, d, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const chromeBin = findChrome();
if (!chromeBin) {
  // Loud, never a silent skip: a check that quietly does not run is a green light nobody earned.
  console.error("✗ a11y web check: no Chrome/Chromium found (set CHROME_BIN or pass --chrome)");
  process.exit(1);
}

const failures = [];
const passes = [];
const fail = (area, msg) => failures.push(`[${area}] ${msg}`);
const pass = (area, msg) => passes.push(`[${area}] ${msg}`);
const check = (area, ok, msg) => (ok ? pass(area, msg) : fail(area, msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zurv-a11y-"));
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--force-renderer-accessibility", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  const t = setTimeout(() => reject(new Error("Chrome did not start within 20s")), 20000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
  chrome.on("exit", (c) => reject(new Error(`Chrome exited (${c}) before DevTools came up`)));
});

/** In-page: give the run two companions (trust-locked orders → ✗ rows) and a death (→ a † memorial line). */
const RICH_STATE = `(() => {
  const U = window.__ZURV_UI; const s = U.G.state; const here = s.player.location;
  const mk = (id, name, trust) => ({ id, type: "npc." + name.toLowerCase(), name, trust,
    condition: { needs: { hunger: 40, thirst: 10, fatigue: 20 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 40, morale: 45 } },
    location: here, groupId: null, relationships: {}, inventory: [], flags: { companion: true } });
  const actors = Object.assign({}, s.actors, { "actor.check-marcus": mk("actor.check-marcus", "Marcus", 55), "actor.check-ada": mk("actor.check-ada", "Ada", 60) });
  const history = s.history.concat([{ day: s.meta.day, hour: 5, turn: s.meta.turn, type: "companion.died", subjects: ["actor.check-sarah"], data: {} }]);
  U.G.state = Object.assign({}, s, { actors, history }); U.render({});
  return Object.keys(actors).length; })()`;

let exitCode = 1;
try {
  const port = new URL(wsUrl).port;
  const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails?.exception?.description ?? "exception");
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const KEYS = { Enter: [13, "\r", "Enter"], Tab: [9, "", "Tab"], Escape: [27, "", "Escape"], i: [73, "i", "KeyI"], n: [78, "n", "KeyN"], 1: [49, "1", "Digit1"] };
  const key = async (k, mods = 0, repeat = false) => {
    const [code, text, codeName] = KEYS[k];
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: String(k), code: codeName, windowsVirtualKeyCode: code, text: text || undefined, modifiers: mods, autoRepeat: repeat });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: String(k), code: codeName, windowsVirtualKeyCode: code, modifiers: mods });
    await sleep(60);
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable"); await send("CSS.enable"); await send("Accessibility.enable");
  const url = "file://" + path.resolve(pagePath);
  const load = async () => { await send("Page.navigate", { url }); await sleep(1200); await js("new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', r))"); await sleep(300); };
  const viewport = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await viewport(1280, 900);
  await load();

  const active = () => js(`(() => { const a = document.activeElement; return a ? (a.id ? '#' + a.id : a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).split(' ')[0] : '')) : 'none'; })()`);
  const axNodes = async () => (await send("Accessibility.getFullAXTree")).nodes;
  const prop = (n, name) => n.properties?.find((p) => p.name === name)?.value?.value;
  const turn = () => js("window.__ZURV_UI.G.state.meta.turn");
  const dialogOpen = () => js("!!document.querySelector('#modal-root dialog')");
  const OPENERS = `[...document.querySelectorAll('[data-screen]')].map((b) => b.getAttribute('data-screen')).concat(['#btn-settings', '#btn-new', '#btn-save', '#btn-load'])`;
  const setting = async (name, value) => {
    await js("document.querySelector('#btn-settings').click()");
    await sleep(80);
    await js(`document.querySelector('#set-${name}-${String(value).replace(/\W/g, "")}').click()`);
    await key("Escape");
    await sleep(80);
  };

  // ---------------- A. structure ----------------
  {
    const nodes = await axNodes();
    const live = (r) => nodes.filter((n) => !n.ignored && n.role?.value === r);
    const headings = live("heading");
    check("A", headings.filter((h) => prop(h, "level") === 1).length === 1, `exactly one h1 (found ${headings.filter((h) => prop(h, "level") === 1).length})`);
    for (const lm of ["banner", "main", "navigation"]) check("A", live(lm).length >= 1, `a ${lm} landmark`);
    const regions = live("region").map((n) => n.name?.value ?? "");
    check("A", JSON.stringify(regions) === JSON.stringify(["What do you do?"]), `the choices are the one named region — the scene is not one, or its title is spoken twice a turn (regions ${JSON.stringify(regions)})`);
    check("A", headings.some((h) => prop(h, "level") === 2 && /Day \d+/.test(h.name?.value ?? "")), "the scene has an h2 naming day, time and place");
    const dom = await js(`(() => {
      const ol = document.querySelector('#choices'); const items = ol ? [...ol.children] : [];
      return { ol: !!ol && ol.tagName === 'OL', items: items.length,
        buttons: items.filter((li) => li.tagName === 'LI' && li.children.length === 1 && li.firstElementChild.matches('button.choice')).length,
        pre: document.querySelectorAll('pre').length, popup: document.querySelectorAll('[aria-haspopup]').length,
        live: [...document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log]')].map((n) => n.id || n.className) };
    })()`);
    check("A", dom.ol && dom.items > 0 && dom.buttons === dom.items, `choices are an <ol> of ${dom.items} <li><button> (buttons ${dom.buttons})`);
    check("A", dom.pre === 0, "no <pre> on the page");
    check("A", dom.popup === 0 && !nodes.some((n) => prop(n, "hasPopup") && prop(n, "hasPopup") !== "false"),
      `no aria-haspopup anywhere — on a dialog trigger it flips Orca into focus mode and silences the next dialog (found ${dom.popup})`);
    check("A", JSON.stringify(dom.live.sort()) === JSON.stringify(["announcer", "toast"]), `live regions are exactly the announcer and the toast (found ${JSON.stringify(dom.live)})`);
    const unnamed = nodes.filter((n) => !n.ignored && prop(n, "focusable") === true && !(n.name?.value ?? "").trim() &&
      !["RootWebArea", "dialog", "heading", "region"].includes(n.role?.value));
    check("A", unnamed.length === 0, `every focusable control has an accessible name (unnamed: ${unnamed.map((n) => n.role?.value).join(", ") || "none"})`);
    const choiceNames = nodes.filter((n) => !n.ignored && n.role?.value === "button" && /\S, (free|1 hour|\d+ hours)$/.test(n.name?.value ?? ""));
    check("A", choiceNames.length === dom.items, `every choice button's name ends ", <cost in words>" (${choiceNames.length}/${dom.items})`);
    check("A", !nodes.some((n) => !n.ignored && /\b1 hours\b|\s,/.test(n.name?.value ?? "")), "no \"1 hours\", and no space before a comma in any name");
    // Tab reachability from a fresh load, nothing focused by script.
    const order = await js(`[...document.querySelectorAll('a.skip, #btn-new, #btn-save, #btn-load, #btn-settings, #choices .choice, [data-screen]')].map((n) => n.id ? '#' + n.id : n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0])`);
    await js("document.activeElement && document.activeElement.blur && document.activeElement.blur()");
    const stops = [];
    for (let i = 0; i < order.length; i += 1) { await key("Tab"); stops.push(await active()); }
    const at = stops.findIndex((s, k) => s !== order[k]);
    check("A", at === -1, `Tab alone reaches all ${order.length} controls in document order from a fresh load${at === -1 ? "" : ` (stop ${at}: got ${stops[at]}, expected ${order[at]})`}`);
  }

  // ---------------- B. a turn ----------------
  {
    await js("document.querySelector('#choices .choice').focus()");
    const t0 = await turn();
    await key("Enter");
    await sleep(450);
    const where = await active();
    check("B", where === "#scene-title" && (await turn()) === t0 + 1, `after a choice, focus is on the new scene heading (got ${where})`);
    const said = await js("document.querySelector('#announcer').textContent");
    check("B", /\b\d+ choices?\.$|The run is over\. Start a new run to play again\.$/.test(said), `the announcer carries the turn digest, ending in the choice count (${JSON.stringify(said.slice(-40))})`);

    // Two turns inside the 250 ms delay: the second digest must still cover the first turn's change.
    await setting("announce", "changes");
    await sleep(400);
    const lost = await js(`(async () => {
      const U = window.__ZURV_UI; const A = document.querySelector('#announcer');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const before = [...document.querySelectorAll('#scene .status li')].map((l) => l.textContent);
      const s = U.G.state;
      U.G.state = Object.assign({}, s, { player: Object.assign({}, s.player, { condition: Object.assign({}, s.player.condition, { needs: { hunger: 0, thirst: 95, fatigue: 0 } }) }) });
      document.querySelector('#choices .choice').click();
      const first = [...document.querySelectorAll('#scene .status li')].map((l) => l.textContent);
      document.querySelector('#choices .choice').click();   // the second turn, inside the delay
      const second = [...document.querySelectorAll('#scene .status li')].map((l) => l.textContent);
      await wait(500);
      return { said: A.textContent, fresh: first.filter((l) => !before.includes(l)), second };
    })()`);
    const shouldSay = lost.fresh.filter((l) => lost.second.includes(l));
    check("B", shouldSay.length > 0 && shouldSay.every((l) => lost.said.includes(l)),
      `two turns inside the announcer delay: a condition line new on the first turn is still spoken (${JSON.stringify(shouldSay)} in ${JSON.stringify(lost.said.slice(0, 90))})`);
    await setting("announce", "full");
    await js(`(() => { const U = window.__ZURV_UI; const s = U.G.state;   // put the thirst back, or the next turns kill the run
      U.G.state = Object.assign({}, s, { player: Object.assign({}, s.player, { condition: Object.assign({}, s.player.condition, { needs: { hunger: 0, thirst: 0, fatigue: 0 } }) }) }); U.render({}); })()`);
    check("B", !(await js("window.__ZURV_UI.G.over")), "the run is still alive for the next checks");

    // A turn and then, at once, a dialog: the digest must be spoken when the dialog closes, and focus go back.
    await js("document.querySelector('#choices .choice').focus()");
    await key("Enter");
    await key("i");
    await sleep(400);
    const duringDialog = await js("document.querySelector('#announcer').textContent");
    await key("Escape");
    await sleep(450);
    const afterDialog = await js("document.querySelector('#announcer').textContent");
    check("B", duringDialog === "" && /\d+ choices?\.$/.test(afterDialog), `a turn followed at once by a dialog is announced when the dialog closes (during: ${JSON.stringify(duringDialog)}, after: …${JSON.stringify(afterDialog.slice(-20))})`);
    const back = await active();
    check("B", back === "#scene-title", `closing a dialog opened from the focused scene heading puts focus back on the heading (got ${back})`);

    // A held digit key is one press.
    await js("document.activeElement.blur()");
    const t1 = await turn();
    await key(1); await key(1, 0, true); await key(1, 0, true); await key(1, 0, true);
    await sleep(200);
    const t2 = await turn();
    check("B", t2 === t1 + 1, `holding "1" (one press, three auto-repeats) takes exactly one turn (turn ${t1} → ${t2})`);

    // Start run: focus must not visit the New run button on its way to the new scene.
    await js("window.__focusLog = []; document.addEventListener('focusin', (e) => window.__focusLog.push(e.target.id || e.target.tagName), true)");
    await js("document.querySelector('#btn-new').focus()");
    await key("Enter");                     // opened FROM the button, so a native close() would hand focus back to it
    await sleep(100);
    await js("window.__focusLog = []; [...document.querySelectorAll('#modal-root dialog button')].find((b) => b.textContent === 'Start run').click()");
    await sleep(300);
    const log = await js("window.__focusLog");
    check("B", JSON.stringify(log) === JSON.stringify(["scene-title"]), `Start run moves focus straight to the new scene heading (focus visited ${JSON.stringify(log)})`);
  }

  // ---------------- C. dialogs ----------------
  const actorsNow = await js(RICH_STATE);
  let glyphTotal = 0; let continuationTotal = 0; let listTotal = 0;
  for (const which of await js(OPENERS)) {
    const sel = which.startsWith("#") ? which : `[data-screen="${which}"]`;
    await js(`document.querySelector('${sel}').focus()`);
    await js(`document.querySelector('#announcer').textContent = 'stale digest'; document.querySelector('#toast').textContent = 'stale toast'`);
    await key("Enter");
    await sleep(200);
    const st = await js(`(() => { const d = document.querySelector('#modal-root dialog'); if (!d) return null;
      const h = d.querySelector('h2'); return { open: d.open, modal: d.matches(':modal'), labelled: d.getAttribute('aria-labelledby') === (h && h.id), title: h ? h.textContent : '', pre: d.querySelectorAll('pre').length }; })()`);
    if (!st) { fail("C", `${which}: no dialog opened`); continue; }
    check("C", st.open && st.modal && st.labelled && st.pre === 0, `${which}: opens as a modal <dialog> named by its heading ("${st.title}"), no <pre> inside`);
    const nodes = await axNodes();
    const dlgAx = nodes.find((n) => !n.ignored && n.role?.value === "dialog");
    check("C", !!dlgAx && dlgAx.name?.value === st.title && prop(dlgAx, "modal") === true, `${which}: the accessibility tree has dialog "${st.title}" [modal]`);
    if (!which.startsWith("#")) {
      const want = await js(`(() => { const Z = window.Zurvival; const G = window.__ZURV_UI.G;
        const o = Z.outlineScreen(Z.renderDepthScreen('${which}', G.state, G.graph), Z.screenById('${which}'));
        const c = { heading: 0, list: 0, text: 0, items: 0, more: 0, glyphs: 0 };
        o.blocks.forEach((b) => { if (b.kind in c) c[b.kind] += 1; if (b.kind === 'list') b.items.forEach((it) => { c.items += 1; c.more += it.more.length;
          [it].concat(it.more).forEach((x) => { if (x.mark === '✗' || x.mark === '†') c.glyphs += 1; }); }); });
        return c; })()`);
      const got = await js(`(() => { const s = document.querySelector('#modal-root dialog .screen'); if (!s) return null;
        const glyphSpans = [...s.querySelectorAll('span')].filter((n) => /^[✗†] $/.test(n.textContent));
        return { heading: s.querySelectorAll('h3').length, list: s.querySelectorAll(':scope > ul').length, text: s.querySelectorAll(':scope > p').length,
          items: s.querySelectorAll(':scope > ul > li').length, more: s.querySelectorAll('li > .more').length,
          glyphs: glyphSpans.length, hidden: glyphSpans.filter((n) => n.getAttribute('aria-hidden') === 'true').length }; })()`);
      const same = !!got && ["heading", "list", "text", "items", "more", "glyphs"].every((k) => got[k] === want[k]);
      check("C", same, `${which}: renders its outline exactly (h3 ${got?.heading}/${want.heading}, ul ${got?.list}/${want.list}, p ${got?.text}/${want.text}, li ${got?.items}/${want.items}, continuations ${got?.more}/${want.more}, glyphs ${got?.glyphs}/${want.glyphs})`);
      const glyphNamed = nodes.filter((n) => !n.ignored && /[✗†]/.test(n.name?.value ?? "")).length;
      check("C", !!got && got.hidden === got.glyphs && glyphNamed === 0, `${which}: every ✗/† is aria-hidden (${got?.hidden}/${got?.glyphs}) and no accessible name contains one (${glyphNamed})`);
      glyphTotal += got?.glyphs ?? 0; continuationTotal += got?.more ?? 0; listTotal += got?.list ?? 0;
    }
    let escaped = null;
    for (let i = 0; i < 40 && escaped === null; i += 1) {
      await key("Tab", i % 3 === 2 ? 8 : 0);
      if (!(await js("!!document.activeElement && !!document.activeElement.closest('#modal-root dialog')"))) escaped = await active();
    }
    check("C", escaped === null, `${which}: 40 Tab/Shift+Tab presses never leave the dialog${escaped ? ` (escaped to ${escaped})` : ""}`);
    await key("Escape");
    await sleep(120);
    const after = await js(`({ open: !!document.querySelector('#modal-root dialog'), focus: document.activeElement === document.querySelector('${sel}'), live: document.querySelector('#announcer').textContent, toast: document.querySelector('#toast').textContent })`);
    check("C", !after.open, `${which}: Escape closes it`);
    check("C", after.focus, `${which}: focus returns to the control that opened it`);
    check("C", after.live === "" && after.toast === "", `${which}: neither live region holds stale text after it closes (it would be re-read)`);
  }
  check("C", actorsNow >= 2 && glyphTotal >= 3 && continuationTotal > 0 && listTotal > 0,
    `the dialog checks really met companions (${actorsNow}), ✗/† glyphs (${glyphTotal}), continuation lines (${continuationTotal}) and lists (${listTotal})`);

  // A press that starts inside a dialog and is released over the backdrop (selecting text in the Save box) is not a close.
  {
    await js("document.querySelector('#btn-save').click()");
    await sleep(150);
    const pts = await js(`(() => { const t = document.querySelector('#sv-data').getBoundingClientRect(); const d = document.querySelector('#modal-root dialog').getBoundingClientRect();
      return { x: t.left + 20, y: t.top + 20, bx: Math.max(2, d.left - 10), by: Math.max(2, d.top - 10) }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts.x, y: pts.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts.bx, y: pts.by, button: "left" });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.bx, y: pts.by, button: "left", clickCount: 1 });
    await sleep(120);
    const stillOpen = await dialogOpen();
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts.bx, y: pts.by, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.bx, y: pts.by, button: "left", clickCount: 1 });
    await sleep(120);
    const closedByBackdrop = !(await dialogOpen());
    check("C", stillOpen && closedByBackdrop, `a drag from inside the Save box out onto the backdrop does not close it (open: ${stillOpen}); a real backdrop click does (closed: ${closedByBackdrop})`);
    if (await dialogOpen()) { await key("Escape"); await sleep(80); }
  }

  // ---------------- D. shortcuts ----------------
  {
    await js("document.activeElement.blur()");
    await key("i");
    await sleep(120);
    const opened = await dialogOpen();
    check("D", opened, "with shortcuts on, \"i\" opens a depth screen");
    if (opened) { await key("Escape"); await sleep(100); }
    await setting("shortcuts", "off");
    await js("document.activeElement.blur()");
    const t0 = await turn();
    await key("i"); await key("n"); await key(1);
    await sleep(150);
    const openedOff = await dialogOpen();
    const t1 = await turn();
    check("D", !openedOff && t1 === t0, `with shortcuts off, "i", "n" and "1" do nothing (WCAG 2.1.4; dialog ${openedOff}, turn ${t0} → ${t1})`);
    if (openedOff) { await key("Escape"); await sleep(100); }
    const advertised = await js("document.querySelectorAll('[aria-keyshortcuts]').length");
    check("D", advertised === 0, `with shortcuts off, nothing advertises aria-keyshortcuts (${advertised})`);
    await setting("shortcuts", "on");
  }

  // ---------------- E. contrast ----------------
  const CONTRAST = fs.readFileSync(new URL("./a11y-contrast.js", import.meta.url), "utf8");
  const contrastPass = async (label, mustMeasure) => {
    const rows = await js(CONTRAST);
    const bad = rows.filter((r) => !r.pass);
    const missing = mustMeasure.filter((s) => !rows.some((r) => r.sel.includes(s)));
    check("E", bad.length === 0 && missing.length === 0,
      `${label}: ${rows.length} text styles clear AA${bad.length ? ` — FAIL: ${bad.map((b) => `${b.sel} "${b.text}" ${b.ratio}:1 < ${b.need}`).join("; ")}` : ""}${missing.length ? ` — NOT MEASURED: ${missing.join(", ")}` : ""}`);
  };
  const MAIN = ["h1.brand", "#meta", "#scene-title", "band-title", "li", "p", "span.label", "span.cost", ".prompt", "span.k", "screenbtn"];
  await contrastPass("standard", MAIN);
  {
    const doc = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#choices .choice" });
    await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
    await sleep(80);
    await contrastPass("a hovered choice", ["span.label", "span.cost", "span.num"]);
    await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  }
  await setting("contrast", "high");
  await contrastPass("high contrast", MAIN);
  await setting("contrast", "normal");
  await setting("font", "sans");
  await setting("spacing", "wide");
  await contrastPass("sans + wide spacing", MAIN);
  await setting("font", "serif");
  await setting("spacing", "normal");
  for (const which of await js(OPENERS)) {
    const sel = which.startsWith("#") ? which : `[data-screen="${which}"]`;
    await js(`document.querySelector('${sel}').click()`);
    await sleep(120);
    await contrastPass(`dialog ${which} open`, ["h2", "button"]);
    if (which === "#btn-load") {
      await js(`[...document.querySelectorAll('#modal-root dialog button')].find((b) => b.textContent === 'Load pasted').click()`);
      await sleep(80);
      await contrastPass("a Load error", ["p.msg.err"]);
      const ph = await js(`(() => { const t = document.querySelector('#ld-data'); t.value = '';
        const parse = (c) => c.match(/[\\d.]+/g).map(Number);
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const field = getComputedStyle(t); const sheet = getComputedStyle(t.closest('dialog'));
        return { placeholder: ratio(parse(getComputedStyle(t, '::placeholder').color), parse(field.backgroundColor)),
                 edge: Math.max(ratio(parse(field.borderTopColor), parse(sheet.backgroundColor)), ratio(parse(field.borderTopColor), parse(field.backgroundColor))) }; })()`);
      check("E", ph.placeholder >= 4.5, `placeholder text clears AA (${ph.placeholder.toFixed(2)}:1)`);
      check("E", ph.edge >= 3, `a text field's edge clears 3:1 against its surroundings — WCAG 1.4.11 (${ph.edge.toFixed(2)}:1)`);
    }
    await key("Escape");
    await sleep(80);
  }
  for (const kind of ["ok", "err"]) {
    await js(`document.querySelector('#toast').textContent = 'Error: could not take that action.'; document.querySelector('#toast').className = 'show ${kind}'`);
    await sleep(300);
    await contrastPass(`a toast (${kind})`, ["#toast"]);
  }
  await js("document.querySelector('#toast').textContent = ''; document.querySelector('#toast').className = ''");

  // ---------------- F. reflow ----------------
  {
    await setting("scale", 2);
    await viewport(320, 480, true);
    await sleep(400);
    const r = await js(`(() => {
      const vw = document.documentElement.clientWidth;
      const clipped = [...document.querySelectorAll('button, .choice .label, .story p, .status li')].filter((n) => {
        const b = n.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > vw + 1 || n.scrollWidth > n.clientWidth + 1);
      }).map((n) => (n.className || n.tagName) + ' ' + n.textContent.trim().slice(0, 20));
      return { over: document.documentElement.scrollWidth - vw, clipped, top: getComputedStyle(document.querySelector('#topbar')).position,
        bottom: getComputedStyle(document.querySelector('#screens')).position, scale: getComputedStyle(document.documentElement).fontSize };
    })()`);
    check("F", r.scale === "32px", `text is at 200% (root ${r.scale})`);
    check("F", r.over <= 1, `320px wide at 200% text: no horizontal scroll (overflow ${r.over}px)`);
    check("F", r.clipped.length === 0, `no control or text is clipped (${r.clipped.join(" | ") || "none"})`);
    check("F", r.top === "static" && r.bottom === "static", `a short viewport does not pin the bars over the story (top ${r.top}, bottom ${r.bottom})`);
    await js("document.querySelector('[data-screen=map]').click()");
    await sleep(150);
    const d = await js(`(() => { const d = document.querySelector('#modal-root dialog'); const b = d.getBoundingClientRect(); const vw = document.documentElement.clientWidth;
      return { fits: b.left >= -1 && b.right <= vw + 1, over: d.querySelector('.sheet').scrollWidth - d.querySelector('.sheet').clientWidth }; })()`);
    check("F", d.fits && d.over <= 1, `a depth screen fits 320px at 200% text (horizontal overflow ${d.over}px)`);
    await key("Escape");

    const covered = async (label) => {
      await js("document.activeElement.blur(); window.scrollTo(0, 0)");
      const n = await js("document.querySelectorAll('a.skip, button').length");
      const hidden = [];
      let measured = 0;
      for (let i = 0; i < n; i += 1) {
        await key("Tab");
        await sleep(40);
        const h = await js(`(() => { const a = document.activeElement; if (!a || a === document.body) return { skip: true };
          const b = a.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return { skip: true };
          const pts = [[b.left + Math.min(b.width / 2, 20), b.top + 2], [b.left + Math.min(b.width / 2, 20), b.bottom - 2]];
          const blocked = pts.some(([x, y]) => { if (y < 0 || y > innerHeight) return true; const e = document.elementFromPoint(x, y); return !e || !(a === e || a.contains(e)); });
          return { skip: false, blocked: blocked ? (a.id || a.className || a.tagName) + ' ' + a.textContent.trim().slice(0, 18) : null }; })()`);
        if (!h.skip) measured += 1;
        if (h.blocked) hidden.push(h.blocked);
      }
      check("F", hidden.length === 0 && measured > 10, `${label}: no Tab stop is covered by the pinned bars (${measured} stops; covered: ${hidden.join(" | ") || "none"})`);
    };
    await setting("scale", 1);
    await viewport(1280, 900);
    await covered("1280×900, text 100%");
    await viewport(400, 760, true);
    await covered("400×760, text 100%");
    await viewport(1366, 657);
    await setting("scale", 2);
    await covered("1366×657, text 200%");
    await setting("scale", 1);
    await viewport(1280, 900);
    await sleep(150);
  }

  // ---------------- G. targets ----------------
  {
    const measure = `(() => [...document.querySelectorAll('button, select, textarea, input[type=text], label.opt, label.check')]
      .filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !n.closest('.sr-only'); })
      .filter((n) => !document.querySelector('#modal-root dialog') || n.closest('#modal-root dialog'))
      .map((n) => { const b = n.getBoundingClientRect(); return { n: (n.id ? '#' + n.id : n.className || n.tagName) + ' ' + (n.textContent || '').trim().slice(0, 16), h: Math.round(b.height), w: Math.round(b.width) }; })
      .filter((x) => x.h < 44 || x.w < 44))()`;
    const small = [...await js(measure)];
    let measuredDialogs = 0;
    for (const which of await js(OPENERS)) {
      const sel = which.startsWith("#") ? which : `[data-screen="${which}"]`;
      await js(`document.querySelector('${sel}').click()`);
      await sleep(100);
      if (await dialogOpen()) measuredDialogs += 1;
      small.push(...(await js(measure)).map((x) => ({ ...x, n: `${which}: ${x.n}` })));
      await key("Escape");
      await sleep(60);
    }
    check("G", small.length === 0 && measuredDialogs === 9, `every control is at least 44×44 CSS px, on the page and in all ${measuredDialogs} dialogs (${small.map((x) => `${x.n} ${x.w}×${x.h}`).join("; ") || "all pass"})`);
  }

  // ---------------- H. motion + forced colours ----------------
  {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await js("document.querySelector('#toast').textContent = 'x'; document.querySelector('#toast').className = 'show ok'");
    const moving = await js(`[...document.querySelectorAll('*')].filter((n) => { const s = getComputedStyle(n);
      const dur = (v) => v.split(',').some((x) => parseFloat(x) > 0); return dur(s.transitionDuration) || (s.animationName !== 'none' && dur(s.animationDuration)); }).map((n) => n.id || n.className || n.tagName)`);
    check("H", moving.length === 0, `under prefers-reduced-motion nothing transitions or animates (${moving.join(", ") || "none"})`);
    await send("Emulation.setEmulatedMedia", { features: [] });
    const movingNormally = await js(`[...document.querySelectorAll('*')].filter((n) => parseFloat(getComputedStyle(n).transitionDuration) > 0).length`);
    check("H", movingNormally > 0, `…and the check can fail: without the preference, ${movingNormally} element(s) do transition`);
    await js("document.querySelector('#toast').textContent = ''; document.querySelector('#toast').className = ''");

    await send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    await sleep(150);
    await js("document.querySelector('#choices .choice').focus()");
    await key("Tab"); await key("Tab", 8);
    const fc = await js(`(() => { const c = document.querySelector('#choices .choice'); const s = getComputedStyle(c); const f = getComputedStyle(document.activeElement);
      return { forced: matchMedia('(forced-colors: active)').matches, border: s.borderTopStyle + ' ' + s.borderTopWidth, outline: f.outlineStyle + ' ' + f.outlineWidth,
        buttons: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).borderTopStyle === 'none').length }; })()`);
    check("H", fc.forced, "forced colours emulated");
    check("H", /^solid [1-9]/.test(fc.border) && fc.buttons === 0, `under forced colours every button keeps a visible border (choice ${fc.border}; borderless buttons ${fc.buttons})`);
    check("H", /^solid [1-9]/.test(fc.outline), `under forced colours the keyboard focus ring is drawn (${fc.outline})`);
    await send("Emulation.setEmulatedMedia", { features: [] });
  }

  // ---------------- B/E (last). the end of a run ----------------
  {
    const armed = await js(`(() => { const U = window.__ZURV_UI; let prev = null, lab = null;
      for (let i = 0; i < 800; i++) { const bs = [...document.querySelectorAll('.choice')]; if (!bs.length) break;
        const b = bs.find((x) => /Rest/.test(x.textContent)) || bs[bs.length - 1]; prev = U.G.state; lab = b.getAttribute('data-choice'); b.click();
        if (document.querySelector('.ended')) { U.G.state = prev; U.render({}); document.querySelector('[data-choice="' + lab + '"]').focus(); return true; } }
      return false; })()`);
    check("B", armed, "a run was played to one turn before its end");
    if (armed) {
      await key("Enter");
      await sleep(450);
      const where = await active();
      check("B", where === "#choices-title", `the last turn puts focus on "The run is over." (got ${where})`);
      const ring = await js("getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth");
      check("B", /^solid [1-9]/.test(ring), `…and that keyboard-driven focus is visible (outline ${ring})`);
      await key("i");
      await sleep(150);
      await key("Escape");
      await sleep(150);
      const back = await active();
      check("B", back === "#choices-title", `a depth screen opened from "The run is over." gives focus back to that heading, not the scene's (got ${back})`);
      await contrastPass("the run-over panel", ["h2#choices-title", "p.hint"]);
    }
  }

  // ---------------- I. persistence ----------------
  {
    await load();
    await js("document.querySelector('#choices .choice').click()");
    await setting("scale", 1.5);
    const turnBefore = await turn();
    await load();
    const after = await js("({ scale: window.__ZURV_UI.settings.scale, root: getComputedStyle(document.documentElement).fontSize, turn: window.__ZURV_UI.G.state.meta.turn })");
    check("I", after.scale === 1.5 && after.root === "24px", `reader settings survive a reload (scale ${after.scale}, root ${after.root})`);
    check("I", turnBefore > 0 && after.turn === 0, `the run does not (turn ${turnBefore} before, ${after.turn} after)`);
  }

  check("page", pageErrors.length === 0, `no uncaught page errors (${pageErrors.join(" | ") || "none"})`);
  ws.close();
  exitCode = failures.length === 0 ? 0 : 1;
} catch (err) {
  fail("harness", err instanceof Error ? err.stack ?? err.message : String(err));
  exitCode = 1;
} finally {
  chrome.kill("SIGKILL");
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

for (const p of passes) console.log(`  ✓ ${p}`);
for (const f of failures) console.log(`  ✗ ${f}`);
const out = flag("--json");
if (out) fs.writeFileSync(out, JSON.stringify({ passes, failures }, null, 1));
console.log(failures.length === 0
  ? `✓ web client a11y check OK — ${passes.length} assertions`
  : `✗ web client a11y check FAILED — ${failures.length} of ${passes.length + failures.length} assertions`);
process.exit(exitCode);
