// status.amazonprimea.com — public dashboard JS.
// Polls /api/gds/public/* every 60 seconds. No auth, no SPA framework.

// API base for the public read endpoints (#737). Empty = same-origin, the case
// when this file is served by the droplet itself (status.amazonprimea.com
// proxies /api/* to the same Node process). The OFF-BOX GitHub Pages mirror
// (lars589/amazonprimea-status, ADR 0029) injects window.STATUS_API_BASE =
// 'https://amazonprimea.com' in its <head> so the same byte-identical file
// fetches cross-origin from the droplet there (CORS is open). Keeping this file
// identical on both hosts is what lets the mirror sync be a pure copy.
const API = (typeof window !== 'undefined' && window.STATUS_API_BASE) || '';

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
  { id: 'headline-tablet', label: 'Pulse'      },
  { id: 'uptime-tablet',   label: 'Watch'      },
  { id: 'leader-tablet',   label: 'Architects' },
  { id: 'versions-tablet', label: 'Works'      },
  { id: 'cost-tablet',     label: 'Treasury'   },
  { id: 'shipped-tablet',  label: 'Inscribed'  },
  { id: 'world-tablet',    label: 'World'      },
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

// ---------- versions (active endeavours — a thin mirror of the work board) ----------

async function loadVersions() {
  const data = await fetchJson('/api/gds/public/progress');
  const all = data.progress || [];
  // This public section is a deliberately thin MIRROR of the builders' work
  // board (task 938). The work board is the canonical home of Works in Progress
  // — it carries every version with its criteria, the progress bars, and the
  // live in-flight list. Here we show only the ACTIVE endeavours, title + short
  // description, nothing more.
  //
  // Active = underway, not past: exclude shipped/frozen, and exclude any version
  // with no done_when_criteria seeded yet — a "future placeholder" the senate
  // has not scoped (e.g. the next-version stub created at version close). Its
  // criteria_count is 0, so it stays off the public board until it's real.
  const rows = all.filter(
    (v) => v.status !== 'shipped' && v.status !== 'frozen' && Number(v.criteria_count) > 0
  );
  clear(els.versions);
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No endeavors underway just now.';
    els.versions.appendChild(p);
    return;
  }

  for (const v of rows) {
    const row = document.createElement('div');
    row.className = 'version-row';

    const name = document.createElement('div');
    name.className = 'version-row__name';
    name.textContent = `${v.version_id} · ${v.name || ''}`;
    row.appendChild(name);

    // Short description (versions.done_when) — senate-voice copy explaining what
    // this endeavour IS. Shown only when populated; a version without copy stays
    // a bare title rather than rendering an empty paragraph.
    const doneWhen = (v.done_when || '').trim();
    if (doneWhen) {
      const desc = document.createElement('p');
      desc.className = 'version-row__desc';
      desc.textContent = doneWhen;
      row.appendChild(desc);
    }

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

// Stamp the banner with the current local time. Called at the START of each
// refresh cycle (before any awaits) so the displayed time matches when the
// round trip was initiated, not when it completed. Stamping early also avoids
// a race where two concurrent refresh() calls stamp in the wrong order (the
// slower first call could overwrite a more-recent stamp from the faster second
// call). null-guarded: els.lastUpdated is set once at module load and should
// always be valid, but the guard makes future refactors safe.
function stampRefreshTime() {
  if (!els.lastUpdated) return;
  const t = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  els.lastUpdated.textContent = `tablet last consulted at ${t}`;
}

async function refresh() {
  // Stamp the banner BEFORE the async work so it shows when this refresh
  // started, not when it finished. Fixes the apparent "wrong time" when
  // API calls are slow or when concurrent refresh() calls race.
  stampRefreshTime();
  const tasks = [
    loadHeadline().catch((e) => console.error('headline', e)),
    loadWorldSnapshots().catch((e) => console.error('snapshots', e)),
    loadUptime().catch((e) => console.error('uptime', e)),
    loadVersions().catch((e) => console.error('versions', e)),
    loadCosts().catch((e) => console.error('costs', e)),
    loadShipped().catch((e) => console.error('shipped', e)),
    loadLeaderboard().catch((e) => console.error('leaderboard', e)),
  ];
  await Promise.all(tasks);
}

// #409: render the sticky nav as soon as the DOM is parsed. It doesn't
// depend on any data — sections are static in the HTML — so it can light
// up immediately instead of waiting for the first /api/gds/public/* round
// trip. The observer wires itself.
renderNav();

refresh();
setInterval(refresh, 60_000);

// Re-refresh immediately when the tab regains focus after being in the
// background. Browsers throttle setInterval in hidden tabs, so the banner
// timestamp and data can lag by many minutes. This brings the page up to date
// the moment the viewer looks at it again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
