/* ============================================================================
 * Guest list for a class party, as CSV.
 *
 *   node tools/export-invites.mjs 1st            whole grade + a file per homeroom
 *   node tools/export-invites.mjs 1st Wills      just that homeroom
 *   node tools/export-invites.mjs Pre-Kindergarten
 *
 * Writes to data/exports/ (gitignored, like everything else with people in it).
 * Columns are First Name / Last Name / Email — what Evite, Paperless Post,
 * Punchbowl and Partiful all accept. The annotated file adds child, class and
 * relation for your own reference; don't feed that one to the invite service.
 * ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [, , grade, roomArg] = process.argv;
if (!grade) {
  console.error('usage: node tools/export-invites.mjs <grade> [homeroom]');
  process.exit(1);
}

const fam = JSON.parse(readFileSync('data/families.json', 'utf8'));
const byId = new Map(fam.parents.map((p) => [p.id, p]));

const inGrade = fam.students.filter((s) => s.grade === grade);
if (!inGrade.length) {
  console.error(`no students in "${grade}". Known: ${[...new Set(fam.students.map((s) => s.grade))].join(', ')}`);
  process.exit(1);
}

/* RFC 4180: quote anything with a comma, quote or newline; double inner quotes. */
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/* A grandparent listed as a guardian is only the right person to invite when
   no parent behind them has an email on file. */
const contactsFor = (s) => {
  const all = s.parentIds.map((id) => byId.get(id)).filter(Boolean);
  const withEmail = all.filter((p) => p.emails.length);
  const parents = withEmail.filter((p) => p.relation === 'Parent');
  return { chosen: parents.length ? parents : withEmail, all };
};

/** Build the guest rows for a set of students. */
function build(students) {
  const rows = [], oneEach = [], noEmail = [];
  const seenEmail = new Set(), seenHousehold = new Set();
  let grandparents = 0;

  for (const s of [...students].sort((a, b) => a.last.localeCompare(b.last))) {
    const { chosen, all } = contactsFor(s);
    if (!chosen.length) {
      all.forEach((p) => noEmail.push([p.first, p.last, p.phones[0]?.display || '', s.name, s.homeroom || '', p.relation]));
      continue;
    }
    for (const p of chosen) {
      if (p.relation !== 'Parent') grandparents++;
      const email = p.emails[0];
      if (seenEmail.has(email.toLowerCase())) continue;
      seenEmail.add(email.toLowerCase());
      rows.push([p.first, p.last, email, s.name, s.homeroom || 'Unknown', p.relation]);
      if (s.householdId != null && !seenHousehold.has(s.householdId)) {
        seenHousehold.add(s.householdId);
        oneEach.push([p.first, p.last, email]);
      }
    }
  }
  return { rows, oneEach, noEmail, grandparents };
}

mkdirSync('data/exports', { recursive: true });
const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const H3 = ['First Name', 'Last Name', 'Email'];
const H5 = [...H3, 'Class', 'Child'];
const H6 = [...H3, 'Child', 'Class', 'Relation'];
const written = [];

function emit(label, students) {
  if (!students.length) return;
  const { rows, oneEach, noEmail, grandparents } = build(students);
  const base = `data/exports/${label}`;
  /* The main list: everyone, with the class alongside, so you can pick across
     both rooms in one pass instead of reconciling two files. */
  writeFileSync(`${base}-invites.csv`, csv(H5, rows.map((r) => [r[0], r[1], r[2], r[4], r[3]])));
  writeFileSync(`${base}-invites-emails-only.csv`, csv(H3, rows.map((r) => r.slice(0, 3))));
  writeFileSync(`${base}-invites-one-each.csv`, csv(H3, oneEach));
  writeFileSync(`${base}-invites-annotated.csv`, csv(H6, rows));
  if (noEmail.length) writeFileSync(`${base}-no-email.csv`, csv(['First Name', 'Last Name', 'Phone', 'Child', 'Class', 'Relation'], noEmail));
  written.push({ label, kids: students.length, contacts: rows.length, families: oneEach.length, noEmail: noEmail.length, grandparents });
}

/* You're hosting — you don't invite yourselves. */
const guests = inGrade.filter((s) => !s.isHome);
const rooms = [...new Set(inGrade.map((s) => s.homeroom).filter(Boolean))].sort();

if (roomArg) {
  const match = rooms.find((r) => r.toLowerCase() === roomArg.toLowerCase());
  if (!match) { console.error(`no homeroom "${roomArg}" in ${grade}. Known: ${rooms.join(', ')}`); process.exit(1); }
  emit(`${slug(grade)}-${slug(match)}`, guests.filter((s) => s.homeroom === match));
} else {
  emit(slug(grade), guests);
  for (const r of rooms) emit(`${slug(grade)}-${slug(r)}`, guests.filter((s) => s.homeroom === r));
}

const unassigned = guests.filter((s) => !s.homeroom);

console.log(`\n  ${grade} — ${inGrade.length} students (${guests.length} after removing your own)\n`);
console.log('  ' + 'file'.padEnd(34) + 'kids  contacts  families');
for (const w of written) {
  console.log(`  data/exports/${w.label}-invites.csv`.padEnd(36) +
    String(w.kids).padStart(4) + String(w.contacts).padStart(10) + String(w.families).padStart(10));
}
const tot = written[0];
if (tot?.grandparents) console.log(`\n  ${tot.grandparents} grandparent(s) used as the contact — no parent on file had an email`);
if (tot?.noEmail) console.log(`  ${tot.noEmail} guardian(s) have no email — see the -no-email.csv, you'll need to text them`);
if (unassigned.length) {
  console.log(`\n  ! ${unassigned.length} student(s) in ${grade} have no homeroom in the directory:`);
  unassigned.forEach((s) => console.log(`      ${s.name} — included in the grade file, absent from both class files`));
}
console.log(`\n  -invites.csv            every parent + which class their kid is in  <- the one you want`);
console.log(`  -invites-emails-only    same people, just the three import columns`);
console.log(`  -invites-one-each       one contact per household`);
console.log(`  -invites-annotated      adds relation, for your reference\n`);
