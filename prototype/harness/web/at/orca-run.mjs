/**
 * Real-assistive-technology verification (T63 · NFR-ACC-02 · ACCESSIBILITY §12 "manual, per milestone").
 *
 *   node orca-run.mjs web <scenario.json> <out.md> --page <built.html>
 *   node orca-run.mjs cli <scenario.json> <out.md> [--harness <prototype/harness dir>]
 *
 * Drives ORCA — the GNOME screen reader, a real AT, not a simulation — against the real clients: the built web
 * page in Chromium over AT-SPI, or the terminal client (`playCli.ts`) in a VTE terminal. Keys are real X events
 * (xdotool). What Orca SAID is read back from its own debug log (`SPEECH OUTPUT: '…'`, the exact string it hands
 * the speech synthesiser), and for the web client, where DOM focus landed (DevTools protocol). Each scenario
 * step may carry `expect` / `forbid` substrings (or `/regex/`) matched against that step's speech, `focus` — a CSS
 * selector the focused element must match — and `assertJs`, an expression the page must make true. The run writes a markdown transcript and exits 1 if
 * any expectation fails, so a transcript is evidence, not a recording someone has to believe.
 *
 * Needs the stack from start-stack.sh (Xvfb, a session bus, AT-SPI, Orca with --debug-file). NOT run in CI —
 * see README.md. The part of this a CI runner CAN repeat is web/a11y-check.mjs.
 *
 * Timing: Orca speaks asynchronously. After each step the runner waits for the log to go QUIET (no new bytes for
 * `quietMs`, default 900) up to `wait` ms, so a step's speech is attributed to that step rather than the next.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const [mode, scenarioPath, outPath] = process.argv.slice(2);
const opt = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
if (!["web", "cli"].includes(mode) || !scenarioPath || !outPath) {
  console.error("usage: node orca-run.mjs web|cli <scenario.json> <out.md> [--page built.html] [--harness dir] [--at-dir dir]");
  process.exit(2);
}
const AT = opt("--at-dir", process.env.ZURV_AT_DIR ?? "/tmp/zurv-at");
const LOG = path.join(AT, "orca-debug.out");
const envFile = path.join(AT, "dbus.env");
if (!fs.existsSync(LOG) || !fs.existsSync(envFile)) {
  console.error(`no running AT stack in ${AT} — run start-stack.sh first`);
  process.exit(2);
}
// A UTF-8 locale, or the terminal decodes the client's "—" and "·" as Latin-1 and Orca reads the mojibake aloud.
const env = { ...process.env, DISPLAY: ":99", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
for (const m of fs.readFileSync(envFile, "utf8").matchAll(/^(\w+)='?([^';\n]*)'?;?$/gm)) env[m[1]] = m[2];
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const size = () => fs.statSync(LOG).size;
// Orca writes the utterance with plain single quotes around it (inner quotes unescaped), then the voice dict.
const speechBetween = (a, b) => [...fs.readFileSync(LOG).subarray(a, b).toString("utf8")
  .replace(/\r/g, "").matchAll(/SPEECH OUTPUT: '([\s\S]*?)' \{'established'/g)].map((m) => m[1].replace(/\n\s{10,}/g, "\n"));
async function quiet(maxMs, quietMs = 900) {
  const t0 = Date.now(); let last = size(); let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(100);
    const s = size();
    if (s !== last) { last = s; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
  }
}
const matches = (said, pat) => pat.startsWith("/") && pat.lastIndexOf("/") > 0
  ? new RegExp(pat.slice(1, pat.lastIndexOf("/")), pat.slice(pat.lastIndexOf("/") + 1)).test(said)
  : said.includes(pat);
const xdo = (...a) => execFileSync("xdotool", a, { env });

let proc = null;
const launchOffset = size();
let evalJs = null;
if (mode === "web") {
  const page = path.resolve(opt("--page", ""));
  if (!fs.existsSync(page)) { console.error("--page <built.html> is required for web mode"); process.exit(2); }
  const chrome = opt("--chrome", process.env.CHROME_BIN ?? "chromium");
  const port = 9300 + Math.floor(Math.random() * 500);
  proc = spawn(chrome, ["--no-sandbox", "--force-renderer-accessibility", "--no-first-run", "--disable-gpu",
    `--user-data-dir=${fs.mkdtempSync(path.join(AT, "chrome-"))}`, "--window-size=1280,900", `--remote-debugging-port=${port}`, `file://${page}`],
    { env, stdio: "ignore" });
  let list = null;
  for (let i = 0; i < 60 && !list; i += 1) { await sleep(250); try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ } }
  const target = list.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  evalJs = (expression) => new Promise((r) => { const i = ++id; pend.set(i, (res) => r(res?.result?.value));
    ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } })); });
  await quiet(15000, 2500); // the page loads and Orca finishes its "Finished loading" pass
} else {
  const harness = path.resolve(opt("--harness", path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..")));
  proc = spawn("xfce4-terminal", ["--disable-server", "--geometry=120x40", "-x", "bash", "-c", `cd '${harness}' && npx tsx src/playCli.ts; sleep 3600`],
    { env, stdio: "ignore" });
  await quiet(30000, 3000);
}

const lines = [`# ${scenario.title}`, "", `Screen reader: Orca (${execFileSync("python3.12", ["/usr/bin/orca", "--version"], { env }).toString().trim()}) · client: ${mode === "web" ? "web page in Chromium over AT-SPI" : "terminal client in xfce4-terminal (VTE)"} · ${new Date().toISOString().slice(0, 10)}`, "", scenario.about ?? "", ""];
let failed = 0;
for (const step of scenario.steps) {
  if (step.js) { await evalJs(step.js); await quiet(step.wait ?? 4000); continue; }
  const a = step.fromLaunch ? launchOffset : size();
  if (step.type) { xdo("type", "--delay", "60", step.type); await sleep(step.gap ?? 250); }
  for (const k of step.keys ?? []) { xdo("key", "--clearmodifiers", k); await sleep(step.gap ?? 250); }
  await quiet(step.wait ?? 6000, step.quietMs ?? 900);
  const said = speechBetween(a, size());
  const joined = said.join(" ‖ ");
  lines.push(`### ${step.label}`, "", `keys: \`${[...(step.type ? [`type "${step.type}"`] : []), ...(step.keys ?? [])].join(" ") || "—"}\``);
  if (evalJs) {
    const focus = await evalJs(`(() => { const a = document.activeElement; if (!a) return 'none'; return a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.getAttribute('data-choice') ? '[data-choice=' + a.getAttribute('data-choice') + ']' : '') + ' — ' + JSON.stringify((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60)); })()`);
    lines.push("", `focus → ${focus}`);
    if (step.focus) {
      const ok = await evalJs(`!!document.activeElement && document.activeElement.matches(${JSON.stringify(step.focus)})`);
      lines.push(`- ${ok ? "PASS" : "**FAIL**"} focus matches \`${step.focus}\``); if (!ok) failed += 1;
    }
  }
  lines.push("", "Orca said:", "", ...(said.length ? said.map((t) => "> 🔊 " + t.replace(/\n/g, "\n> ")) : ["> (nothing)"]), "");
  for (const p of step.expect ?? []) { const ok = matches(joined, p); lines.push(`- ${ok ? "PASS" : "**FAIL**"} said \`${p}\``); if (!ok) failed += 1; }
  for (const p of step.forbid ?? []) { const ok = !matches(joined, p); lines.push(`- ${ok ? "PASS" : "**FAIL**"} never said \`${p}\``); if (!ok) failed += 1; }
  if (step.assertJs && evalJs) {
    const ok = await evalJs(`!!(${step.assertJs})`);
    lines.push(`- ${ok ? "PASS" : "**FAIL**"} page check \`${step.assertJs}\``); if (!ok) failed += 1;
  }
  if (step.note) lines.push("", `_${step.note}_`);
  lines.push("");
}
lines.push("---", "", failed === 0 ? "**All expectations held.**" : `**${failed} expectation(s) FAILED.**`, "");
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"));
try { proc.kill("SIGKILL"); } catch { /* gone */ }
if (mode === "cli") { try { execFileSync("pkill", ["-x", "xfce4-terminal"]); } catch { /* none */ } }
console.log(`${outPath}: ${failed === 0 ? "all expectations held" : failed + " FAILED"}`);
process.exit(failed === 0 ? 0 : 1);
