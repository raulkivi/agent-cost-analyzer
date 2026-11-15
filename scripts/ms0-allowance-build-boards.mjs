// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
/* global console */
// Writes the MS0 boards (*.dc.html) in docs/plans/mockups/monthly-allowance-standalone/. Static markup only; the
// tokens are copied from packages/web/src/theme.css (ledger light and dark).
// Run: node scripts/ms0-allowance-build-boards.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "plans", "mockups", "monthly-allowance-standalone");

const CSS = `
body{margin:0}
.ap{box-sizing:border-box;font-family:"Commit Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;color:var(--text);background:var(--bg)}
.ap *{box-sizing:border-box}
.ap h1,.ap h2,.ap h3,.ap h4,.ap p,.ap dl,.ap dd,.ap ul,.ap ol{margin:0;padding:0}
.ap[data-m="light"]{--bg:#ebe7e4;--surf:#f4f2f0;--text:#252f3d;--mut:#5c5752;--acc:#5b7698;--acct:#4b607c;--accf:#4b607c;--acc100:#dde3ea;--acc800:#34445a;--div:rgba(139,132,125,.4);--ctl:#7d766f;--n100:#e2ddd9;--n800:#45413d;--scrim:rgba(46,43,41,.5);--warn:#a67400;--err:#d6453d;--inv:#e34948;--board:#cfc9c4}
.ap[data-m="dark"]{--bg:#161d27;--surf:#212730;--text:#ebe7e4;--mut:#9fa4ab;--acc:#6a9fcc;--acct:#7aaad4;--accf:#6a9fcc;--acc100:#243246;--acc800:#b3cde6;--div:rgba(73,80,89,.5);--ctl:#6b737e;--n100:#252f3d;--n800:#c9cdd1;--scrim:rgba(11,15,20,.5);--warn:#e8993a;--err:#e8704f;--inv:#e8704f;--board:#0e131b}
.ap .mut{color:var(--mut)}.ap .s2{font-size:11px}.ap .mr{margin-right:auto}
.ap .cap{font-size:11px;color:var(--mut);margin:0 0 5px}
.ap .sec{padding:18px 24px 22px;display:flex;flex-direction:column;gap:14px;background:var(--board)}
.ap .sec>h2{font-size:15px;font-weight:700;margin:0 0 2px}
.ap .strip{background:var(--bg);border:1px solid var(--div)}
.ap .hdr{display:flex;align-items:center;gap:8px;padding:4px 8px;min-height:38px;flex-wrap:wrap}
.ap .nw .hdr{flex-wrap:nowrap}
.ap .nw .brand,.ap .nw .seg,.ap .nw .tag,.ap .nw .fld{flex:none}
.ap .brand{display:flex;align-items:center;gap:6px;font-weight:700;font-size:18px;letter-spacing:-.015em;white-space:nowrap}
.ap .logo{position:relative;width:24px;height:24px;background:var(--acc800);flex:none;display:inline-block}
.ap .logo::after{content:"";position:absolute;inset:-3px;border:1px solid var(--acc);opacity:.7}
.ap .seg{display:inline-flex;border:1px solid var(--ctl);overflow:hidden;white-space:nowrap}
.ap .seg>span{padding:3px 10px;font-size:12px}
.ap .seg>.on,.ap[data-m="light"] .seg>.lt,.ap[data-m="dark"] .seg>.dk{background:var(--accf);color:var(--bg)}
.ap .fld{display:flex;align-items:center;gap:4px;margin-left:4px}
.ap .inp{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:3px 8px;font-size:13px;background:var(--surf);border:1px solid var(--ctl);white-space:nowrap;color:var(--text)}
.ap .inp.bad{border-color:var(--inv);box-shadow:inset 0 0 0 1px var(--inv)}
.ap .inp.num{width:100%}
.ap .stat{font-size:11px;margin-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.ap .tag{display:inline-flex;align-items:center;font-size:11px;letter-spacing:.02em;padding:3px 10px;background:var(--n100);color:var(--n800);white-space:nowrap}
.ap .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-weight:700;font-size:13px;line-height:1.2;color:var(--text);background:transparent;border:1px solid var(--ctl);padding:4px 10px;white-space:nowrap}
.ap .btn.p{background:var(--accf);border-color:var(--accf);color:var(--bg)}
.ap .btn.g{border-color:transparent;color:var(--acct)}
.ap .btn.dis{opacity:.45}
.ap .btn.foc,.ap .inp.foc{outline:2px solid var(--acc);outline-offset:1px}
.ap .gauge{font-size:12px;font-weight:400;min-height:26px;flex:none}
.ap .nw .srcsel{max-width:150px}
.ap .n3{overflow:hidden}
.ap .n3 .gauge,.ap .n3 .gauge .gt{white-space:normal;text-align:left}
.ap .n3 .srcsel{max-width:210px}
.ap .n3 .gauge{flex:1 1 100%;justify-content:flex-start}
.ap .srcsel{display:block;line-height:18px;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ap .gauge .gt{overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ap .gauge .gt b{font-weight:700}
.ap .gauge.unset{color:var(--mut);border-color:var(--div);font-weight:400}
.ap .mtr{--c:var(--acc);position:relative;display:inline-block;flex:none;width:56px;height:10px;border:1px solid var(--ctl);background:var(--surf)}
.ap .mtr.near{--c:var(--warn)}.ap .mtr.over{--c:var(--err)}
.ap .mtr .fill{position:absolute;left:0;top:0;bottom:0;width:calc(var(--p)*1%);background:var(--c)}
.ap .mtr .open{position:absolute;top:0;bottom:0;left:calc(var(--p)*1%);width:12px;max-width:calc(100% - var(--p)*1%);background:repeating-linear-gradient(135deg,var(--c) 0 1px,transparent 1px 4px);border-left:1px dashed var(--c)}
.ap .mtr .th{position:absolute;top:-3px;bottom:-3px;left:calc(var(--w)*1%);width:1px;background:var(--text)}
.ap .mtr .cap2{position:absolute;right:-5px;top:-3px;bottom:-3px;width:3px;background:var(--c)}
.ap .mtr.big{display:block;width:100%;height:12px}
.ap .scale{position:relative;height:14px;font-size:10px;color:var(--mut);margin-top:4px}
.ap .scale span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.ap .scale span:first-child{transform:none}.ap .scale span:last-child{transform:translateX(-100%)}
.ap .tile{background:var(--scrim);padding:18px;display:flex;justify-content:center;align-items:flex-start;border:1px solid var(--div)}
.ap .dlg{width:100%;background:var(--bg);border:1px solid var(--div);padding:12px 14px;display:flex;flex-direction:column;gap:9px}
.ap .dlg h3{font-size:18px;font-weight:700;letter-spacing:-.015em}
.ap .dlg h4{font-size:12px;font-weight:700;margin:4px 0 0}
.ap .dlg .lead{font-size:14px;font-variant-numeric:tabular-nums}
.ap .dlg .lead b{font-weight:700}
.ap .kv{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;font-size:12px;font-variant-numeric:tabular-nums}
.ap .kv dt{color:var(--mut)}.ap .kv dd{margin:0}
.ap .prose{font-family:"Source Serif 4",Georgia,serif;font-size:14px;line-height:1.45}
.ap .tbl{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.ap .tbl th{text-align:left;font-weight:700;padding:3px 4px;border-bottom:1px solid var(--ctl);font-size:11px;color:var(--mut)}
.ap .tbl td{padding:3px 4px;border-bottom:1px solid var(--div)}
.ap .tbl .r,.ap .tbl th.r{text-align:right}
.ap .lst{font-size:11px;color:var(--mut);list-style:none;display:flex;flex-direction:column;gap:2px}
.ap .lst li::before{content:"\\2013  "}
.ap .acts{display:flex;justify-content:flex-end;gap:6px;margin-top:4px;flex-wrap:wrap}
.ap .field{display:flex;flex-direction:column;gap:4px}
.ap .field>label{font-size:12px;color:var(--mut)}
.ap .ferr{font-size:12px;font-weight:700}.ap .ferr::before{content:"\\2715  "}
.ap .note{border:1px solid var(--ctl);padding:6px 8px;font-size:12px;background:var(--surf)}
.ap table.a{width:100%;border-collapse:collapse;font-size:12px}
.ap table.a th{text-align:left;padding:5px 8px;border-bottom:1px solid var(--ctl);color:var(--mut);font-size:11px}
.ap table.a td{padding:6px 8px;border-bottom:1px solid var(--div);vertical-align:top}
.ap .step{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid var(--ctl);border-radius:50%;font-size:11px;font-style:normal;background:var(--bg);flex:none}
.ap .ol{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;align-items:center}
.ap .ol>span{display:inline-flex;align-items:center;gap:5px}
`;

