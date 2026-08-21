/* ============================================================================
 * raw collector output  →  data/families.json
 *
 *   node tools/normalize.mjs
 *
 * The portal returns ONE ROW PER person × phone × address, so 58 students come
 * back as 352 rows describing 162 people. This flattens that into clean
 * entities, links siblings, groups households, and asserts the result is sane.
 * ========================================================================== */

import { readFileSync, writeFileSync } from 'node:fs';

const RAW = 'data/raw/seven-hills-raw.json';
const OUT = 'data/families.json';

/* Your own kids — used to anchor "how far away does this family live". */
const HOME_STUDENT_IDS = [7724771 /* Wells */, 7721049 /* Aletta */];

const GRADE_ORDER = [
  'Pre-School', 'Pre-Kindergarten', 'Kindergarten',
  '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th',
];

// ── helpers ────────────────────────────────────────────────────────────────

const clean = (v) => (typeof v === 'string' ? v.trim() : v) || null;

const titleish = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** "(555) 010-1234" and "5550101234" → { display, tel } */
const normPhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (d.length !== 10) return { display: String(raw).trim(), tel: '+' + digits };
  return { display: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, tel: '+1' + d };
};

/** Straight-line miles. Honest about what it is — not a drive time. */
const haversineMiles = (a, b) => {
  if (!a?.lat || !b?.lat) return null;
  const R = 3958.8, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(h))).toFixed(1);
};

const addrFrom = (r) => {
  const line1 = clean(r.addressline1 ?? r.AddressLine1);
  if (!line1) return null;
  return {
    id     : r.address_id ?? r.PreferredAddressId ?? null,
    line1,
    line2  : clean(r.addressline2),
    city   : clean(r.city ?? r.City),
    state  : clean(r.state_short ?? r.State),
    zip    : clean(r.zip ?? r.Zip),
    lat    : r.PreferredAddressLat ?? null,
    lng    : r.PreferredAddressLng ?? null,
  };
};

// ── load ───────────────────────────────────────────────────────────────────

const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const rosterById = new Map(raw.students.map((s) => [s.UserID, s]));

// ── people: collapse the denormalized rows ─────────────────────────────────
/* One entry per human. Phones and emails accumulate across their rows. */

const people = new Map();

const upsertPerson = (row, relation) => {
  const id = row.user_id;
  let p = people.get(id);
  if (!p) {
    p = {
      id,
      first    : clean(row.nickname) || clean(row.firstname),
      legalFirst: clean(row.firstname),
      last     : clean(row.preferred_lastname) || clean(row.lastname),
      relations: new Set(),
      emails   : new Set(),
      phones   : [],
      address  : null,
      childIds : new Set(),
    };
    people.set(id, p);
  }
  p.relations.add(relation);
  if (row.email_address) p.emails.add(row.email_address.trim().toLowerCase());

  const ph = normPhone(row.phone_number);
  if (ph && !p.phones.some((x) => x.tel === ph.tel)) {
    p.phones.push({ ...ph, type: clean(row.phone_type) || 'Phone' });
  }
  if (!p.address) p.address = addrFrom(row);
  return p;
};

/* Sibling rows that point at kids outside our two grades (an older brother in
   4th, say) — worth surfacing as text even though we have no record for them. */
const outsideSiblings = new Map();

for (const [studentIdStr, rows] of Object.entries(raw.households)) {
  const studentId = Number(studentIdStr);
  for (const row of rows) {
    const rel = row.relationship_description;
    if (rel === 'Self') continue;

    if (rel === 'Sibling') {
      if (!rosterById.has(row.user_id)) {
        const key = `${studentId}:${row.user_id}`;
        if (!outsideSiblings.has(key)) {
          outsideSiblings.set(key, {
            studentId,
            name     : titleish(`${clean(row.nickname) || row.firstname} ${row.lastname}`),
            gradYear : clean(row.grad_year),
          });
        }
      }
      continue;
    }

    // Parent / Grandparent / Other
    upsertPerson(row, rel).childIds.add(studentId);
  }
}

// ── students ───────────────────────────────────────────────────────────────

const siblingIdsFor = (studentId) => {
  const rows = raw.households[studentId] || [];
  return [...new Set(rows
    .filter((r) => r.relationship_description === 'Sibling')
    .map((r) => r.user_id)
    .filter((id) => rosterById.has(id)))];
};

const students = raw.students.map((s) => {
  const rows = raw.households[s.UserID] || [];
  const guardians = rows.filter((r) => !['Self', 'Sibling'].includes(r.relationship_description));
  const address = addrFrom(s) || addrFrom(guardians[0] || {});

  return {
    id          : s.UserID,
    first       : clean(s.Nickname) || clean(s.FirstName),
    legalFirst  : clean(s.FirstName),
    last        : clean(s.LastName),
    name        : titleish(`${clean(s.Nickname) || s.FirstName} ${s.LastName}`),
    grade       : s.GradeDisplay,
    gradeSort   : GRADE_ORDER.indexOf(s.GradeDisplay),
    email       : clean(s.Email),
    householdId : s.PreferredAddressId ?? address?.id ?? null,
    address,
    parentIds   : [...new Set(guardians.map((r) => r.user_id))],
    siblingIds  : siblingIdsFor(s.UserID),
    siblingsOutside: [...outsideSiblings.values()]
      .filter((o) => o.studentId === s.UserID)
      .map(({ name, gradYear }) => ({ name, gradYear })),
  };
});

