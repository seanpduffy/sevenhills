/* ============================================================================
 * families.json + bios.json + photos  →  data/bundle/shs-data.json
 *
 *   node tools/bundle-data.mjs
 *
 * This is the ONLY file that goes on the phone. It never touches the network —
 * you AirDrop it and import it through the app's own file picker.
 * ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const FAM  = 'data/families.json';
const RAW  = 'data/raw/seven-hills-raw.json';
const BIOS = 'data/bios.json';
const OUT  = 'data/bundle/shs-data.json';

const fam = JSON.parse(readFileSync(FAM, 'utf8'));
const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const bios = existsSync(BIOS) ? JSON.parse(readFileSync(BIOS, 'utf8')) : {};

/* Only ship photos for kids actually in the bundle. */
const photos = {};
for (const s of fam.students) {
  if (raw.photos[s.id]) photos[s.id] = raw.photos[s.id];
}

const missing = fam.students.filter((s) => !photos[s.id]);
if (missing.length) console.warn(`! ${missing.length} students without a photo: ${missing.map((s) => s.name).join(', ')}`);

/* Drop bios that don't point at a real parent, so a stale bios.json can't
   silently carry dead weight onto the phone. */
const parentIds = new Set(fam.parents.map((p) => p.id));
const cleanBios = {};
let orphaned = 0;
for (const [id, b] of Object.entries(bios)) {
  if (parentIds.has(+id)) cleanBios[id] = b; else orphaned++;
}
if (orphaned) console.warn(`! dropped ${orphaned} bio(s) for parents no longer in the roster`);

const bundle = {
  meta       : { ...fam.meta, bundledAt: new Date().toISOString() },
  students   : fam.students,
  parents    : fam.parents,
  households : fam.households,
  photos,
  bios       : cleanBios,
};

mkdirSync('data/bundle', { recursive: true });
const json = JSON.stringify(bundle);
writeFileSync(OUT, json);

const mb = (json.length / 1048576).toFixed(2);
const withBio = Object.values(cleanBios).filter((b) => b.bio).length;

console.log(`\n  ${OUT}  ${mb} MB`);
console.log(`  ${bundle.students.length} students · ${bundle.parents.length} parents · ${Object.keys(photos).length} photos`);
console.log(`  ${withBio}/${bundle.parents.length} parents have a background note`);
if (json.length > 3 * 1048576) console.warn('  ! over the 3 MB budget — consider dropping photoPx');
console.log(`\n  AirDrop this file to your phone, then: app → More → Replace data file\n`);
