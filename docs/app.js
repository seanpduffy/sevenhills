/* ==========================================================================
   Who's Who — Seven Hills Pre-K + 1st
   Vanilla JS, no build step, no dependencies. Everything lives in IndexedDB;
   after the first load this app never touches the network.
   ========================================================================== */

'use strict';

// ── tiny IndexedDB wrapper ────────────────────────────────────────────────

const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const req = indexedDB.open('whoswho', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('person', 'personKey');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));

  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      /* Resolve with the request's result, NOT the request. A miss must come
         back as undefined — returning the IDBRequest reads as truthy and made
         boot() think an absent bundle was present. */
      t.oncomplete = () => res(req instanceof IDBRequest ? req.result : req);
      t.onerror = () => rej(t.error);
    });
  };

  return {
    get:  (k)    => tx('kv', 'readonly',  (s) => s.get(k)),
    set:  (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
    del:  (k)    => tx('kv', 'readwrite', (s) => s.delete(k)),
    notesAll:    () => tx('notes', 'readonly',  (s) => s.getAll()),
    notePut: (n) => tx('notes', 'readwrite', (s) => s.put(n)),
    noteDel: (id)=> tx('notes', 'readwrite', (s) => s.delete(id)),
  };
})();

// ── state ─────────────────────────────────────────────────────────────────

const S = {
  data: null,        // { meta, students, parents, households, photos, bios }
  notes: [],
  author: 'Sean',
  quizStats: {},
  grade: null,       // active grade filter
  room: null,        // active homeroom filter (within a grade)
  query: '',
  byStudent: new Map(),
  byParent: new Map(),
};

// ── helpers ───────────────────────────────────────────────────────────────

const $  = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const photo = (id) => S.data.photos[id] || '';

const noteKey = (type, id) => `${type}:${id}`;

const notesFor = (type, id) =>
  S.notes.filter((n) => n.personKey === noteKey(type, id))
         .sort((a, b) => b.createdAt - a.createdAt);

/** A kid counts as "known" once you or Janice have written anything about the family. */
const isKnown = (student) =>
  notesFor('student', student.id).length > 0 ||
  student.parentIds.some((pid) => notesFor('parent', pid).length > 0);

const parentsOf = (student) => student.parentIds.map((id) => S.byParent.get(id)).filter(Boolean);

const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const firstNames = (people) => {
  const n = people.map((p) => p.first).filter(Boolean);
  return n.length === 2 ? `${n[0]} & ${n[1]}` : n.join(', ');
};

/* Sort by surname, then first name. */
const bySurname = (a, b) =>
  (a.last || '').localeCompare(b.last || '') || (a.first || '').localeCompare(b.first || '');

// ── search ────────────────────────────────────────────────────────────────

const matchesStudent = (s, q) => {
  if (!q) return true;
  const hay = [
    s.name, s.legalFirst, s.grade, s.homeroom,
    ...parentsOf(s).flatMap((p) => [p.name, p.first, p.last, p.jobTitle, ...(p.emails || [])]),
    s.address?.line1, s.address?.city,
    ...notesFor('student', s.id).map((n) => n.text),
    ...s.parentIds.flatMap((id) => notesFor('parent', id).map((n) => n.text)),
    S.data.bios?.[s.parentIds[0]]?.bio, S.data.bios?.[s.parentIds[1]]?.bio,
  ].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
};

// ── views ─────────────────────────────────────────────────────────────────

const grades = () => [...new Set(S.data.students.map((s) => s.grade))];

/* Homerooms within the selected grade. Only worth showing when there's a
   choice to make — Pre-K has a single room, so the row would be noise. */
const roomsInGrade = () => S.grade
  ? [...new Set(S.data.students.filter((s) => s.grade === S.grade).map((s) => s.homeroom).filter(Boolean))].sort()
  : [];

