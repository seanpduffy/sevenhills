/* ============================================================================
 * Who is worth researching, and in what order.
 *
 *   node tools/research-queue.mjs           # top 25
 *   node tools/research-queue.mjs --all
 *   node tools/research-queue.mjs --json    # machine-readable, for Claude Code
 *
 * The pilot measured what actually works: a corporate email domain resolves
 * almost every time, a plain name + town almost never does. This ranks by that
 * evidence so effort goes where it pays, instead of evenly across 109 people.
 * ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';

const fam  = JSON.parse(readFileSync('data/families.json', 'utf8'));
const bios = existsSync('data/bios.json') ? JSON.parse(readFileSync('data/bios.json', 'utf8')) : {};

const FREEMAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com',
  'aol.com', 'comcast.net', 'sbcglobal.net', 'att.net', 'msn.com', 'live.com',
  'mac.com', 'pacbell.net', 'protonmail.com', 'ymail.com', 'verizon.net',
]);

/* Surnames common enough that "name + town" returns a crowd, not a person. */
const COMMON = new Set(['smith','johnson','williams','brown','jones','garcia','miller','davis',
  'wilson','anderson','taylor','thomas','moore','martin','jackson','white','harris','clark',
  'lewis','young','walker','hall','allen','king','wright','hill','green','baker','nelson',
  'lee','chen','wang','li','zhang','liu','kim','park','patel','shah','gupta','singh','nguyen','tran','fox']);

const cityOf = (p) => {
  const kid = fam.students.find((s) => p.childIds.includes(s.id));
  return kid?.address?.city || null;
};

/* Skip your own household — you don't need a dossier on Janice. */
const homeStudentIds = new Set(fam.students.filter((s) => s.isHome).map((s) => s.id));

const rows = fam.parents
  .filter((p) => !p.childIds.some((id) => homeStudentIds.has(id)))
  .map((p) => {
  const domains = p.emails.map((e) => e.split('@')[1]).filter(Boolean);
  const corporate = domains.find((d) => !FREEMAIL.has(d) && !d.includes('sevenhillsschool'));
  const school = domains.some((d) => d.includes('sevenhillsschool'));
  const city = cityOf(p);
  const surname = (p.last || '').toLowerCase();
  const commonName = COMMON.has(surname);

  let score, why, query;
  if (p.jobTitle)      { score = 0;  why = 'already has a title from the school directory'; }
  else if (bios[p.id]) { score = 0;  why = 'already researched'; }
  else if (corporate)  { score = 100; why = `employer known: ${corporate}`;
                         query = `"${p.name}" ${corporate.replace(/\.(com|org|net|edu)$/, '')}`; }
  else if (school)     { score = 90;  why = 'works at Seven Hills — check the school site';
                         query = `"${p.name}" site:sevenhillsschool.org`; }
  else if (!commonName && p.last?.length > 5)
                       { score = 50;  why = 'distinctive surname, worth one search';
                         query = `"${p.name}" ${city || 'Walnut Creek'} California`; }
  else                 { score = 10;  why = 'common name, no employer signal — expect nothing';
                         query = `"${p.name}" ${city || 'Walnut Creek'} California linkedin`; }

  /* Parents with kids in both grades are the ones he'll meet most often. */
  if (score > 0 && p.grades.length > 1) score += 15;

  return { id: p.id, name: p.name, city, grades: p.grades, score, why, query };
})
.filter((r) => r.score > 0)
.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const limit = process.argv.includes('--all') ? rows.length : 25;
  const done = fam.parents.length - rows.length;

  console.log(`\n  ${rows.length} parents still unresearched · ${done} already covered\n`);
  /* Bounds are explicit rather than derived — the "+15 for both grades" bonus
     pushes scores off the round numbers and made a derived version misfile them. */
  const tiers = [
    [90, 999, 'WORTH IT — employer known'],
    [50,  90, 'MAYBE — distinctive name'],
    [ 1,  50, 'LONG SHOT — common name, no signal'],
  ];
  for (const [min, max, label] of tiers) {
    const tier = rows.filter((r) => r.score >= min && r.score < max);
    if (!tier.length) continue;
    console.log(`  ${label}  (${tier.length})`);
    for (const r of tier.slice(0, limit)) {
      console.log(`    ${r.name.padEnd(26)} ${r.query}`);
    }
    console.log();
  }
  console.log(`  Run the queries, then add entries to data/bios.json keyed by parent id:`);
  console.log(`    { "<id>": { "bio", "confidence": "high|medium|low", "sources": [], "method" } }`);
  console.log(`  Then: node tools/bundle-data.mjs\n`);
}