const NF = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AL = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// Gauge states of plan 4.7. level: ok | near | over; partial = "at least".
const STATES = {
  normal: { label: "Normal", used: 312.4, level: "ok" },
  near: { label: "Near limit", used: 812.4, level: "near" },
  over: { label: "Over", used: 1042.1, level: "over" },
  partialOk: { label: "Partial, normal", used: 312.4, level: "ok", partial: true },
  partialNear: { label: "Partial, near limit", used: 812.4, level: "near", partial: true },
  partialOver: { label: "Partial, over", used: 1042.1, level: "over", partial: true },
  unknown: { label: "Unknown", kind: "unknown" },
  none: { label: "No sessions this month", kind: "none" },
  nosrc: { label: "No Copilot logs", kind: "nosrc" },
  unset: { label: "Not set", kind: "unset" },
};
const ALLOW = 1000;
const WARN = 80;

function meter(s, { big = false } = {}) {
  const p = Math.min(100, Math.floor((s.used / ALLOW) * 100));
  const over = s.level === "over";
  const cls = `mtr ${s.level === "ok" ? "" : s.level} ${big ? "big" : ""}`.trim();
  return `<span class="${cls}" aria-hidden="true" style="--p:${over ? 100 : p};--w:${WARN}"><i class="fill"></i>${s.partial ? '<i class="open"></i>' : ""}<i class="th"></i>${over ? '<i class="cap2"></i>' : ""}</span>`;
}

