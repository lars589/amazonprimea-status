// status.amazonprimea.com — public dashboard JS.
// Polls /api/gds/public/* every 60 seconds. No auth, no SPA framework.

// ADR 0029: this mirror is hosted OFF the droplet (GitHub Pages), so every
// dashboard fetch is cross-origin against the live droplet. The droplet's
// /api/gds/public/* sends Access-Control-Allow-Origin: *, and every call below
// goes through fetchJson()/fetch() with a .catch → null, so when the droplet is
// down these panels degrade to their empty/placeholder state rather than break
// the page. The always-truthful availability banner (see index.html) does NOT
// depend on this — it reads off-box data from the status-data branch.
const API = 'https://amazonprimea.com';

const els = {
  uptime: document.getElementById('uptime'),
  versions: document.getElementById('versions'),
  costTotal: document.getElementById('cost-total'),
  valueTotal: document.getElementById('value-total'),
  costPercent: document.getElementById('cost-percent'),
  costCats: document.getElementById('cost-categories'),
  costTracks: document.getElementById('cost-tracks'),
  costBuilders: document.getElementById('cost-builders'),
  costAttributionSplit: document.getElementById('cost-attribution-split'),
  costChart: document.getElementById('cost-chart'),
  driftMedian: document.getElementById('drift-median'),
  driftSample: document.getElementById('drift-sample'),
  driftVersions: document.getElementById('drift-versions'),
  // Task 197 — Stonemason's Mark (quality grade tile)
  gradeAvg: document.getElementById('grade-avg'),
  gradePassRate: document.getElementById('grade-pass-rate'),
  gradeN: document.getElementById('grade-n'),
  gradeThreshold: document.getElementById('grade-threshold'),
  gradeChart: document.getElementById('grade-chart'),
  // V3.R91 #352 — The Mason's Ledger (repo-health tile)
  repoLoc: document.getElementById('repo-loc'),
  repoDead: document.getElementById('repo-dead'),
  repoBranches: document.getElementById('repo-branches'),
  repoConfirmed: document.getElementById('repo-confirmed'),
  repoChart: document.getElementById('repo-chart'),
  shipped: document.getElementById('shipped'),
  shippedPager: document.getElementById('shipped-pager'),
  shippedPrev: document.getElementById('shipped-prev'),
  shippedNext: document.getElementById('shipped-next'),
  shippedPageInfo: document.getElementById('shipped-pageinfo'),
  shippedRange: document.getElementById('shipped-range'),
  leaderboard: document.getElementById('leaderboard'),
  lastUpdated: document.getElementById('last-updated'),
  worldSnapshot: document.getElementById('world-snapshot'),
  worldTimeline: document.getElementById('world-timeline'),
  worldNote: document.getElementById('world-note'),
};

const ANNUAL_BUDGET_USD = 5000;
let costChart = null;
let gradeChart = null;
let repoChart = null;

// ---------- helpers ----------

function fmtUsd(n) {
  if (n == null) return '—';
  if (n < 100) return Number(n).toFixed(2);
  return Math.round(Number(n)).toLocaleString();
}

function fmtDr(n) {
  if (n == null) return '—';
  if (n < 100) return `${Number(n).toFixed(2)} dr.`;
  return `${Math.round(Number(n)).toLocaleString()} dr.`;
}

function fmtRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ---------- sticky section nav (#409) ----------
//
// Same design pattern as the hall (public-builders/builders.js renderNav).
// Independent implementation in this file because the two surfaces don't
// share a script and per the #409 spec they should evolve in their own
// scope. Labels are shorter than the section headings — chips need to fit
// in ~756px of content width without wrapping.

const SECTIONS = [
  { id: 'headline-tablet', label: 'Pulse'     },
  { id: 'world-tablet',    label: 'World'     },
  { id: 'versions-tablet', label: 'Works'     },
  { id: 'shipped-tablet',  label: 'Ships'     },
  { id: 'leader-tablet',   label: 'Roll'      },
  { id: 'cost-tablet',     label: 'Treasury'  },
  { id: 'grade-tablet',    label: 'Mark'      },
  { id: 'drift-tablet',    label: 'Drift'     },
  { id: 'repo-tablet',     label: 'Mason'     },
  { id: 'uptime-tablet',   label: 'Watch'     },
];

let navObserver = null;

function renderNav() {
  const list = document.getElementById('status-nav-list');
  const nav = document.getElementById('status-nav');
  if (!list || !nav) return;
  list.innerHTML = SECTIONS
    .filter((s) => document.getElementById(s.id))
    .map((s) => `<li><a class="status-nav__chip" href="#${s.id}" data-section="${s.id}">${s.label}</a></li>`)
    .join('');
  nav.hidden = false;
  setupNavObserver();
}

function setupNavObserver() {
  if (navObserver) {
    navObserver.disconnect();
    navObserver = null;
  }
  const list = document.getElementById('status-nav-list');
  if (!list) return;
  const chipsBySection = new Map();
  list.querySelectorAll('a[data-section]').forEach((a) => {
    chipsBySection.set(a.dataset.section, a);
  });
  if (chipsBySection.size === 0) return;
  const sections = Array.from(chipsBySection.keys())
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (sections.length === 0) return;

  // Same rootMargin band as the hall: active flips when a section's headline
  // crosses the upper third of the viewport, not when it merely peeks in.
  navObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        chipsBySection.forEach((chip, sectionId) => {
          chip.classList.toggle('status-nav__chip--active', sectionId === id);
        });
        // Auto-scroll the active chip into view on mobile.
        const active = chipsBySection.get(id);
        if (active && window.matchMedia('(max-width: 640px)').matches) {
          active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        break;
      }
    }
  }, {
    rootMargin: '-40% 0px -55% 0px',
    threshold: 0,
  });
  sections.forEach((sec) => navObserver.observe(sec));
}

// ---------- headline strip (#409) ----------
//
// Above-the-fold answer to "is it alive?", "what shipped lately?", "where's
// the money?", "is quality holding?" — fed by four public endpoints in
// parallel. Standing aggregates across all services: any down → "Fallen",
// any degraded → "Faltering", all up → "Standing". The treasury card shows
// percent-of-purse with a thin progress bar underneath; bar turns amber at
// 75% and terracotta at 100%.

