/* ============================================================================
 * Seven Hills — directory collector
 *
 * HOW TO RUN
 *   1. In Chrome, open the parent portal and go to the STUDENTS directory:
 *      https://sevenhillsschool.myschoolapp.com/app/parent?svcid=edu#directory/1428
 *   2. Open DevTools console (Cmd-Option-J).
 *   3. First time only: Chrome blocks pasting into the console until you type
 *      the words   allow pasting   and hit enter.
 *   4. Paste this entire file, hit enter, wait ~60s, and a JSON file downloads.
 *   5. Move it to  data/raw/seven-hills-raw.json
 *
 * It uses the session you're already logged into. No passwords, nothing stored.
 * ========================================================================== */

(async () => {
  const CFG = {
    studentsDirId : 1428,
    parentsDirId  : 1429,                       // has JobTitle for ~10% of parents
    gradeFacetIdx : 4508,                       // facet index for "student_grade"
    grades        : ['Pre-Kindergarten', '1st'],
    photoPx       : 400,                        // native source is ~200px; >400 is wasted bytes
    concurrency   : 6,
    cdnFallback   : 'https://bbk12e1-cdn.myschoolcdn.com/ftpimages/905/user/',
  };

  const log = (...a) => console.log('%c[shs]', 'color:#2d6a4f;font-weight:bold', ...a);
  const warn = (...a) => console.warn('[shs]', ...a);

  if (!location.hostname.endsWith('myschoolapp.com')) {
    throw new Error('Run this on the myschoolapp.com directory page, not ' + location.hostname);
  }

  const getJSON = async (url) => {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  };

  /* Run tasks with bounded concurrency, reporting progress as it goes. */
  const pool = async (items, worker, label) => {
    const out = new Array(items.length);
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: CFG.concurrency }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try { out[i] = await worker(items[i], i); }
        catch (e) { warn(label, 'failed for item', i, e.message); out[i] = null; }
        if (++done % 10 === 0 || done === items.length) log(`${label}: ${done}/${items.length}`);
      }
    }));
    return out;
  };

  /* The CDN path embeds a per-school id (905 here). Sniff it from any image the
     page has already loaded so this keeps working if the school is re-homed. */
  const cdnBase = (() => {
    const hit = performance.getEntriesByType('resource')
      .map(e => e.name)
      .find(n => n.includes('myschoolcdn.com') && n.includes('/user/'));
    if (hit) {
      const base = hit.slice(0, hit.indexOf('/user/') + '/user/'.length);
      log('detected CDN base:', base);
      return base;
    }
    warn('could not detect CDN base from loaded images; using fallback');
    return CFG.cdnFallback;
  })();

  const blobToDataURL = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

  // ── 1. roster ────────────────────────────────────────────────────────────
  const facets = CFG.grades.map(g => `${CFG.gradeFacetIdx}_${g}`).join('|');
  const students = await getJSON(
    `/api/directory/directoryresultsget?directoryId=${CFG.studentsDirId}` +
    `&searchVal=&facets=${encodeURIComponent(facets)}&searchAll=false`);
  log(`roster: ${students.length} students across ${CFG.grades.join(' + ')}`);
  if (!students.length) throw new Error('Empty roster — are the grade names still correct?');

  /* The Current Parents directory carries a JobTitle the student directory
     doesn't. It's only filled in for a minority, but it comes straight from the
     school, so it beats anything we could infer from a web search. */
  let parentJobTitles = {};
  try {
    const pd = await getJSON(
      `/api/directory/directoryresultsget?directoryId=${CFG.parentsDirId}` +
      `&searchVal=&facets=&searchAll=false`);
    for (const r of pd) {
      if (r.JobTitle && String(r.JobTitle).trim()) parentJobTitles[r.UserID] = String(r.JobTitle).trim();
    }
    log(`parent directory: ${Object.keys(parentJobTitles).length} job titles across ${pd.length} parents`);
  } catch (e) {
    warn('parents directory unavailable, continuing without job titles:', e.message);
  }

  // ── 2. households (parents + siblings) ───────────────────────────────────
  const households = {};
  await pool(students, async (s) => {
    households[s.UserID] = await getJSON(
      `/api/datadirect/directoryadditionalinfoget?userId=${s.UserID}` +
      `&dd=false&fd=true&dirId=${CFG.studentsDirId}`);
  }, 'households');

  // ── 3. photos, cropped square and inlined ────────────────────────────────
  const photos = {};
  const withPhoto = students.filter(s => s.LargeFileName);
  log(`photos: ${withPhoto.length}/${students.length} students have one`);
  await pool(withPhoto, async (s) => {
    const url = `${cdnBase}${s.LargeFileName}?resize=${CFG.photoPx},${CFG.photoPx}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('photo ' + r.status);
    photos[s.UserID] = await blobToDataURL(await r.blob());
  }, 'photos');

  // ── 4. bundle up and download ────────────────────────────────────────────
  const payload = {
    meta: {
      collectedAt : new Date().toISOString(),
      source      : location.origin,
      grades      : CFG.grades,
      photoPx     : CFG.photoPx,
      cdnBase,
      counts      : {
        students   : students.length,
        households : Object.keys(households).length,
        photos     : Object.keys(photos).length,
        jobTitles  : Object.keys(parentJobTitles).length,
      },
    },
    students,
    households,
    photos,
    parentJobTitles,
  };

  const json = JSON.stringify(payload);
  log(`bundle: ${(json.length / 1048576).toFixed(2)} MB`);

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'seven-hills-raw.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);

  log('done — move the download to data/raw/seven-hills-raw.json');
  return payload.meta;
})();