function viewKids() {
  const gs = grades();
  const list = S.data.students
    .filter((s) => (!S.grade || s.grade === S.grade)
                && (!S.room || s.homeroom === S.room)
                && matchesStudent(s, S.query));

  return `
    <div class="head">
      <h1>Kids</h1><span class="count">${list.length} of ${S.data.students.length}</span>
    </div>
    <input class="search" id="q" type="search" placeholder="Name, parent, street, note…"
           value="${esc(S.query)}" autocomplete="off" autocorrect="off" autocapitalize="off">
    <div class="seg">
      <button data-grade="" aria-pressed="${!S.grade}">All</button>
      ${gs.map((g) => `<button data-grade="${esc(g)}" aria-pressed="${S.grade === g}">${esc(g === 'Pre-Kindergarten' ? 'Pre-K' : g)}</button>`).join('')}
    </div>
    ${(() => { const rs = roomsInGrade(); return rs.length > 1 ? `
      <div class="seg seg-sub">
        <button data-room="" aria-pressed="${!S.room}">Both classes</button>
        ${rs.map((r) => `<button data-room="${esc(r)}" aria-pressed="${S.room === r}">${esc(r)}</button>`).join('')}
      </div>` : ''; })()}
    ${list.length ? `<div class="wall">${list.map(faceTile).join('')}</div>`
                  : `<p class="empty">Nobody matches “${esc(S.query)}”.</p>`}
  `;
}

const faceTile = (s) => `
  <a class="face" href="#/kid/${s.id}">
    <img src="${photo(s.id)}" alt="" loading="lazy">
    ${isKnown(s) ? '<span class="known"></span>' : ''}
    <div class="nm">${esc(s.first)}</div>
    <div class="sub">${esc(s.last)}</div>
  </a>`;

function viewKid(id) {
  const s = S.byStudent.get(+id);
  if (!s) return `<p class="empty">Not found.</p>`;
  const ps = parentsOf(s);
  const sibs = s.siblingIds.map((i) => S.byStudent.get(i)).filter(Boolean);

  return `
    <a class="back" href="#/kids">‹ Kids</a>
    <div class="card-hero"><img src="${photo(s.id)}" alt="${esc(s.name)}"></div>
    <div class="card-title">
      <h1>${esc(s.name)}</h1>
      <div class="meta">
        ${esc(s.grade)}${s.homeroom ? ` · ${esc(s.homeroom)}` : ''}${s.legalFirst !== s.first ? ` · legally ${esc(s.legalFirst)}` : ''}
        ${s.milesFromHome != null ? ` · ${s.milesFromHome} mi away` : ''}
      </div>
    </div>

    <div class="section-label">Parents</div>
    ${ps.map(parentPanel).join('') || '<p class="empty">No parents on file.</p>'}

    ${sibs.length || s.siblingsOutside.length ? `
      <div class="section-label">Siblings</div>
      <div class="panel">
        ${sibs.map((b) => `
          <a class="rowlink" href="#/kid/${b.id}">
            <img src="${photo(b.id)}" alt="">
            <div><div class="t">${esc(b.name)}</div><div class="s">${esc(b.grade)}</div></div>
          </a>`).join('')}
        ${s.siblingsOutside.map((o) => `
          <div class="rowlink">
            <div><div class="t">${esc(o.name)}</div>
                 <div class="s">not in Pre-K or 1st${o.gradYear ? ` · class of ${esc(o.gradYear)}` : ''}</div></div>
          </div>`).join('')}
      </div>` : ''}

    ${s.address ? `
      <div class="section-label">Home</div>
      <div class="panel">
        <div style="font-size:15px">${esc(s.address.line1)}</div>
        <div class="muted" style="font-size:14px">${esc(s.address.city)}, ${esc(s.address.state)} ${esc(s.address.zip)}</div>
        <div class="contacts">
          <a class="chip" target="_blank" rel="noopener"
             href="https://maps.apple.com/?daddr=${encodeURIComponent(
               [s.address.line1, s.address.city, s.address.state, s.address.zip].filter(Boolean).join(', '))}">
             Directions${s.milesFromHome != null ? ` · ${s.milesFromHome} mi` : ''}</a>
        </div>
      </div>` : ''}

    <div class="section-label">Notes about ${esc(s.first)}</div>
    ${notesBlock('student', s.id)}
  `;
}