const studentById = new Map(students.map((s) => [s.id, s]));

// ── households ─────────────────────────────────────────────────────────────

const households = new Map();
for (const s of students) {
  const key = s.householdId ?? `student:${s.id}`;
  if (!households.has(key)) {
    households.set(key, { id: key, address: s.address, studentIds: [], parentIds: new Set() });
  }
  const h = households.get(key);
  h.studentIds.push(s.id);
  s.parentIds.forEach((p) => h.parentIds.add(p));
}

// ── home anchor + distances ────────────────────────────────────────────────

const home = HOME_STUDENT_IDS.map((id) => studentById.get(id)?.address).find((a) => a?.lat) || null;
if (!home) console.warn('! no home anchor found — distances will be null');

const homeHouseholdId = HOME_STUDENT_IDS
  .map((id) => studentById.get(id)?.householdId).find((h) => h != null);

for (const s of students) {
  s.isHome = s.householdId != null && s.householdId === homeHouseholdId;
  /* Your own kids don't need a distance badge reading "0 mi away". */
  s.milesFromHome = s.isHome ? null : haversineMiles(home, s.address);
}

// ── parents out ────────────────────────────────────────────────────────────

const jobTitles = raw.parentJobTitles || {};

const parents = [...people.values()]
  .map((p) => ({
    id       : p.id,
    /* Straight from the school's Current Parents directory — authoritative,
       unlike anything the web-research pass produces. */
    jobTitle : jobTitles[p.id] || null,
    first    : p.first,
    legalFirst: p.legalFirst,
    last     : p.last,
    name     : titleish(`${p.first} ${p.last}`),
    relation : p.relations.has('Parent') ? 'Parent' : [...p.relations][0],
    emails   : [...p.emails],
    phones   : p.phones,
    address  : p.address,
    childIds : [...p.childIds],
    /* Parents with a kid in BOTH grades are the ones worth knowing cold. */
    grades   : [...new Set([...p.childIds].map((id) => studentById.get(id)?.grade).filter(Boolean))],
  }))
  .sort((a, b) => (a.last || '').localeCompare(b.last || '') || (a.first || '').localeCompare(b.first || ''));

// ── assertions ─────────────────────────────────────────────────────────────

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };

expect(students.length === raw.students.length,
  `student count drifted: ${students.length} vs ${raw.students.length}`);

const noPhoto = students.filter((s) => !raw.photos[s.id]);
expect(noPhoto.length === 0, `${noPhoto.length} students missing photos: ${noPhoto.map(s=>s.name).join(', ')}`);

const noParent = students.filter((s) => s.parentIds.length === 0);
expect(noParent.length === 0, `${noParent.length} students with no parent: ${noParent.map(s=>s.name).join(', ')}`);

for (const s of students) {
  for (const sib of s.siblingIds) {
    expect(studentById.get(sib)?.siblingIds.includes(s.id),
      `sibling link not symmetric: ${s.name} → ${studentById.get(sib)?.name}`);
  }
}

for (const id of HOME_STUDENT_IDS) {
  expect(studentById.has(id), `home student ${id} not in roster`);
}
const [wells, aletta] = HOME_STUDENT_IDS.map((id) => studentById.get(id));
if (wells && aletta) {
  expect(wells.siblingIds.includes(aletta.id) && aletta.siblingIds.includes(wells.id),
    'Wells and Aletta are not linked as siblings');
  expect(JSON.stringify([...wells.parentIds].sort()) === JSON.stringify([...aletta.parentIds].sort()),
    'Wells and Aletta do not share the same parents');
}

// ── write ──────────────────────────────────────────────────────────────────

const out = {
  meta: {
    ...raw.meta,
    normalizedAt : new Date().toISOString(),
    home         : home ? { city: home.city, lat: home.lat, lng: home.lng } : null,
    counts       : {
      students   : students.length,
      parents    : parents.length,
      households : households.size,
    },
  },
  students : students.sort((a, b) => a.gradeSort - b.gradeSort || a.last.localeCompare(b.last)),
  parents,
  households: [...households.values()].map((h) => ({ ...h, parentIds: [...h.parentIds] })),
};

writeFileSync(OUT, JSON.stringify(out, null, 2));

// ── report ─────────────────────────────────────────────────────────────────

const withTitle  = parents.filter((p) => p.jobTitle);
const bothGrades = parents.filter((p) => p.grades.length > 1);
const noEmail    = parents.filter((p) => p.emails.length === 0);
const noPhone    = parents.filter((p) => p.phones.length === 0);

console.log(`\n  ${OUT}`);
console.log(`  ${out.students.length} students · ${parents.length} parents · ${households.size} households`);
console.log(`  ${students.filter(s=>s.siblingIds.length).length} kids with a sibling in these grades`);
console.log(`  ${bothGrades.length} parents with a kid in BOTH grades`);
console.log(`  ${withTitle.length} parents have a job title from the school directory`);
console.log(`  contactability: ${noEmail.length} parents without email, ${noPhone.length} without a phone`);
if (home) console.log(`  home anchor: ${home.city} — nearest family ${Math.min(...students.map(s=>s.milesFromHome).filter(Boolean))} mi`);

if (problems.length) {
  console.error(`\n  ${problems.length} PROBLEM(S):`);
  problems.forEach((p) => console.error('   ✗ ' + p));
  process.exit(1);
}
console.log('  all assertions passed\n');