function aggregateStanding(services) {
  if (!Array.isArray(services) || services.length === 0) {
    return { label: '—', cls: '' };
  }
  let anyDown = false, anyDegraded = false, anyUnknown = false;
  for (const s of services) {
    const st = s.current_status;
    if (st === 'down') anyDown = true;
    else if (st === 'degraded') anyDegraded = true;
    else if (st === 'unknown') anyUnknown = true;
  }
  if (anyDown) return { label: 'Fallen', cls: 'headline-stat--standing-down' };
  if (anyDegraded) return { label: 'Faltering', cls: 'headline-stat--standing-warn' };
  if (anyUnknown) return { label: '—', cls: '' };
  return { label: 'Standing', cls: 'headline-stat--standing-up' };
}

async function loadHeadline() {
  // 3 fetches in parallel — uptime + cost + grades. The 4th headline card
  // (shipped count) is computed from loadShipped's data via
  // updateHeadlineShippedFromItems() to avoid a duplicate /recent-shipped
  // round trip every 60s. See the comment in loadShipped() for the math.
  const [uptimeR, costR, gradeR] = await Promise.all([
    fetchJson('/api/gds/public/uptime').catch(() => null),
    fetchJson('/api/gds/public/cost-summary').catch(() => null),
    fetchJson('/api/gds/public/grades?days=7').catch(() => null),
  ]);

  // Standing card
  const standingNum = document.getElementById('headline-standing-num');
  const standingCard = document.getElementById('headline-standing');
  if (standingNum && standingCard) {
    const { label, cls } = aggregateStanding(uptimeR?.services || []);
    standingNum.textContent = label;
    // Reset state classes, apply new
    standingCard.classList.remove('headline-stat--standing-up', 'headline-stat--standing-down', 'headline-stat--standing-warn');
    if (cls) standingCard.classList.add(cls);
  }

  // Treasury
  const treasuryNum = document.getElementById('headline-treasury-num');
  const treasuryLabel = document.getElementById('headline-treasury-label');
  const treasuryBar = document.getElementById('headline-treasury-bar');
  if (treasuryNum && treasuryBar && costR) {
    const total = Number(costR.total_usd) || 0;
    const pct = ANNUAL_BUDGET_USD > 0 ? (total / ANNUAL_BUDGET_USD) * 100 : 0;
    treasuryNum.textContent = `${Math.round(pct)}%`;
    treasuryBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    treasuryBar.classList.remove('headline-bar__fill--warn', 'headline-bar__fill--over');
    if (pct >= 100) treasuryBar.classList.add('headline-bar__fill--over');
    else if (pct >= 75) treasuryBar.classList.add('headline-bar__fill--warn');
    if (treasuryLabel) {
      treasuryLabel.textContent = `$${fmtUsd(total)} of $${ANNUAL_BUDGET_USD.toLocaleString()} spent`;
    }
  }

  // Mason's Mark — pass rate over last 7 days
  const gradeNum = document.getElementById('headline-grade-num');
  if (gradeNum && gradeR) {
    const rolling = gradeR.rolling || {};
    const n = Number(rolling.n || 0);
    const passed = Number(rolling.n_passed || 0);
    if (n === 0) {
      gradeNum.textContent = '—';
    } else {
      gradeNum.textContent = `${Math.round((passed / n) * 100)}%`;
    }
  }
}

// ---------- world snapshot ----------

let _activeSnapshotId = null;

function fmtSnapshotWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function showSnapshot(snap) {
  if (!els.worldSnapshot || !snap) return;
  _activeSnapshotId = snap.id;

  clear(els.worldSnapshot);
  const img = document.createElement('img');
  img.src = `${API}/snapshots/${snap.image}`;
  img.alt = snap.label || `World map — ${snap.id}`;
  img.width = 960;
  img.height = 576;
  img.loading = 'lazy';
  els.worldSnapshot.appendChild(img);

  const caption = document.createElement('p');
  caption.className = 'world-snapshot__caption';
  const when = fmtSnapshotWhen(snap.timestamp);
  if (snap.label) {
    const strong = document.createElement('strong');
    strong.textContent = snap.label;
    caption.appendChild(strong);
    if (when) caption.append(` · ${when}`);
  } else {
    caption.textContent = when || snap.id;
  }
  if (snap.sha) {
    const sha = document.createElement('span');
    sha.className = 'world-snapshot__sha';
    sha.textContent = ` · ${snap.sha.slice(0, 7)}`;
    caption.appendChild(sha);
  }
  els.worldSnapshot.appendChild(caption);

  if (els.worldTimeline) {
    for (const item of els.worldTimeline.querySelectorAll('.world-timeline__item')) {
      item.setAttribute('aria-current', item.dataset.id === snap.id ? 'true' : 'false');
    }
  }
}