function parentPanel(p) {
  const bio = S.data.bios?.[p.id];
  const conf = bio?.confidence;
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span class="person-name">${esc(p.name)}</span>
        <span class="person-rel">${esc(p.relation)}${p.grades.length > 1 ? ' · both grades' : ''}</span>
      </div>

      ${p.jobTitle ? `<div class="bio">${esc(p.jobTitle)}<span class="conf high">school directory</span></div>` : ''}

      ${bio?.bio ? `
        <div class="bio ${conf === 'low' ? 'low' : ''}">${esc(bio.bio)}${
          conf ? `<span class="conf ${esc(conf)}">${conf === 'low' ? 'unsure' : esc(conf)}</span>` : ''}</div>
        ${bio.sources?.length ? `<div class="srcs">${bio.sources.map((u) => {
          let host = u; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {}
          return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(host)}</a>`;
        }).join('')}</div>` : ''}
      ` : (p.jobTitle ? '' : '<div class="bio faint">No background yet.</div>')}

      <div class="contacts">
        ${p.phones.map((ph, i) => `
          <a class="chip ${i === 0 ? 'pri' : ''}" href="tel:${esc(ph.tel)}">${esc(ph.type)} · ${esc(ph.display)}</a>
          <a class="chip" href="sms:${esc(ph.tel)}">Text</a>`).join('')}
        ${p.emails.map((e) => `<a class="chip" href="mailto:${esc(e)}">Email</a>`).join('')}
        <a class="chip" href="#/parent/${p.id}">Notes${(() => {
          const n = notesFor('parent', p.id).length; return n ? ` · ${n}` : '';
        })()}</a>
      </div>
    </div>`;
}

function viewParents() {
  const q = S.query.toLowerCase();
  const list = S.data.parents
    .filter((p) => !S.grade || p.grades.includes(S.grade))
    .filter((p) => !q || [p.name, p.jobTitle, ...(p.emails || []), S.data.bios?.[p.id]?.bio,
                          ...notesFor('parent', p.id).map((n) => n.text)]
      .join(' ').toLowerCase().includes(q))
    .sort(bySurname);

  const gs = grades();
  return `
    <div class="head"><h1>Parents</h1><span class="count">${list.length}</span></div>
    <input class="search" id="q" type="search" placeholder="Name, bio, note…" value="${esc(S.query)}"
           autocomplete="off" autocorrect="off" autocapitalize="off">
    <div class="seg">
      <button data-grade="" aria-pressed="${!S.grade}">All</button>
      ${gs.map((g) => `<button data-grade="${esc(g)}" aria-pressed="${S.grade === g}">${esc(g === 'Pre-Kindergarten' ? 'Pre-K' : g)}</button>`).join('')}
    </div>
    <div class="panel">
      ${list.map((p) => {
        const kids = p.childIds.map((i) => S.byStudent.get(i)).filter(Boolean);
        return `<a class="rowlink" href="#/parent/${p.id}">
          ${kids[0] ? `<img src="${photo(kids[0].id)}" alt="">` : '<img alt="">'}
          <div>
            <div class="t">${esc(p.name)}</div>
            <div class="s">${esc(p.jobTitle ? p.jobTitle + ' · ' : '')}${esc(kids.map((k) => `${k.first} (${k.grade === 'Pre-Kindergarten' ? 'Pre-K' : k.grade})`).join(', '))}</div>
          </div></a>`;
      }).join('') || '<p class="empty">No matches.</p>'}
    </div>`;
}

function viewParent(id) {
  const p = S.byParent.get(+id);
  if (!p) return '<p class="empty">Not found.</p>';
  const kids = p.childIds.map((i) => S.byStudent.get(i)).filter(Boolean);
  const co = S.data.parents.filter((x) => x.id !== p.id && x.childIds.some((c) => p.childIds.includes(c)));

  return `
    <a class="back" href="#/parents">‹ Parents</a>
    <div class="head"><h1>${esc(p.name)}</h1></div>
    ${parentPanel(p)}

    ${co.length ? `<div class="section-label">Partner</div>
      <div class="panel">${co.map((c) => `<a class="rowlink" href="#/parent/${c.id}">
        <div><div class="t">${esc(c.name)}</div><div class="s">${esc(c.relation)}</div></div></a>`).join('')}</div>` : ''}

    <div class="section-label">Children</div>
    <div class="panel">
      ${kids.map((k) => `<a class="rowlink" href="#/kid/${k.id}">
        <img src="${photo(k.id)}" alt="">
        <div><div class="t">${esc(k.name)}</div><div class="s">${esc(k.grade)}</div></div></a>`).join('')}
    </div>

    <div class="section-label">Notes about ${esc(p.first)}</div>
    ${notesBlock('parent', p.id)}
  `;
}

function notesBlock(type, id) {
  const ns = notesFor(type, id);
  return `
    <div class="panel">
      ${ns.map((n) => `
        <div class="note" data-note="${esc(n.id)}">
          ${esc(n.text)}
          <div class="who">${esc(n.author)} · ${shortDate(n.createdAt)}
            <button data-del="${esc(n.id)}" style="color:var(--danger);margin-left:8px">delete</button>
          </div>
        </div>`).join('') || '<p class="faint" style="font-size:14px;margin:0">Nothing yet. What did you learn?</p>'}
      <div class="note-add">
        <textarea id="note-text" placeholder="Dad runs the Thursday soccer thing…"></textarea>
        <button class="btn btn-primary" id="note-save" data-type="${type}" data-id="${id}">Add</button>
      </div>
    </div>`;
}

// ── cram ──────────────────────────────────────────────────────────────────

let cram = null;

function viewCram() {
  if (!cram) {
    const gs = grades();
    return `
      <div class="head"><h1>Cram</h1></div>
      <p class="muted">Sixty seconds in the car. Faces first, names on tap.</p>
      ${gs.map((g) => {
        const n = S.data.students.filter((s) => s.grade === g).length;
        const rs = [...new Set(S.data.students.filter((s) => s.grade === g).map((s) => s.homeroom).filter(Boolean))].sort();
        return `<button class="btn btn-block" data-cram="${esc(g)}">${esc(g)} · ${n} kids</button>` +
          (rs.length > 1 ? rs.map((r) => {
            const rn = S.data.students.filter((s) => s.grade === g && s.homeroom === r).length;
            return `<button class="btn btn-block btn-sub" data-cram-room="${esc(g)}||${esc(r)}">${esc(r)}'s class · ${rn}</button>`;
          }).join('') : '');
      }).join('')}
      <button class="btn btn-block" data-cram="*">Everyone · ${S.data.students.length}</button>`;
  }

  const s = cram.deck[cram.i];
  const ps = parentsOf(s);
  const sibs = s.siblingIds.map((i) => S.byStudent.get(i)).filter(Boolean);

  return `
    <div class="cram">
      <div class="cram-top">
        <button data-cram-exit>Done</button>
        <span>${cram.i + 1} / ${cram.deck.length}</span>
      </div>
      <div class="cram-body" data-cram-flip>
        <img src="${photo(s.id)}" alt="">
        <div class="cram-name">${cram.shown ? esc(s.name) : '?'}</div>
        <div class="cram-reveal">${cram.shown ? `
          <b>${esc(firstNames(ps) || '—')} ${esc(s.last)}</b><br>
          ${esc(s.homeroom || '')}${s.homeroom ? ' · ' : ''}${esc(s.address?.city || '')}${s.milesFromHome != null ? ` · ${s.milesFromHome} mi` : ''}
          ${sibs.length ? `<br>sibling: ${esc(sibs.map((b) => `${b.first} (${b.grade === 'Pre-Kindergarten' ? 'Pre-K' : b.grade})`).join(', '))}` : ''}
        ` : '<span class="cram-hint">tap to reveal</span>'}</div>
      </div>
      <div class="cram-nav">
        <button class="btn" data-cram-prev>‹ Back</button>
        <button class="btn btn-primary" data-cram-next>Next ›</button>
      </div>
    </div>`;
}

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── quiz ──────────────────────────────────────────────────────────────────

let quiz = null;

function newQuizRound() {
  const pool = S.data.students.filter((s) => !S.grade || s.grade === S.grade);
  if (pool.length < 4) return null;
  /* Weight toward the ones you keep getting wrong — that's the whole point. */
  const weight = (s) => {
    const st = S.quizStats[s.id] || { seen: 0, wrong: 0 };
    return 1 + st.wrong * 3 + (st.seen === 0 ? 2 : 0);
  };
  const total = pool.reduce((t, s) => t + weight(s), 0);
  let r = Math.random() * total, answer = pool[0];
  for (const s of pool) { r -= weight(s); if (r <= 0) { answer = s; break; } }

  const others = shuffle(pool.filter((s) => s.id !== answer.id)).slice(0, 3);
  return { answer, options: shuffle([answer, ...others]), picked: null };
}

function viewQuiz() {
  if (!quiz) quiz = { round: newQuizRound(), right: 0, total: 0 };
  if (!quiz.round) return '<p class="empty">Need at least 4 kids to run a quiz.</p>';

  const gs = grades();
  const { answer, options, picked } = quiz.round;

  return `
    <div class="head"><h1>Quiz</h1>
      <span class="count">${quiz.total ? `${quiz.right}/${quiz.total}` : ''}</span></div>
    <div class="seg">
      <button data-grade="" aria-pressed="${!S.grade}">All</button>
      ${gs.map((g) => `<button data-grade="${esc(g)}" aria-pressed="${S.grade === g}">${esc(g === 'Pre-Kindergarten' ? 'Pre-K' : g)}</button>`).join('')}
    </div>
    <img class="quiz-photo" src="${photo(answer.id)}" alt="">
    <div class="quiz-opts">
      ${options.map((o) => {
        let cls = '';
        if (picked) cls = o.id === answer.id ? 'right' : (o.id === picked ? 'wrong' : '');
        return `<button class="${cls}" data-answer="${o.id}">${esc(o.name)}</button>`;
      }).join('')}
    </div>
    ${picked ? `<button class="btn btn-primary btn-block" style="margin-top:16px" data-quiz-next>Next ›</button>` : ''}
  `;
}

// ── settings ──────────────────────────────────────────────────────────────

function viewSettings() {
  const m = S.data.meta || {};
  const withBio = Object.values(S.data.bios || {}).filter((b) => b.bio).length;
  return `
    <div class="head"><h1>More</h1></div>

    <div class="section-label">Who's writing notes</div>
    <div class="seg">
      ${['Sean', 'Janice'].map((a) => `<button data-author="${a}" aria-pressed="${S.author === a}">${a}</button>`).join('')}
    </div>

    <div class="section-label">Notes</div>
    <div class="panel">
      <div class="kv"><span class="k">Saved on this device</span><span>${S.notes.length}</span></div>
      <p class="faint" style="font-size:13px;margin:10px 0 0">
        Export writes a file you can drop in your shared iCloud folder. Importing merges —
        nothing is overwritten, so it's safe to do in either direction.</p>
      <button class="btn btn-block" style="margin-top:12px" id="notes-export">Export notes</button>
      <label class="btn btn-block">Import &amp; merge notes
        <input type="file" id="notes-import" accept="application/json,.json" hidden></label>
    </div>

    <div class="section-label">Data</div>
    <div class="panel">
      <div class="kv"><span class="k">Students</span><span>${S.data.students.length}</span></div>
      <div class="kv"><span class="k">Parents</span><span>${S.data.parents.length}</span></div>
      <div class="kv"><span class="k">With background</span><span>${withBio}</span></div>
      <div class="kv"><span class="k">Collected</span><span>${m.collectedAt ? shortDate(Date.parse(m.collectedAt)) : '—'}</span></div>
      <label class="btn btn-block" style="margin-top:12px">Replace data file
        <input type="file" id="data-import" accept="application/json,.json" hidden></label>
    </div>

    <p class="faint" style="font-size:12.5px;margin-top:22px;text-align:center;line-height:1.5">
      Everything here is stored only on this device. Seven Hills directory information is
      confidential — it's for your family's own use, not for sharing or any commercial purpose.
    </p>`;
}

// ── router ────────────────────────────────────────────────────────────────

const ROUTES = [
  [/^#\/kids$/,            ()      => viewKids()],
  [/^#\/kid\/(\d+)$/,      (id)    => viewKid(id)],
  [/^#\/parents$/,         ()      => viewParents()],
  [/^#\/parent\/(\d+)$/,   (id)    => viewParent(id)],
  [/^#\/cram$/,            ()      => viewCram()],
  [/^#\/quiz$/,            ()      => viewQuiz()],
  [/^#\/settings$/,        ()      => viewSettings()],
];

function render() {
  if (!S.data) return;
  const hash = location.hash || '#/kids';
  let html = null;

  for (const [re, fn] of ROUTES) {
    const m = hash.match(re);
    if (m) { html = fn(...m.slice(1)); break; }
  }
  if (html === null) { location.hash = '#/kids'; return; }

  const view = el('view');
  view.innerHTML = html;
  /* Detail views should start at the top; list views keep their place. */
  if (/#\/(kid|parent)\//.test(hash)) window.scrollTo(0, 0);

  const tab = hash.match(/^#\/(kids|parents|cram|quiz|settings)/)?.[1]
           || (/#\/kid\//.test(hash) ? 'kids' : /#\/parent\//.test(hash) ? 'parents' : 'kids');
  document.querySelectorAll('#tabbar a').forEach((a) =>
    a.toggleAttribute('aria-current', a.dataset.tab === tab));
  el('tabbar').hidden = !!cram;
}

// ── events ────────────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-grade],[data-room],[data-author],[data-cram],[data-cram-room],[data-cram-exit],[data-cram-next],[data-cram-prev],[data-cram-flip],[data-answer],[data-quiz-next],[data-del],#note-save');
  if (!t) return;

  // grade filter — changing grade drops any homeroom filter, which won't apply
  if (t.dataset.grade !== undefined) {
    S.grade = t.dataset.grade || null;
    S.room = null;
    if (quiz) quiz = { round: newQuizRound(), right: 0, total: 0 };
    return render();
  }

  if (t.dataset.room !== undefined) { S.room = t.dataset.room || null; return render(); }

  if (t.dataset.author) { S.author = t.dataset.author; await DB.set('author', S.author); return render(); }

  // cram
  if (t.dataset.cram) {
    const g = t.dataset.cram;
    const pool = g === '*' ? S.data.students : S.data.students.filter((s) => s.grade === g);
    cram = { deck: shuffle(pool), i: 0, shown: false };
    return render();
  }
  if (t.dataset.cramRoom) {
    const [g, r] = t.dataset.cramRoom.split('||');
    cram = { deck: shuffle(S.data.students.filter((s) => s.grade === g && s.homeroom === r)), i: 0, shown: false };
    return render();
  }
  if (t.hasAttribute('data-cram-exit')) { cram = null; return render(); }
  if (t.hasAttribute('data-cram-flip')) { cram.shown = !cram.shown; return render(); }
  if (t.hasAttribute('data-cram-next')) { cram.i = (cram.i + 1) % cram.deck.length; cram.shown = false; return render(); }
  if (t.hasAttribute('data-cram-prev')) { cram.i = (cram.i - 1 + cram.deck.length) % cram.deck.length; cram.shown = false; return render(); }

  // quiz
  if (t.dataset.answer && !quiz.round.picked) {
    const id = +t.dataset.answer, correct = id === quiz.round.answer.id;
    quiz.round.picked = id;
    quiz.total++; if (correct) quiz.right++;
    const st = S.quizStats[quiz.round.answer.id] || { seen: 0, wrong: 0 };
    st.seen++; if (!correct) st.wrong++;
    S.quizStats[quiz.round.answer.id] = st;
    await DB.set('quizStats', S.quizStats);
    return render();
  }
  if (t.hasAttribute('data-quiz-next')) { quiz.round = newQuizRound(); return render(); }

  // notes
  if (t.id === 'note-save') {
    const box = el('note-text');
    const text = box.value.trim();
    if (!text) return;
    const n = { id: uid(), personKey: noteKey(t.dataset.type, +t.dataset.id),
                text, author: S.author, createdAt: Date.now() };
    await DB.notePut(n); S.notes.push(n); box.value = '';
    return render();
  }
  if (t.dataset.del) {
    await DB.noteDel(t.dataset.del);
    S.notes = S.notes.filter((n) => n.id !== t.dataset.del);
    return render();
  }
});

/* Live search, debounced just enough to stay smooth on a big list. */
let searchTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => {
    S.query = v;
    const sel = e.target.selectionStart;
    render();
    const box = el('q');
    if (box) { box.focus(); box.setSelectionRange(sel, sel); }
  }, 130);
});

document.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  if (e.target.id === 'data-import' || e.target.id === 'onboard-file') {
    try { await loadBundle(JSON.parse(await f.text())); location.hash = '#/kids'; boot(); }
    catch (err) { showOnboardError(err.message); }
  }

  if (e.target.id === 'notes-import') {
    const incoming = JSON.parse(await f.text());
    const have = new Set(S.notes.map((n) => n.id));
    let added = 0;
    for (const n of (incoming.notes || incoming)) {
      if (!n?.id || have.has(n.id)) continue;
      await DB.notePut(n); S.notes.push(n); added++;
    }
    alert(`Merged ${added} new note${added === 1 ? '' : 's'}.`);
    render();
  }
});

document.addEventListener('click', (e) => {
  if (e.target.id !== 'notes-export') return;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notes: S.notes }, null, 2)],
                        { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `whoswho-notes-${S.author.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

window.addEventListener('hashchange', render);

// ── boot ──────────────────────────────────────────────────────────────────

const showOnboardError = (msg) => {
  const box = el('onboard-err');
  box.textContent = `That file didn't work: ${msg}`;
  box.hidden = false;
};

async function loadBundle(bundle) {
  for (const k of ['students', 'parents', 'photos']) {
    if (!bundle?.[k]) throw new Error(`missing "${k}"`);
  }
  await DB.set('bundle', bundle);
}

async function boot() {
  const [bundle, author, quizStats, notes] = await Promise.all([
    DB.get('bundle'), DB.get('author'), DB.get('quizStats'), DB.notesAll(),
  ]);

  if (!bundle) { el('onboard').hidden = false; return; }

  S.data = bundle;
  S.notes = notes || [];
  S.author = author || 'Sean';
  S.quizStats = quizStats || {};
  S.byStudent = new Map(bundle.students.map((s) => [s.id, s]));
  S.byParent  = new Map(bundle.parents.map((p) => [p.id, p]));

  el('onboard').hidden = true;
  el('tabbar').hidden = false;
  if (!location.hash) location.hash = '#/kids';
  render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
