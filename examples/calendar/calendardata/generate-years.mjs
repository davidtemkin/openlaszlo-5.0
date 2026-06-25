#!/usr/bin/env node
// Pre-bake per-year calendar data as STATIC files (no JSP/server logic needed —
// works on any static host). For each year in [START_YEAR..END_YEAR] and each
// month, this reads the year-agnostic template vcal_xxxx-<month>-01.xml and does
// exactly what the old vcal.jspx + vcal.xsl did:
//     <year>            -> <yearYYYY>
//     <start year=""…>  -> <start year="YYYY"…>   (likewise <end>)
// then injects distinctive year-specific "marquee" events (eclipses, Olympics,
// World Cups, elections, space events) so browsing into the next several years
// shows recognizable, varied content on top of the recurring template events.
//
// Output: vcal_<year>-<month>-01.xml  (what cal-data.lzx now requests).
// Run:    node generate-years.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const START_YEAR = 2024, END_YEAR = 2032;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Year-specific marquee events ────────────────────────────────────────────
// { m, d, summary, sh, sm, eh, em, cat, notes, loc, who }  (m=month 1-12, times 24h)
const SPECIAL = {
  2026: [
    { m:2,  d:6,  summary:"Winter Olympics Open", sh:13, eh:16, cat:"holiday",
      notes:"Opening ceremony of the Milan–Cortina 2026 Winter Games.", loc:"Milan, Italy" },
    { m:2,  d:22, summary:"Winter Olympics Close", sh:13, eh:15, cat:"holiday",
      notes:"Closing ceremony of the Milan–Cortina Games.", loc:"Cortina d'Ampezzo, Italy" },
    { m:6,  d:11, summary:"World Cup Kickoff", sh:12, eh:15, cat:"holiday",
      notes:"FIFA World Cup 2026 opens — first hosted across the USA, Canada and Mexico.", loc:"Mexico City" },
    { m:7,  d:4,  summary:"USA 250th Anniversary", sh:9, eh:23, cat:"holiday",
      notes:"The Semiquincentennial — 250 years since the Declaration of Independence.", loc:"Philadelphia, PA" },
    { m:7,  d:19, summary:"World Cup Final", sh:15, eh:18, cat:"holiday",
      notes:"FIFA World Cup 2026 final.", loc:"MetLife Stadium, NJ" },
    { m:8,  d:12, summary:"Total Solar Eclipse", sh:18, sm:30, eh:19, em:30, cat:"astro",
      notes:"First total solar eclipse over mainland Europe since 1999 — path crosses Iceland and northern Spain.", loc:"Reykjavík / Valencia" },
    { m:11, d:3,  summary:"US Midterm Elections", sh:7, eh:20, cat:"milestone",
      notes:"All 435 House seats and a third of the Senate are up for election." },
    { m:9,  d:14, summary:"Project Phoenix Launch", sh:10, eh:11, cat:"milestone",
      notes:"Ship the 1.0 release. Cake in the kitchen afterward.", loc:"HQ", who:"The whole team" },
  ],
  2027: [
    { m:8,  d:2,  summary:"Great North African Eclipse", sh:12, eh:13, cat:"astro",
      notes:"Total solar eclipse with 6m23s of totality near Luxor — the longest visible from land until 2114.", loc:"Luxor, Egypt" },
    { m:10, d:1,  summary:"Rugby World Cup Opens", sh:19, eh:21, cat:"holiday",
      notes:"Rugby World Cup 2027 kicks off in Australia.", loc:"Sydney, Australia" },
    { m:3,  d:13, summary:"Cherry Blossom Trip", sh:8, eh:20, cat:"milestone",
      notes:"Hanami week. Pack light, bring the good camera.", loc:"Kyoto, Japan", who:"Family" },
    { m:5,  d:25, summary:"10-Year Reunion", sh:18, eh:23, cat:"milestone",
      notes:"Class reunion dinner — book the back room.", loc:"The old tavern" },
    { m:11, d:6,  summary:"Comet 7P/Pons-Winnecke", sh:21, eh:22, cat:"astro",
      notes:"Favorable evening apparition — find a dark sky." },
  ],
  2028: [
    { m:2,  d:29, summary:"Leap Day", sh:0, eh:23, em:59, cat:"milestone",
      notes:"An extra day — spend it on something you'd never otherwise make time for." },
    { m:7,  d:14, summary:"Summer Olympics Open", sh:17, eh:20, cat:"holiday",
      notes:"Opening ceremony of the LA 2028 Summer Games — back in the USA for the first time since 1996.", loc:"Los Angeles, CA" },
    { m:7,  d:22, summary:"Total Solar Eclipse", sh:4, eh:5, cat:"astro",
      notes:"Totality sweeps across the Australian outback and directly over Sydney.", loc:"Sydney, Australia" },
    { m:7,  d:30, summary:"Summer Olympics Close", sh:17, eh:20, cat:"holiday",
      notes:"Closing ceremony of the LA 2028 Games.", loc:"Los Angeles, CA" },
    { m:11, d:7,  summary:"US Presidential Election", sh:7, eh:20, cat:"milestone",
      notes:"Election Day." },
    { m:4,  d:18, summary:"Spring Sabbatical Begins", sh:9, eh:17, cat:"milestone",
      notes:"Six weeks off. Out of office, genuinely this time." },
  ],
  2029: [
    { m:4,  d:13, summary:"Asteroid Apophis Flyby", sh:21, eh:22, cat:"astro",
      notes:"99942 Apophis passes ~31,000 km from Earth — closer than weather satellites and visible to the naked eye. On a Friday the 13th, no less.", loc:"Look west after dusk" },
    { m:6,  d:12, summary:"Venus at Greatest Brilliancy", sh:20, eh:21, cat:"astro",
      notes:"The evening star at its dazzling best." },
    { m:9,  d:3,  summary:"New Studio Opens", sh:11, eh:14, cat:"milestone",
      notes:"Ribbon-cutting and open house.", loc:"Downtown", who:"Friends & collaborators" },
    { m:12, d:20, summary:"Geminids Peak (Moonless)", sh:22, eh:23, cat:"astro",
      notes:"A dark-sky Geminid meteor shower — up to 120/hour." },
  ],
  2030: [
    { m:6,  d:1,  summary:"Total Solar Eclipse", sh:9, eh:10, cat:"astro",
      notes:"An eclipse path crossing North Africa, Greece and into Russia.", loc:"Athens, Greece" },
    { m:6,  d:13, summary:"World Cup Centenary Opens", sh:12, eh:15, cat:"holiday",
      notes:"FIFA World Cup 2030 — 100 years on, hosted by Spain, Portugal and Morocco with centenary matches in South America.", loc:"Madrid, Spain" },
    { m:11, d:25, summary:"Total Solar Eclipse", sh:2, eh:3, cat:"astro",
      notes:"Totality across southern Africa and Australia.", loc:"Botswana / Australia" },
    { m:1,  d:1,  summary:"Welcome to the 2030s", sh:0, eh:1, cat:"milestone",
      notes:"A new decade. Make a list." },
    { m:8,  d:7,  summary:"Family Reunion Week", sh:10, eh:22, cat:"milestone",
      notes:"The big one — three generations at the lake house.", loc:"The lake house", who:"Everyone" },
  ],
};

