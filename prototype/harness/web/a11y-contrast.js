/* Rendered-text contrast audit, evaluated inside the page by a11y-check.mjs (T63). For every visible text node:
   the computed colour, composited through ancestor opacity over the element's actual stacked background
   (every semi-transparent ancestor background, down to the root), against WCAG 2.x — 4.5:1, or 3:1 for large
   text (≥ 24px, or ≥ 18.66px bold). When a modal dialog is open only its contents are audited: the page behind
   sits under the backdrop and is inert. One row per distinct (selector, colour, size). */
(() => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
  const base0 = rootBg && rootBg.a === 1 ? rootBg : { r: 14, g: 15, b: 16, a: 1 };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let b = base0;
    for (let i = stack.length - 1; i >= 0; i -= 1) b = over(stack[i], b);
    return b;
  };
  const scope = document.querySelector("#modal-root dialog[open]") || document.body;
  const rows = []; const seen = new Set();
  const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let t; (t = w.nextNode());) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (el.closest(".sr-only, [hidden], script, style, noscript")) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.closest(".skip") && r.bottom < 0) continue; // an unfocused skip link, parked above the viewport
    let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    if (op === 0) continue;
    const bg = bgOf(el);
    const fg0 = parse(s.color);
    const fg = over({ ...fg0, a: fg0.a * op }, bg);
    const px = parseFloat(s.fontSize); const bold = Number(s.fontWeight) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const cr = ratio(fg, bg); const need = large ? 3 : 4.5;
    const sel = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
    const key = sel + "|" + s.color + "|" + bg.r + "," + bg.g + "," + bg.b + "|" + Math.round(px);
    if (seen.has(key)) continue; seen.add(key);
    rows.push({ sel, text: t.textContent.trim().slice(0, 30), px: Math.round(px * 10) / 10, ratio: Math.round(cr * 100) / 100, need, pass: cr + 1e-9 >= need });
  }
  return rows;
})()