function gaugeText(s, levelWord = "full") {
  if (s.kind === "unknown") return "AI Credits this month: unknown";
  if (s.kind === "none") return "No sessions this month";
  if (s.kind === "nosrc") return "AI Credits this month: no Copilot logs";
  const base = `${s.partial ? "at least " : ""}${NF(s.used)} of ${AL(ALLOW)} AI Credits`;
  if (levelWord === "none" || s.level === "ok") return base;
  if (levelWord === "short") return `${base} · <b>${s.level === "over" ? "over" : "near"}</b>`;
  return `${base} · <b>${s.level === "over" ? "over" : "near limit"}</b>`;
}

function gauge(s, { meterOn = true, focus = false, levelWord = "full", meterBelow = false } = {}) {
  const foc = focus ? " foc" : "";
  if (s.kind === "unset") {
    return `<button class="btn gauge unset${foc}" aria-haspopup="dialog"><span class="gt">Set monthly allowance</span></button>`;
  }
  const withMeter = meterOn && !s.kind;
  const text = `<span class="gt">${gaugeText(s, levelWord)}</span>`;
  if (meterBelow && withMeter) {
    return `<button class="btn gauge${foc}" aria-haspopup="dialog" style="flex-direction:column;align-items:flex-start;gap:4px;width:100%">${text}${meter(s)}</button>`;
  }
  return `<button class="btn gauge${foc}" aria-haspopup="dialog">${text}${withMeter ? meter(s) : ""}</button>`;
}

function header({ gaugeHtml = "", learn = false } = {}) {
  const src = learn
    ? ""
    : `<label class="fld"><span class="mut s2">Source</span><span class="inp srcsel">VS Code (local Copilot Chat) ▾</span></label>`;
  return `<div class="hdr"><div class="brand"><i class="logo"></i>Agent Cost Analyzer</div><div class="mr"></div>
<span class="seg"><span${learn ? ' class="on"' : ""}>Learn</span><span${learn ? "" : ' class="on"'}>Analyze</span></span>${src}${learn ? "" : gaugeHtml}
<label class="fld"><span class="mut s2">Retention</span><span class="inp" style="width:6em">200</span></label>
<span class="mut stat">status: ok · v0.14.0</span>
<span class="seg"><span>Auto</span><span class="lt">Light</span><span class="dk">Dark</span></span><span class="tag">Config ✓</span></div>`;
}

const sect = (mode, title, inner) => `<div class="ap sec" data-m="${mode}"><h2>${title}</h2>${inner}</div>`;