function buildEvent(year, ev) {
  const sm = ev.sm ?? 0, em = ev.em ?? 0;
  const lines = [
    `                <event>`,
    `                       <summary value="${esc(ev.summary)}"/>`,
    `                       <comment value="${esc(ev.comment ?? ev.summary)}"/>`,
    `                       <start year="${year}" month="${ev.m}" day="${ev.d}" hour="${ev.sh}" minute="${sm}"/>`,
    `                       <end year="${year}" month="${ev.m}" day="${ev.d}" hour="${ev.eh}" minute="${em}"/>`,
    ev.cat ? `                       <category value="${esc(ev.cat)}"/>` : `                       <category/>`,
  ];
  if (ev.notes) lines.push(`                       <notes value="${esc(ev.notes)}"/>`);
  if (ev.loc)   lines.push(`                       <location value="${esc(ev.loc)}"/>`);
  if (ev.who)   lines.push(`                       <attendees value="${esc(ev.who)}"/>`);
  lines.push(`                </event>`);
  return lines.join("\n");
}

// Insert marquee events into the transformed month XML (into <dayD>…</dayD>,
// creating the day node before </monthM> if it doesn't exist yet).
function injectSpecial(xml, year, month) {
  const evs = (SPECIAL[year] || []).filter(e => e.m === month);
  if (!evs.length) return xml;
  const byDay = {};
  for (const e of evs) (byDay[e.d] ||= []).push(e);
  for (const d of Object.keys(byDay)) {
    const block = byDay[d].map(e => buildEvent(year, e)).join("\n");
    const open = `<day${d}>`;
    const at = xml.indexOf(open);
    if (at >= 0) {
      const ins = at + open.length;
      xml = xml.slice(0, ins) + "\n" + block + xml.slice(ins);
    } else {
      const close = `</month${month}>`;
      const ci = xml.indexOf(close);
      const dayBlock = `            <day${d}>\n${block}\n            </day${d}>\n        `;
      if (ci >= 0) xml = xml.slice(0, ci) + dayBlock + xml.slice(ci);
    }
  }
  return xml;
}

let files = 0, marquee = 0;
for (let year = START_YEAR; year <= END_YEAR; year++) {
  for (let month = 1; month <= 12; month++) {
    const tpl = path.join(DIR, `vcal_xxxx-${month}-01.xml`);
    if (!fs.existsSync(tpl)) continue;
    let xml = fs.readFileSync(tpl, "utf8");
    // XSL-equivalent transform
    xml = xml.replace(/<year>/g, `<year${year}>`).replace(/<\/year>/g, `</year${year}>`)
             .replace(/year=""/g, `year="${year}"`);
    // year-specific marquee events
    const before = xml.length;
    xml = injectSpecial(xml, year, month);
    if (xml.length !== before) marquee += (SPECIAL[year] || []).filter(e => e.m === month).length;
    fs.writeFileSync(path.join(DIR, `vcal_${year}-${month}-01.xml`), xml);
    files++;
  }
}
console.log(`Generated ${files} files for ${START_YEAR}–${END_YEAR}, injected ${marquee} marquee events.`);