async function loadWorldSnapshots() {
  if (!els.worldSnapshot) return;

  let manifest;
  try {
    const res = await fetch(`${API}/snapshots/manifest.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    manifest = await res.json();
  } catch (_) {
    return;
  }

  // v2 format: { snapshots: [...] }. v1 (legacy): { dates: [...] }. Normalize.
  let snapshots = [];
  if (Array.isArray(manifest.snapshots)) {
    snapshots = manifest.snapshots.slice();
  } else if (Array.isArray(manifest.dates)) {
    snapshots = manifest.dates.map((d) => ({
      id: d,
      timestamp: `${d}T00:00:00Z`,
      image: `${d}.png`,
    }));
  }
  if (snapshots.length === 0) return;

  // Oldest → newest already from server; reverse to put newest first in strip.
  snapshots.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  const newestFirst = snapshots.slice().reverse();
  const latest = newestFirst[0];

  showSnapshot(latest);

  if (els.worldTimeline) {
    clear(els.worldTimeline);
    for (const snap of newestFirst) {
      const item = document.createElement('button');
      item.className = 'world-timeline__item';
      item.dataset.id = snap.id;
      item.setAttribute('aria-current', snap.id === latest.id ? 'true' : 'false');
      item.type = 'button';
      item.title = snap.label
        ? `${snap.label} — ${fmtSnapshotWhen(snap.timestamp)}`
        : fmtSnapshotWhen(snap.timestamp);

      const thumb = document.createElement('img');
      thumb.className = 'world-timeline__thumb';
      thumb.src = `${API}/snapshots/${snap.image}`;
      thumb.alt = snap.label || snap.id;
      thumb.width = 200;
      thumb.height = 120;
      thumb.loading = 'lazy';

      const label = document.createElement('span');
      label.className = 'world-timeline__date';
      const d = new Date(snap.timestamp);
      label.textContent = Number.isNaN(d.getTime())
        ? snap.id
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      item.appendChild(thumb);
      item.appendChild(label);
      item.addEventListener('click', () => showSnapshot(snap));
      els.worldTimeline.appendChild(item);
    }
  }

  if (els.worldNote && snapshots.length > 1) {
    els.worldNote.hidden = false;
  }
}

// ---------- uptime ----------

const SERVICE_LABELS = {
  game_server: 'The World',
  api:         'The Ledger',
  database:    'The Vault',
};

async function loadUptime() {
  let data;
  try {
    data = await fetchJson('/api/gds/public/uptime');
  } catch (_) {
    // Endpoint not yet deployed (migration not applied) — show graceful placeholder
    clear(els.uptime);
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'The sentinels have not yet taken their posts.';
    els.uptime.appendChild(p);
    return;
  }

  const services = data.services || [];
  clear(els.uptime);

  for (const svc of services) {
    const label = SERVICE_LABELS[svc.service] || svc.service;
    const isUp = svc.current_status === 'up';
    const isDegraded = svc.current_status === 'degraded';
    const isUnknown = svc.current_status === 'unknown';

    const row = document.createElement('div');
    row.className = 'uptime-row';

    // Top line: label + status badge + uptime %
    const top = document.createElement('div');
    top.className = 'uptime-row__top';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'uptime-row__name-wrap';

    const dot = document.createElement('span');
    dot.className = `uptime-dot uptime-dot--${isUnknown ? 'unknown' : isUp ? 'up' : isDegraded ? 'degraded' : 'down'}`;
    dot.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'uptime-row__name';
    name.textContent = label;

    const badge = document.createElement('span');
    badge.className = `uptime-badge uptime-badge--${isUnknown ? 'unknown' : isUp ? 'up' : isDegraded ? 'degraded' : 'down'}`;
    badge.textContent = isUnknown ? 'awaiting watch' : isUp ? 'standing' : isDegraded ? 'strained' : 'fallen';

    nameWrap.appendChild(dot);
    nameWrap.appendChild(name);
    nameWrap.appendChild(badge);

    const pctEl = document.createElement('span');
    pctEl.className = 'uptime-row__pct';
    pctEl.textContent = svc.uptime_pct_90d != null
      ? `${svc.uptime_pct_90d}% over 90 days`
      : 'no history yet';

    top.appendChild(nameWrap);
    top.appendChild(pctEl);
    row.appendChild(top);

    // History bars — last 90 days as hourly buckets collapsed into ~90 day-wide bars
    const history = svc.history || [];
    if (history.length > 0) {
      // Collapse hourly rows into daily buckets for display (up to 90 bars)
      const byDay = new Map();
      for (const h of history) {
        const day = new Date(h.hour).toISOString().slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, { up: 0, total: 0 });
        byDay.get(day).up += h.up;
        byDay.get(day).total += h.total;
      }

      // Fill in any missing days in the last 90 so gaps show as unknown
      const today = new Date();
      const days = [];
      for (let i = 89; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }

      const bars = document.createElement('div');
      bars.className = 'uptime-bars';
      bars.setAttribute('aria-label', `90-day uptime history for ${label}`);

      for (const day of days) {
        const bucket = byDay.get(day);
        const bar = document.createElement('span');
        bar.className = 'uptime-bar';
        if (!bucket) {
          bar.classList.add('uptime-bar--unknown');
          bar.title = `${day}: no data`;
        } else {
          const ratio = bucket.total > 0 ? bucket.up / bucket.total : 0;
          if (ratio >= 0.99) {
            bar.classList.add('uptime-bar--up');
          } else if (ratio >= 0.5) {
            bar.classList.add('uptime-bar--degraded');
          } else {
            bar.classList.add('uptime-bar--down');
          }
          bar.title = `${day}: ${Math.round(ratio * 100)}% (${bucket.up}/${bucket.total} checks)`;
        }
        bars.appendChild(bar);
      }
      row.appendChild(bars);

      const barLabels = document.createElement('div');
      barLabels.className = 'uptime-bars__labels';
      const lbl90 = document.createElement('span');
      lbl90.textContent = '90 days ago';
      const lblNow = document.createElement('span');
      lblNow.textContent = 'today';
      barLabels.appendChild(lbl90);
      barLabels.appendChild(lblNow);
      row.appendChild(barLabels);
    } else {
      const noHist = document.createElement('p');
      noHist.className = 'uptime-row__no-history';
      noHist.textContent = 'History accumulating — returns after the first day of watch.';
      row.appendChild(noHist);
    }

    els.uptime.appendChild(row);
  }
}

// ---------- versions ----------

// Fetch done-when criteria for a single version. Returns [] on any failure
// (the criteria block is decorative — never a reason to fail the whole
// versions render).
async function fetchDoneWhen(versionId) {
  try {
    const data = await fetchJson(`/api/gds/versions/${encodeURIComponent(versionId)}/done-when`);
    return Array.isArray(data.criteria) ? data.criteria : [];
  } catch (_) {
    return [];
  }
}

// Render the "X of Y criteria satisfied" expandable checklist under a
// version row. Mounted as a child of `row` so it sits below the percentage
// line. Returns the <details> node (caller doesn't need to do anything with
// it; we just inject and walk away).
function renderDoneWhenList(row, criteria, isInternal) {
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  const total = criteria.length;
  const satisfied = criteria.filter((c) => c.satisfied).length;

  const wrap = document.createElement('details');
  wrap.className = 'done-when';
  // Auto-expand when partially satisfied — a version that's mid-flight is
  // the most interesting state to surface. Fully satisfied + fully empty
  // collapse to keep the page compact.
  if (satisfied > 0 && satisfied < total) wrap.open = true;

  const summary = document.createElement('summary');
  summary.className = 'done-when__summary';

  const label = document.createElement('span');
  label.textContent = `${satisfied} of ${total} criteria satisfied`;

  const count = document.createElement('span');
  count.className = 'done-when__count';
  if (satisfied === total) count.classList.add('done-when__count--all');
  else if (satisfied === 0) count.classList.add('done-when__count--none');
  count.textContent = satisfied === total ? 'all wrought' : `${satisfied}/${total}`;

  summary.appendChild(label);
  summary.appendChild(count);
  wrap.appendChild(summary);

  const list = document.createElement('ul');
  list.className = 'done-when__list';

  for (const c of criteria) {
    const li = document.createElement('li');
    li.className = `done-when__item${c.satisfied ? ' done-when__item--satisfied' : ''}`;

    const mark = document.createElement('span');
    mark.className = 'done-when__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = c.satisfied ? '✓' : '○';

    const text = document.createElement('span');
    text.className = 'done-when__text';
    text.textContent = c.criterion_md;

    li.appendChild(mark);
    li.appendChild(text);
    list.appendChild(li);
  }

  wrap.appendChild(list);
  row.appendChild(wrap);

  // Mark unused-arg as intentional to keep eslint happy if it ever gets
  // turned on for this file.
  void isInternal;
  return wrap;
}

async function loadVersions() {
  const data = await fetchJson('/api/gds/public/progress');
  const rows = data.progress || [];
  clear(els.versions);
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No endeavors yet declared.';
    els.versions.appendChild(p);
    return;
  }

  // Fetch done-when for every version in parallel, then render in order.
  // The lookup is tiny (single SELECT per version, hits the
  // idx_done_when_version index) and the public endpoint is 60s-cached.
  const doneWhenByVersion = new Map();
  await Promise.all(
    rows.map(async (v) => {
      doneWhenByVersion.set(v.version_id, await fetchDoneWhen(v.version_id));
    })
  );

  for (const v of rows) {
    const isInternal = v.track === 'internal';
    const row = document.createElement('div');
    row.className = 'version-row';

    const top = document.createElement('div');
    top.className = 'version-row__top';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    const name = document.createElement('span');
    name.className = 'version-row__name';
    name.textContent = `${v.version_id} · ${v.name || ''}`;
    const tag = document.createElement('span');
    tag.className = `version-row__track version-row__track--${isInternal ? 'internal' : 'product'}`;
    tag.textContent = isInternal ? 'internal' : 'product';
    left.appendChild(name);
    left.appendChild(tag);

    const right = document.createElement('span');
    right.className = 'version-row__count';
    right.textContent = `${v.shipped_count} of ${v.total_count} wrought`;

    top.appendChild(left);
    top.appendChild(right);
    row.appendChild(top);

    // Paint-the-picture description (versions.done_when) — senate-voice copy
    // explaining what this version IS, rendered above the progress bar. Only
    // shown when the column is populated; shipped versions without copy stay
    // silent rather than render an empty paragraph.
    const doneWhen = (v.done_when || '').trim();
    if (doneWhen) {
      const desc = document.createElement('p');
      desc.className = 'version-row__desc';
      desc.textContent = doneWhen;
      row.appendChild(desc);
    }

    // Stacked three-segment bar — per the lifecycle (Phase 5):
    //   shipped     = deployed live (deepest fill)
    //   confirmed   = scanner+smoke passed, awaiting merge (mid fill)
    //   completed   = builder declared done, awaiting verification (lightest)
    //
    // Segments are sized by raw task count (not priority weight) so the bar
    // matches the "X of Y wrought" headline. The headline "% complete" line
    // below the bar stays priority-weighted (existing semantics).
    const total = Number(v.total_count) || 0;
    const cShipped = Number(v.lifecycle_shipped_count) || 0;
    const cConfirmed = Number(v.lifecycle_confirmed_count) || 0;
    const cCompleted = Number(v.lifecycle_completed_count) || 0;
    const pctOf = (n) => (total > 0 ? (n / total) * 100 : 0);

    const bar = document.createElement('div');
    bar.className = 'version-row__bar';

    const segShipped = document.createElement('div');
    segShipped.className = `version-row__seg version-row__seg--shipped${isInternal ? ' version-row__seg--internal' : ''}`;
    segShipped.style.width = `${pctOf(cShipped)}%`;
    segShipped.title = `${cShipped} shipped (deployed live)`;
    bar.appendChild(segShipped);

    const segConfirmed = document.createElement('div');
    segConfirmed.className = `version-row__seg version-row__seg--confirmed${isInternal ? ' version-row__seg--internal' : ''}`;
    segConfirmed.style.width = `${pctOf(cConfirmed)}%`;
    segConfirmed.title = `${cConfirmed} confirmed (awaiting merge)`;
    bar.appendChild(segConfirmed);

    const segCompleted = document.createElement('div');
    segCompleted.className = `version-row__seg version-row__seg--completed${isInternal ? ' version-row__seg--internal' : ''}`;
    segCompleted.style.width = `${pctOf(cCompleted)}%`;
    segCompleted.title = `${cCompleted} completed (awaiting verification)`;
    bar.appendChild(segCompleted);

    row.appendChild(bar);

    const pct = Number(v.percent_complete) || 0;
    const pctText = document.createElement('div');
    pctText.className = 'version-row__pct';
    pctText.textContent =
      `${pct}% complete · weighted by priority` +
      (cConfirmed + cCompleted > 0
        ? `  ·  ${cShipped} shipped, ${cConfirmed} confirmed, ${cCompleted} completed`
        : '');
    row.appendChild(pctText);

    // Done-when checklist (PMS-V2 #41). No-op for versions without seeded
    // criteria; renders as a collapsible "X of Y criteria satisfied" line.
    const criteria = doneWhenByVersion.get(v.version_id) || [];
    renderDoneWhenList(row, criteria, isInternal);

    els.versions.appendChild(row);
  }
}

// ---------- costs ----------

async function loadCosts() {
  const data = await fetchJson('/api/gds/public/cost-summary');
  const total = Number(data.total_usd) || 0;
  const totalValue = Number(data.total_value_credits) || 0;
  els.costTotal.textContent = fmtUsd(total);
  if (els.valueTotal) {
    els.valueTotal.textContent = totalValue.toLocaleString();
  }
  const pct = ANNUAL_BUDGET_USD > 0 ? Math.round((total / ANNUAL_BUDGET_USD) * 100) : 0;
  els.costPercent.textContent = `${pct}%`;

  // by-category
  clear(els.costCats);
  const cats = data.by_category || [];
  if (cats.length === 0) {
    const tag = document.createElement('span');
    tag.className = 'cost-cat';
    tag.textContent = 'No drachmae yet spent.';
    els.costCats.appendChild(tag);
  } else {
    for (const c of cats) {
      const tag = document.createElement('span');
      tag.className = 'cost-cat';
      const strong = document.createElement('strong');
      strong.textContent = c.category;
      tag.appendChild(strong);
      tag.append(` · ${fmtDr(c.total_usd)}`);
      els.costCats.appendChild(tag);
    }
  }

  // by-track — drachmae spent and value wrought, segmented by product vs
  // internal. Each track gets one chip combining both numbers so the
  // viewer sees "where the gold went" + "what got made for it" together.
  // GDS #170.
  if (els.costTracks) {
    clear(els.costTracks);
    const trackCost = new Map();
    for (const t of (data.by_track || [])) trackCost.set(t.track, Number(t.total_usd) || 0);
    const trackCred = new Map();
    for (const t of (data.by_track_credits || [])) trackCred.set(t.track, Number(t.total_credits) || 0);
    // Stable order: product, internal, then any leftovers (e.g. 'unattributed').
    const seen = new Set();
    const order = ['product', 'internal'];
    for (const k of [...trackCost.keys(), ...trackCred.keys()]) {
      if (!order.includes(k)) order.push(k);
    }
    let rendered = 0;
    for (const track of order) {
      if (seen.has(track)) continue;
      seen.add(track);
      const cost = trackCost.get(track) || 0;
      const cred = trackCred.get(track) || 0;
      if (cost === 0 && cred === 0) continue;
      const tag = document.createElement('span');
      tag.className = 'cost-cat';
      const strong = document.createElement('strong');
      strong.textContent = track;
      tag.appendChild(strong);
      tag.append(` · ${fmtDr(cost)} spent · ${cred.toLocaleString()} wrought`);
      els.costTracks.appendChild(tag);
      rendered++;
    }
    if (rendered === 0) {
      const tag = document.createElement('span');
      tag.className = 'cost-cat';
      tag.textContent = 'No drachmae yet attributed.';
      els.costTracks.appendChild(tag);
    }
  }

  // V3.R11 (#91): per-builder spend chips. Each builder with non-zero spend
  // gets one chip; unattributed historical spend (pre-migration 046 rows or
  // costs without a session) coalesces into a single "unattributed" chip.
  // V3.R83 (#303): an attributed-vs-unattributed headline above the per-builder
  // chips, so the community can read at a glance how much spend is owned by a
  // specific hand vs. carried by the shared keep. Computed from the same
  // by_builder split the audit (src/gds/cost.js) uses: builder_id === null is
  // the unattributed bucket.
  if (els.costAttributionSplit) {
    const all = data.by_builder || [];
    let attributed = 0;
    let unattributed = 0;
    for (const b of all) {
      const usd = Number(b?.total_usd) || 0;
      if (b?.builder_id == null) unattributed += usd;
      else attributed += usd;
    }
    const total = attributed + unattributed;
    if (total > 0) {
      const pct = Math.round((unattributed / total) * 100);
      els.costAttributionSplit.textContent =
        `Attributed to builders: ${fmtDr(attributed)} · Shared keep (unattributed): ${fmtDr(unattributed)} (${pct}%).`;
    } else {
      els.costAttributionSplit.textContent = '';
    }
  }

  if (els.costBuilders) {
    clear(els.costBuilders);
    const builders = data.by_builder || [];
    let rendered = 0;
    for (const b of builders) {
      if (!b || !(Number(b.total_usd) > 0)) continue;
      const tag = document.createElement('span');
      tag.className = 'cost-cat';
      const strong = document.createElement('strong');
      const label = b.builder_id == null
        ? 'unattributed'
        : (b.display_name || b.github_login || `builder #${b.builder_id}`);
      strong.textContent = label;
      tag.appendChild(strong);
      tag.append(` · ${fmtDr(b.total_usd)}`);
      els.costBuilders.appendChild(tag);
      rendered++;
    }
    if (rendered === 0) {
      const tag = document.createElement('span');
      tag.className = 'cost-cat';
      tag.textContent = 'No drachmae yet attributed to a hand.';
      els.costBuilders.appendChild(tag);
    }
  }

  // Build a unified day axis from the union of cost + credit days, then
  // walk it once and produce two cumulative series. 1 credit = 1 USD per
  // pms-v1.md, so both share the same numeric scale (left + right axes
  // share scaling per the dual-axis config below).
  //
  // GDS #118: the server's /cost-summary now returns a gap-free day series
  // (generate_series + LEFT JOIN, see src/gds/db.js costSummary) so the
  // cumulative line carries forward on idle days and reaches CURRENT_DATE.
  // We still defensively forward-fill + extend-to-today client-side as a
  // fallback for any deploy where the server is on older code.
  const costByDay = new Map();
  for (const d of (data.daily || [])) {
    costByDay.set(toDayKey(d.day), Number(d.amount_usd) || 0);
  }
  const valueByDay = new Map();
  for (const d of (data.daily_credits || [])) {
    valueByDay.set(toDayKey(d.day), Number(d.credits) || 0);
  }

  // Build the day axis spanning min(any-event-day) → today, inclusive.
  // If the server already filled gaps, this is a no-op walk over the same
  // set; if not, this is where the carry-forward gets enforced.
  const unionDays = Array.from(new Set([...costByDay.keys(), ...valueByDay.keys()])).sort();
  const todayKey = new Date().toISOString().slice(0, 10);
  let allDays = unionDays;
  if (unionDays.length > 0) {
    const firstKey = unionDays[0];
    const lastKey = unionDays[unionDays.length - 1] > todayKey
      ? unionDays[unionDays.length - 1]
      : todayKey;
    allDays = [];
    const cursor = new Date(`${firstKey}T00:00:00Z`);
    const end = new Date(`${lastKey}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      allDays.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const labels = [];
  const cumCost = [];
  const cumValue = [];
  let runningCost = 0;
  let runningValue = 0;
  for (const dayKey of allDays) {
    runningCost += costByDay.get(dayKey) || 0;
    runningValue += valueByDay.get(dayKey) || 0;
    labels.push(new Date(`${dayKey}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }));
    cumCost.push(Number(runningCost.toFixed(2)));
    cumValue.push(Number(runningValue.toFixed(2)));
  }

  if (!window.Chart) return; // Chart.js failed to load — skip

  const ctx = els.costChart.getContext('2d');
  if (costChart) costChart.destroy();
  costChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'drachmae spent',
          data: cumCost,
          fill: true,
          borderColor: '#2a2110',
          backgroundColor: 'rgba(139, 111, 44, 0.16)',
          tension: 0.2,
          pointRadius: 2.5,
          pointBackgroundColor: '#2a2110',
          borderWidth: 1.5,
        },
        {
          label: 'value wrought',
          data: cumValue,
          fill: false,
          borderColor: '#2f5a3f',
          backgroundColor: 'rgba(74, 125, 92, 0.18)',
          borderDash: [5, 4],
          tension: 0.2,
          pointRadius: 2.5,
          pointBackgroundColor: '#2f5a3f',
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      font: { family: '"EB Garamond", Georgia, serif' },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 22,
            padding: 18,
            font: { family: '"EB Garamond", Georgia, serif', size: 13, style: 'italic' },
            color: '#6e5b3a',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(42, 33, 16, 0.92)',
          titleFont: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' },
          bodyFont: { family: '"EB Garamond", Georgia, serif', size: 13 },
          padding: 10,
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} dr.`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'drachmae (cumulative)',
            font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' },
            color: '#735f3d',
          },
          ticks: {
            callback: (v) => `${v} dr.`,
            font: { family: '"EB Garamond", Georgia, serif', size: 12 },
            color: '#6e5b3a',
          },
          grid: { color: 'rgba(139, 111, 44, 0.18)', drawBorder: false },
        },
        x: {
          title: {
            display: true,
            text: 'date',
            font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' },
            color: '#735f3d',
          },
          grid: { display: false },
          ticks: {
            maxTicksLimit: 10,
            font: { family: '"EB Garamond", Georgia, serif', size: 12 },
            color: '#6e5b3a',
          },
        },
      },
    },
  });
}

function toDayKey(d) {
  // Postgres returns 'YYYY-MM-DD' as a string OR an ISO timestamp depending
  // on transport — normalise to YYYY-MM-DD so dedupe works across formats.
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

// ---------- estimation drift ----------

async function loadEstimationDrift() {
  let data;
  try {
    data = await fetchJson('/api/gds/public/estimation-drift');
  } catch (_) {
    return;
  }

  if (data.overall_median == null) {
    if (els.driftMedian) els.driftMedian.textContent = '—';
    if (els.driftSample) els.driftSample.textContent = '0';
    return;
  }

  if (els.driftMedian) els.driftMedian.textContent = data.overall_median.toFixed(2) + '×';
  if (els.driftSample) els.driftSample.textContent = String(data.sample_size);

  if (els.driftVersions) {
    clear(els.driftVersions);
    for (const v of (data.by_version || [])) {
      const tag = document.createElement('span');
      tag.className = 'cost-cat';
      const strong = document.createElement('strong');
      strong.textContent = v.version_id;
      tag.appendChild(strong);
      tag.append(` · ${v.median_ratio.toFixed(2)}× (${v.task_count} task${v.task_count === 1 ? '' : 's'})`);
      els.driftVersions.appendChild(tag);
    }
  }
}

// ---------- quality grade (Stonemason's Mark, task 197) ----------

async function loadGrades() {
  if (!els.gradeAvg) return;
  let data;
  try {
    data = await fetchJson('/api/gds/public/grades?days=7');
  } catch (_) {
    return;
  }
  const rolling = data.rolling || {};
  const n = Number(rolling.n || 0);

  if (els.gradeThreshold) {
    els.gradeThreshold.textContent = data.threshold != null ? Number(data.threshold).toFixed(1) : '—';
  }

  if (n === 0) {
    if (els.gradeAvg) els.gradeAvg.textContent = '—';
    if (els.gradePassRate) els.gradePassRate.textContent = '—';
    if (els.gradeN) els.gradeN.textContent = '0';
  } else {
    if (els.gradeAvg) els.gradeAvg.textContent = Number(rolling.avg_score).toFixed(1);
    const pct = (Number(rolling.n_passed || 0) / n) * 100;
    if (els.gradePassRate) els.gradePassRate.textContent = `${pct.toFixed(0)}%`;
    if (els.gradeN) els.gradeN.textContent = String(n);
  }

  // 30-day trend line chart. Renders when Chart.js is loaded; bails silently otherwise.
  if (els.gradeChart && typeof Chart !== 'undefined') {
    const trend = Array.isArray(data.trend) ? data.trend : [];
    const labels = trend.map((d) => d.day);
    const points = trend.map((d) => Number(d.avg_score));
    const threshold = Number(data.threshold || 5);
    const thresholdLine = trend.map(() => threshold);
    if (gradeChart) {
      gradeChart.data.labels = labels;
      gradeChart.data.datasets[0].data = points;
      gradeChart.data.datasets[1].data = thresholdLine;
      gradeChart.update();
    } else {
      gradeChart = new Chart(els.gradeChart.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'daily avg mark',
              data: points,
              borderColor: '#5b7a4d',
              backgroundColor: 'rgba(91,122,77,0.12)',
              tension: 0.35,
              pointRadius: 2,
              fill: true,
            },
            {
              label: 'passing mark',
              data: thresholdLine,
              borderColor: '#a98852',
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              min: 0,
              max: 10,
              ticks: { stepSize: 2 },
              title: { display: true, text: 'quality mark (0–10)', font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' }, color: '#735f3d' },
            },
            x: {
              ticks: { maxTicksLimit: 8 },
              title: { display: true, text: 'date', font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' }, color: '#735f3d' },
            },
          },
          plugins: {
            legend: { display: true, position: 'bottom' },
            tooltip: { backgroundColor: 'rgba(42, 33, 16, 0.92)', padding: 10 },
          },
        },
      });
    }
  }
}

// ---------- repo health (The Mason's Ledger, task 352) ----------

async function loadRepoHealth() {
  if (!els.repoLoc) return;
  let data;
  try {
    data = await fetchJson('/api/gds/public/repo-health?days=30');
  } catch (_) {
    return;
  }
  const latest = data.latest || null;

  if (!latest) {
    if (els.repoLoc) els.repoLoc.textContent = '—';
    if (els.repoDead) els.repoDead.textContent = '—';
    if (els.repoBranches) els.repoBranches.textContent = '—';
    if (els.repoConfirmed) els.repoConfirmed.textContent = '—';
    return;
  }

  if (els.repoLoc) {
    els.repoLoc.textContent =
      latest.total_loc != null ? Number(latest.total_loc).toLocaleString() : '—';
  }
  if (els.repoDead) {
    // dead_exports is null when knip is unavailable — show an em-dash, not 0.
    els.repoDead.textContent = latest.dead_exports == null ? '—' : String(latest.dead_exports);
  }
  if (els.repoBranches) els.repoBranches.textContent = String(latest.stale_branches ?? 0);
  if (els.repoConfirmed) els.repoConfirmed.textContent = String(latest.confirmed_unshipped ?? 0);

  // Trend chart: three lines (LOC on its own axis; dead-exports + stale
  // branches share a small right axis). Renders only when Chart.js is loaded.
  if (els.repoChart && typeof Chart !== 'undefined') {
    const trend = Array.isArray(data.trend) ? data.trend : [];
    const labels = trend.map((d) => d.snapshot_date);
    const loc = trend.map((d) => (d.total_loc == null ? null : Number(d.total_loc)));
    const dead = trend.map((d) => (d.dead_exports == null ? null : Number(d.dead_exports)));
    const branches = trend.map((d) => Number(d.stale_branches || 0));
    const datasets = [
      {
        label: 'lines of stonework',
        data: loc,
        borderColor: '#5b7a4d',
        backgroundColor: 'rgba(91,122,77,0.12)',
        tension: 0.35,
        pointRadius: 2,
        fill: true,
        yAxisID: 'yLoc',
      },
      {
        label: 'abandoned exports',
        data: dead,
        borderColor: '#a98852',
        tension: 0.35,
        pointRadius: 2,
        fill: false,
        yAxisID: 'yCount',
      },
      {
        label: 'unmerged works',
        data: branches,
        borderColor: '#8a5b5b',
        borderDash: [4, 4],
        tension: 0.35,
        pointRadius: 2,
        fill: false,
        yAxisID: 'yCount',
      },
    ];
    if (repoChart) {
      repoChart.data.labels = labels;
      repoChart.data.datasets[0].data = loc;
      repoChart.data.datasets[1].data = dead;
      repoChart.data.datasets[2].data = branches;
      repoChart.update();
    } else {
      repoChart = new Chart(els.repoChart.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            yLoc: {
              type: 'linear',
              position: 'left',
              beginAtZero: false,
              ticks: { maxTicksLimit: 6 },
              title: { display: true, text: 'lines of stonework', font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' }, color: '#735f3d' },
            },
            yCount: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              grid: { drawOnChartArea: false },
              ticks: { stepSize: 1, maxTicksLimit: 6 },
              title: { display: true, text: 'dead / unmerged (count)', font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' }, color: '#735f3d' },
            },
            x: {
              ticks: { maxTicksLimit: 8 },
              title: { display: true, text: 'date', font: { family: '"Cinzel", Georgia, serif', size: 11, weight: '500' }, color: '#735f3d' },
            },
          },
          plugins: {
            legend: { display: true, position: 'bottom' },
            tooltip: { backgroundColor: 'rgba(42, 33, 16, 0.92)', padding: 10 },
          },
        },
      });
    }
  }
}

// ---------- shipped feed ----------

const SHIPPED_PAGE_SIZE = 6;
let _shippedItems = [];
let _shippedPage = 0;
// GDS #191: default to the most useful window for daily readers. The select
// in index.html is also pre-selected to "30" so the two stay aligned.
let _shippedRange = '30';

function renderShippedPage() {
  clear(els.shipped);
  const items = _shippedItems;
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No works yet inscribed in this window.';
    els.shipped.appendChild(li);
    // GDS #191: pad with invisible rows so an empty window still occupies
    // the same vertical space as a full page. Keeps the section height
    // stable when the viewer switches between windows.
    for (let i = 0; i < SHIPPED_PAGE_SIZE - 1; i++) {
      const pad = document.createElement('li');
      pad.className = 'empty-row';
      pad.setAttribute('aria-hidden', 'true');
      els.shipped.appendChild(pad);
    }
    if (els.shippedPager) els.shippedPager.hidden = true;
    return;
  }

  const pageCount = Math.max(1, Math.ceil(items.length / SHIPPED_PAGE_SIZE));
  if (_shippedPage >= pageCount) _shippedPage = pageCount - 1;
  if (_shippedPage < 0) _shippedPage = 0;

  const start = _shippedPage * SHIPPED_PAGE_SIZE;
  const slice = items.slice(start, start + SHIPPED_PAGE_SIZE);

  for (const t of slice) {
    const li = document.createElement('li');
    const title = document.createElement('p');
    title.className = 'shipped__title';
    const ver = document.createElement('span');
    ver.className = 'shipped__version';
    ver.textContent = t.version_id;
    title.appendChild(ver);
    title.append(t.value_summary || t.title);
    const meta = document.createElement('p');
    meta.className = 'shipped__meta';
    const by = t.display_name || t.github_login;
    meta.textContent = `${by ? `inscribed by ${by} · ` : ''}${fmtRelativeTime(t.shipped_at)}`;
    li.appendChild(title);
    li.appendChild(meta);
    els.shipped.appendChild(li);
  }

  // GDS #191: pad the trailing rows on the last page (or any underfilled
  // page) with invisible placeholders so the section height never jumps as
  // the user pages forward / back. Empty rows are aria-hidden so screen
  // readers don't announce phantom entries.
  const padCount = SHIPPED_PAGE_SIZE - slice.length;
  for (let i = 0; i < padCount; i++) {
    const pad = document.createElement('li');
    pad.className = 'empty-row';
    pad.setAttribute('aria-hidden', 'true');
    els.shipped.appendChild(pad);
  }

  if (els.shippedPager) {
    if (pageCount > 1) {
      els.shippedPager.hidden = false;
      if (els.shippedPageInfo) {
        els.shippedPageInfo.textContent = `page ${_shippedPage + 1} of ${pageCount}`;
      }
      if (els.shippedPrev) els.shippedPrev.disabled = _shippedPage === 0;
      if (els.shippedNext) els.shippedNext.disabled = _shippedPage >= pageCount - 1;
    } else {
      els.shippedPager.hidden = true;
    }
  }
}

if (els.shippedPrev) {
  els.shippedPrev.addEventListener('click', () => {
    if (_shippedPage > 0) {
      _shippedPage--;
      renderShippedPage();
    }
  });
}
if (els.shippedNext) {
  els.shippedNext.addEventListener('click', () => {
    _shippedPage++;
    renderShippedPage();
  });
}
if (els.shippedRange) {
  els.shippedRange.addEventListener('change', () => {
    _shippedRange = els.shippedRange.value || 'all';
    _shippedPage = 0;
    loadShipped();
  });
}

async function loadShipped() {
  // GDS #191: forward the active window to the API. `all` returns everything;
  // numeric values restrict to a trailing N-day window server-side.
  const url = `/api/gds/public/recent-shipped?days=${encodeURIComponent(_shippedRange)}`;
  const data = await fetchJson(url);
  _shippedItems = data.tasks || [];
  renderShippedPage();
  // #409 efficiency follow-up: piggyback the 7-day count for the headline
  // strip onto this fetch instead of a separate `?days=7` round trip.
  // Range options are 7|30|90|all — every choice covers at least 7 days, so
  // _shippedItems is always a superset of the last 7 days; client-side
  // filtering is exact. Avoids fetching the same task list twice per cycle.
  updateHeadlineShippedFromItems();
}

function updateHeadlineShippedFromItems() {
  const el = document.getElementById('headline-shipped-num');
  if (!el) return;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const t of _shippedItems) {
    if (!t.shipped_at) continue;
    const ms = new Date(t.shipped_at).getTime();
    if (Number.isFinite(ms) && ms >= sevenDaysAgo) count++;
  }
  el.textContent = String(count);
}

// ---------- leaderboard ----------

// Set is locked at 8 for V2 (per limitations/pms-v2.md), so hardcoding the
// emoji map here is cheaper than another API round-trip per page load.
// Mirrors public-builders/builders.js — keep both in sync if the catalog
// ever shifts (would require an ADR + version bump per the V2 contract).
const ACH_EMOJI = {
  'first-ship': '🚢',
  'first-claim': '🪙',
  'first-parallel-claim': '⚓',
  'streak-3': '🔥',
  'streak-7': '🌋',
  'art-pipeline-shipper': '🎨',
  'gds-shipper': '⚙️',
  'breaking-the-100c-bar': '💯',
};

function renderAchievementRow(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const row = document.createElement('span');
  row.className = 'leader__achievements';
  row.setAttribute('aria-label', 'achievements');
  for (const id of ids) {
    const emoji = ACH_EMOJI[id];
    if (!emoji) continue;
    const span = document.createElement('span');
    span.className = 'leader__ach';
    span.title = id;
    span.setAttribute('aria-label', id);
    span.textContent = emoji;
    row.appendChild(span);
  }
  return row.children.length > 0 ? row : null;
}

async function loadLeaderboard() {
  const data = await fetchJson('/api/gds/public/leaderboard');
  const rows = data.leaderboard || [];
  clear(els.leaderboard);
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No builders yet — be the first.';
    els.leaderboard.appendChild(li);
    return;
  }
  // The API enrichment (#188) already trims to top 10 by total_credits and
  // the catalog is locked at 8, so paging here is forward-compat. Today's
  // builder count is <10; we render the whole array as-is.
  for (const b of rows) {
    const li = document.createElement('li');
    const avatar = document.createElement('img');
    avatar.className = 'leader__avatar';
    avatar.src = b.avatar_url || '';
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';
    if (!b.avatar_url) avatar.style.visibility = 'hidden';
    const name = document.createElement('div');
    name.className = 'leader__name';
    name.textContent = b.display_name;
    const login = document.createElement('span');
    login.className = 'leader__login';
    login.textContent = `@${b.github_login}`;
    name.appendChild(login);
    const badges = renderAchievementRow(b.achievements);
    if (badges) name.appendChild(badges);
    const credits = document.createElement('div');
    credits.className = 'leader__credits';
    credits.textContent = `${(Number(b.total_credits) || 0).toLocaleString()}`;
    const unit = document.createElement('span');
    unit.className = 'leader__credits-unit';
    unit.textContent = 'drachmae';
    credits.appendChild(unit);
    // Per-track split (GDS #170) — small italic line under the headline
    // count. Suppressed when the API doesn't carry the split (forward-compat)
    // or when both halves are zero.
    const cp = Number(b.credits_product) || 0;
    const ci = Number(b.credits_internal) || 0;
    if (cp + ci > 0) {
      const split = document.createElement('div');
      split.className = 'leader__credits-unit';
      split.style.display = 'block';
      split.style.marginLeft = '0';
      split.textContent = `${cp.toLocaleString()} product · ${ci.toLocaleString()} internal`;
      credits.appendChild(split);
    }
    li.appendChild(avatar);
    li.appendChild(name);
    li.appendChild(credits);
    els.leaderboard.appendChild(li);
  }
}

// ---------- main ----------

async function refresh() {
  const tasks = [
    loadHeadline().catch((e) => console.error('headline', e)),
    loadWorldSnapshots().catch((e) => console.error('snapshots', e)),
    loadUptime().catch((e) => console.error('uptime', e)),
    loadVersions().catch((e) => console.error('versions', e)),
    loadCosts().catch((e) => console.error('costs', e)),
    loadEstimationDrift().catch((e) => console.error('estimation-drift', e)),
    loadGrades().catch((e) => console.error('grades', e)),
    loadRepoHealth().catch((e) => console.error('repo-health', e)),
    loadShipped().catch((e) => console.error('shipped', e)),
    loadLeaderboard().catch((e) => console.error('leaderboard', e)),
  ];
  await Promise.all(tasks);
  const t = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  els.lastUpdated.textContent = `tablet last consulted at ${t}`;
}

// #409: render the sticky nav as soon as the DOM is parsed. It doesn't
// depend on any data — sections are static in the HTML — so it can light
// up immediately instead of waiting for the first /api/gds/public/* round
// trip. The observer wires itself.
renderNav();

refresh();
setInterval(refresh, 60_000);