function page(title, width, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>${CSS}</style>
</helmet>
<div style="width:${width}px">${body}</div>
</x-dc>
</body>
</html>
`;
}

const strip = (w, inner) => `<div class="strip${w >= 1440 ? " nw" : w <= 768 ? " n3" : ""}" style="width:${w}px">${inner}</div>`;

// ---------- Header board ----------
function headerBoard() {
  const order = ["normal", "near", "over", "partialOk", "partialNear", "partialOver", "unknown", "none", "nosrc", "unset"];
  const row = (cap, html) => `<div><p class="cap">${cap}</p>${html}</div>`;
  const mk = () => {
    let h = "";
    for (const k of order) h += row(STATES[k].label, strip(1440, header({ gaugeHtml: gauge(STATES[k]) })));
    h += row("Near limit, keyboard focus on the gauge", strip(1440, header({ gaugeHtml: gauge(STATES.near, { focus: true }) })));
    h += row("Not set, keyboard focus", strip(1440, header({ gaugeHtml: gauge(STATES.unset, { focus: true }) })));
    h += row("Learn mode: no gauge, no source select (D4)", strip(1440, header({ learn: true })));
    h +=
      row(
        "Alternative without the meter: near limit; at least, near limit",
        strip(1440, header({ gaugeHtml: gauge(STATES.near, { meterOn: false }) })) +
          `<div style="height:8px"></div>` +
          strip(1440, header({ gaugeHtml: gauge(STATES.partialNear, { meterOn: false }) })),
      );
    return h;
  };
  return page(
    "Monthly allowance: header",
    1488,
    sect("light", "Header at 1440 px, Analyze mode, ledger light", mk()) + sect("dark", "Header at 1440 px, Analyze mode, ledger dark", mk()),
  );
}

// ---------- Details board ----------
const HARNESS = { chat: "Copilot Chat", host: "Agent Host and Copilot CLI" };
const days = (n) => (n === 1 ? "1 day left" : `${n} days left`);
const PERIOD1 = "2026-11-01 to 2026-11-30 (Europe/Tallinn)";
const PERIOD15 = "2026-11-15 to 2026-12-14 (Europe/Tallinn)";
const MISSING = `<h4>Not counted</h4><ul class="lst"><li>Sessions whose logs Copilot already pruned.</li><li>Spend made elsewhere: github.com chat, the cloud agent, other machines.</li><li>A session counts wholly in the period it started in.</li><li>Claude Code, pi and mitmproxy sessions record no AI Credits.</li></ul>`;
const DACTS = `<div class="acts"><button class="btn g">Recount</button><button class="btn">Change allowance</button><button class="btn p foc">Close</button></div>`;
const SCALE = `<div class="scale"><span style="left:0">0</span><span style="left:${WARN}%">${WARN} %</span><span style="left:100%">100 %</span></div>`;
const harness = (rows) =>
  `<h4>By harness</h4><table class="tbl"><thead><tr><th>Harness</th><th class="r">Cost data</th><th class="r">AI Credits</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${r[0]}</td><td class="r">${r[1]}</td><td class="r">${r[2]}</td></tr>`)
    .join("")}</tbody></table>`;
const kv = (pairs) => `<dl class="kv">${pairs.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`;
const ONLY = `<p class="prose">Only sessions recorded on this machine are counted.</p>`;

function detailsBody(k) {
  const s = STATES[k];
  const lead = `<p class="lead">${gaugeText(s)}</p>`;
  const big = `${meter(s, { big: true })}${SCALE}`;
  switch (k) {
    case "near":
      return `${lead}${big}${kv([["Used", "81 % of the allowance used"], ["Remaining", "Up to 187.60 AI Credits remain"], ["Warn at", "80 % of the allowance"], ["Days left", days(12)], ["Period", PERIOD1], ["Coverage", "20 of 20 sessions this month have cost data"], ["Oldest counted", "2026-11-01"], ["Source", "VS Code Insiders"]])}${harness([[HARNESS.chat, "14 of 14", "640.10"], [HARNESS.host, "6 of 6", "172.30"]])}${ONLY}${MISSING}${DACTS}`;
    case "over":
      return `${lead}${big}${kv([["Used", "104 % of the allowance used"], ["Remaining", "No AI Credits remain"], ["Warn at", "80 % of the allowance"], ["Days left", days(26)], ["Period", PERIOD15], ["Reset day", "15"], ["Coverage", "9 of 9 sessions this month have cost data"], ["Oldest counted", "2026-11-15"], ["Source", "VS Code"]])}${harness([[HARNESS.chat, "9 of 9", "1,042.10"], [HARNESS.host, "0 of 0", "none"]])}${ONLY}${MISSING}${DACTS}`;
    case "partialNear":
      return `${lead}${big}${kv([["Used", "At least 81 % of the allowance used"], ["Remaining", "Up to 187.60 AI Credits remain"], ["Warn at", "80 % of the allowance"], ["Days left", days(12)], ["Period", PERIOD1], ["Coverage", "13 of 20 sessions this month have cost data"], ["Oldest counted", "2026-11-03"], ["Source", "VS Code Insiders"]])}<div class="note">The total may be higher: sessions without cost data are not counted.</div>${harness([[HARNESS.chat, "8 of 14", "at least 540.10"], [HARNESS.host, "5 of 6", "at least 272.30"]])}${ONLY}${MISSING}${DACTS}`;
    case "unknown":
      return `${lead}${kv([["Allowance", "1,000 AI Credits"], ["Days left", days(12)], ["Period", PERIOD1], ["Coverage", "0 of 9 sessions this month have cost data"], ["Source", "VS Code Insiders"]])}<div class="note">No session this month has cost data, so no total is shown. Unknown is not 0.</div>${harness([[HARNESS.chat, "0 of 6", "unknown"], [HARNESS.host, "0 of 3", "unknown"]])}${MISSING}${DACTS}`;
    case "none":
      return `${lead}${kv([["Allowance", "1,000 AI Credits"], ["Days left", days(1)], ["Period", PERIOD1], ["Coverage", "0 sessions this month"], ["Source", "VS Code Insiders"]])}<p class="prose">No Copilot session started in this period on this machine.</p>${MISSING}${DACTS}`;
    default:
      return `${lead}${kv([["Allowance", "1,000 AI Credits"], ["Days left", days(12)], ["Period", PERIOD1], ["Source", "VS Code: not available"]])}<div class="note">No Copilot Chat logs found on this machine.</div><p class="prose">The allowance counts GitHub Copilot sessions recorded by VS Code. Claude Code, pi and mitmproxy sessions record no AI Credits.</p>${DACTS}`;
  }
}

const dlgTile = (inner, width, bare = false) =>
  `<div class="tile"${bare ? ' style="padding:0;border:0;background:transparent;width:100%"' : ""}><div class="dlg" role="dialog" style="max-width:${width}px">${inner}</div></div>`;

function detailsDialog(k, width = 460, bare = false) {
  return dlgTile(`<h3>Monthly allowance</h3>${detailsBody(k)}`, width, bare);
}

function detailsBoard() {
  const list = [
    ["near", "Known, near limit, every session known"],
    ["over", "Known, over; reset day 15"],
    ["partialNear", "Partial: “at least”, coverage, may be higher"],
    ["unknown", "Unknown: no figure, never 0"],
    ["none", "No sessions this month"],
    ["nosrc", "No Copilot logs on this machine"],
  ];
  const mk = () =>
    `<div style="display:grid;grid-template-columns:repeat(3,460px);gap:20px;align-items:start">${list
      .map(([k, c]) => `<div><p class="cap">${c}</p>${detailsDialog(k)}</div>`)
      .join("")}</div>`;
  return page(
    "Monthly allowance: details dialog",
    1560,
    sect("light", "Details dialog, ledger light (opens from the gauge; focus starts on Close)", mk()) +
      sect("dark", "Details dialog, ledger dark", mk()),
  );
}

// ---------- Settings board ----------
function settingsDialog(k, width = 360, bare = false) {
  const f = (label, id, val, { bad = "", placeholder = "" } = {}) =>
    `<div class="field"><label for="${id}">${label}</label><span class="inp num${bad ? " bad" : ""}" id="${id}"${bad ? ' aria-invalid="true"' : ""}>${val === "" ? `<span class="mut">${placeholder}</span>` : val}</span>${bad ? `<span class="ferr" role="alert">${bad}</span>` : ""}</div>`;
  const hint = `<p class="prose">Set it to match your GitHub billing page. Stored in this app’s settings folder only.</p>`;
  const A = "Monthly allowance (AI Credits)";
  const R = "Reset day (1 to 28)";
  const W = "Warn at (percent of allowance)";
  const rm = (cls = "") => `<button class="btn${cls}"${cls.includes("dis") ? " disabled" : ""}>Remove allowance</button>`;
  const tail = `<button class="btn" style="margin-left:auto">Cancel</button><button class="btn p">Save</button>`;
  let fields;
  let extra = "";
  let removeBtn = rm();
  if (k === "empty") {
    fields = f(A, "a1", "", { placeholder: "a number above 0" }) + f(R, "r1", "1") + f(W, "w1", "80");
    removeBtn = rm(" dis");
  } else if (k === "filled") {
    fields = f(A, "a2", "1000") + f(R, "r2", "1") + f(W, "w2", "80");
  } else if (k === "error") {
    fields =
      f(A, "a3", "0", { bad: "Allowance must be above 0 and at most 1,000,000,000." }) +
      f(R, "r3", "29", { bad: "Reset day must be a whole number from 1 to 28." }) +
      f(W, "w3", "80");
    extra = `<div class="note" role="alert">Nothing was saved. The gauge is unchanged.</div>`;
  } else {
    fields = f(A, "a4", "1000") + f(R, "r4", "1") + f(W, "w4", "80");
    extra = `<p class="s2 mut">Remove allowance hides the gauge. The reset day and warn percent are kept.</p>`;
    removeBtn = rm(" foc");
  }
  const acts = `<div class="acts" style="align-items:center;justify-content:flex-start">${removeBtn}${tail}</div>`;
  return dlgTile(`<h3>Monthly allowance</h3>${hint}${fields}${extra}${acts}`, width, bare);
}

function settingsBoard() {
  const list = [
    ["empty", "Not set: Remove disabled, defaults filled"],
    ["filled", "Filled"],
    ["error", "Server 400: message beside each field, nothing saved"],
    ["remove", "Remove allowance (one click, no confirm step)"],
  ];
  const mk = () =>
    `<div style="display:grid;grid-template-columns:repeat(4,360px);gap:20px;align-items:start">${list
      .map(([k, c]) => `<div><p class="cap">${c}</p>${settingsDialog(k)}</div>`)
      .join("")}</div>`;
  return page(
    "Monthly allowance: settings dialog",
    1552,
    sect("light", "Settings dialog, ledger light (opens from the details or from “Set monthly allowance”)", mk()) +
      sect("dark", "Settings dialog, ledger dark", mk()),
  );
}

// ---------- Narrow board ----------
function narrowBoard() {
  const frame = (w, inner, cap) => `<div style="width:${w}px"><p class="cap">${cap}</p>${strip(w, inner)}</div>`;
  const hdr = (s, o = {}) => header({ gaugeHtml: gauge(s, o) });
  const full = (inner, cap) => `<div style="width:320px"><p class="cap">${cap}</p><div style="background:var(--scrim);padding:8px;border:1px solid var(--div)">${inner}</div></div>`;
  const row = (inner) => `<div style="display:flex;gap:24px;align-items:flex-start">${inner}</div>`;
  const mk = () =>
    row(
      frame(320, hdr(STATES.partialNear, { meterBelow: true, levelWord: "none" }), "320 px: at least, near limit; the level word moves to the details (plan 4.7)") +
        frame(320, hdr(STATES.partialNear, { meterBelow: true, levelWord: "short" }), "320 px, alternative: keep a short level word") +
        frame(320, hdr(STATES.over, { meterBelow: true, levelWord: "short" }), "320 px, alternative: over") +
        frame(320, hdr(STATES.unset), "320 px: not set"),
    ) +
    row(
      frame(768, hdr(STATES.partialNear), "768 px: at least, near limit; the header wraps to two rows") +
        frame(320, hdr(STATES.unknown), "320 px: unknown") +
        frame(320, hdr(STATES.nosrc), "320 px: no Copilot logs"),
    ) +
    row(
      frame(768, hdr(STATES.unset), "768 px: not set") +
        full(detailsDialog("partialNear", 304, true), "320 px: details dialog, full width, partial") +
        full(settingsDialog("error", 304, true), "320 px: settings dialog, full width, with 400 errors"),
    );
  return page(
    "Monthly allowance: narrow",
    1488,
    sect("light", "Narrow widths, ledger light", mk()) + sect("dark", "Narrow widths, ledger dark", mk()),
  );
}

// ---------- A11y board ----------
function a11yBoard() {
  const base = (used, pct, d, cov, lead = "") =>
    `${lead}AI Credits this month: ${used} of 1,000 allowance, ${pct} percent, ${d}, ${cov}.`;
  const rows = [
    ["Normal", STATES.normal, base("312.40", 31, "12 days left", "20 of 20 sessions this month have cost data")],
    ["Near limit", STATES.near, base("812.40", 81, "12 days left", "20 of 20 sessions this month have cost data", "Near limit. ")],
    ["Over", STATES.over, base("1,042.10", 104, "26 days left", "9 of 9 sessions this month have cost data", "Over the allowance. ")],
    ["Partial, near", STATES.partialNear, base("at least 812.40", 81, "12 days left", "13 of 20 sessions this month have cost data", "Near limit. ")],
    ["Unknown", STATES.unknown, "AI Credits this month: unknown, 1,000 allowance, 12 days left, 0 of 9 sessions this month have cost data."],
    ["No sessions", STATES.none, "No sessions this month, 1,000 AI Credits allowance, 1 day left."],
    ["No source", STATES.nosrc, "AI Credits this month: no Copilot logs, 1,000 AI Credits allowance, 12 days left. No Copilot Chat logs found on this machine."],
    ["Not set", STATES.unset, "No aria-label: the visible text is the name."],
  ];
  const tbody = rows
    .map(([n, s, a]) => `<tr><td>${n}</td><td>${s.kind === "unset" ? "Set monthly allowance" : gaugeText(s).replace(/<\/?b>/g, "")}</td><td>${a}</td></tr>`)
    .join("");
  const box = (inner) => `<div class="strip" style="padding:12px 14px;width:1440px">${inner}</div>`;
  const hd = (t) => `<p class="cap" style="font-size:12px;color:var(--text);font-weight:700">${t}</p>`;
  const note = (t, mt = 0) => `<p class="s2 mut" style="margin:${mt}px 0 8px">${t}</p>`;
  const chips = (items) => `<div class="ol">${items.map((t, i) => `<span><i class="step">${i + 1}</i>${t}</span>`).join("")}</div>`;
  const mk = () =>
    box(
      `${hd("Gauge button: name, role and label")}${note('A button with <code>aria-haspopup="dialog"</code>. The meter and the level color are <code>aria-hidden</code>; every level is in the words. The level sentence comes first when near or over. The label is the same at every width, even where the visible text drops the level word.')}<table class="a"><thead><tr><th style="width:130px">State</th><th style="width:360px">Visible text</th><th>aria-label</th></tr></thead><tbody>${tbody}</tbody></table>`,
    ) +
    box(
      `${hd("Focus order")}${note("Header, left to right, as in the DOM.")}${chips(["Learn / Analyze", "Source", "Gauge or Set monthly allowance", "Retention", "Color theme", "Config"])}${note("Details dialog: Enter or Space on the gauge opens it; focus lands on Close; Tab cycles inside; Escape or Close returns focus to the gauge.", 14)}${chips(["Close", "Recount", "Change allowance"])}${note("Settings dialog: focus lands on the allowance field. Cancel, Escape and a successful Save return focus to the gauge. After Save the gauge text updates from the PUT response and a polite live region says “Monthly allowance saved.” After Remove: “Monthly allowance removed.”", 14)}${chips(["Allowance", "Reset day", "Warn at", "Remove allowance", "Cancel", "Save"])}${note("A server 400 sets <code>aria-invalid</code> on the named field, shows its message beside it (with a ✕ mark, not color alone), links it with <code>aria-describedby</code> and moves focus to the first invalid field.", 14)}`,
    ) +
    box(
      `${hd("Contrast and color")}<ul class="lst" style="font-size:12px;color:var(--text)"><li>Text uses the ledger text and muted roles (4.5:1). The meter marks use the existing accent, warning (status-interrupted) and error (status-error) marks at 3:1 or more; no new token.</li><li>Near limit and over differ by words first, then by the threshold tick and the overflow cap on the meter.</li><li>At least is drawn with a hatched, dashed open end; the figure is never drawn exact.</li><li>Not set is muted text on its own border (4.5:1), not a disabled control.</li></ul>`,
    );
  return page(
    "Monthly allowance: accessibility",
    1488,
    sect("light", "Accessibility notes, ledger light", mk()) + sect("dark", "Accessibility notes, ledger dark", mk()),
  );
}

const boards = {
  "Header.dc.html": headerBoard(),
  "Details.dc.html": detailsBoard(),
  "Settings.dc.html": settingsBoard(),
  "Narrow.dc.html": narrowBoard(),
  "A11y.dc.html": a11yBoard(),
};
for (const [name, html] of Object.entries(boards)) writeFileSync(join(here, name), html);
console.log(`wrote ${Object.keys(boards).length} boards`);
