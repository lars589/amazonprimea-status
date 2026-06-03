#!/usr/bin/env node
// External uptime prober for amazonprimea.com (incident 2026-06-03, task #565).
//
// WHY THIS EXISTS, AND WHY IT IS NOT src/gds/uptime-poller.js:
//   The in-process poller (src/gds/uptime-poller.js) runs INSIDE the Node
//   process on the droplet and probes 127.0.0.1. When the droplet is down,
//   that poller is down too, so it records nothing — the outage becomes a data
//   gap that renders as "100% up". A monitor cannot witness its own death.
//   This script is the opposite: it runs on a GitHub-hosted runner (off our
//   infrastructure) and probes the PUBLIC URL from the outside, exactly as a
//   visitor would. It is the source of truth for real availability.
//
// WHAT IT DOES:
//   - Probes a target URL up to N times (default 3) with a gap between tries.
//     UP if any attempt returns HTTP 200; DOWN only if every attempt fails.
//     The in-run retries suppress single transient blips, so a run that
//     reports DOWN is a confirmed outage worth alerting on.
//   - Appends the result to <dir>/history.jsonl and rewrites <dir>/status.json
//     (a small snapshot + rolling uptime summary). These files live on the
//     off-box `status-data` branch (see .github/workflows/status-probe.yml),
//     so The Watch can read truthful uptime even while the droplet is dark.
//   - Prunes history to the trailing 90 days (matches The Watch's window).
//   - Writes `status=up|down` (+ latency, http_status) to $GITHUB_OUTPUT when
//     run inside Actions, so the workflow can decide whether to alert.
//
// EXIT CODE: 0 on success regardless of up/down (the workflow owns alerting via
//   the step output). Non-zero only on its own internal error.
//
// USAGE:
//   node scripts/status-probe.mjs [--dir .] [--target https://amazonprimea.com/healthz]
//                                 [--attempts 3] [--timeout-ms 15000] [--gap-ms 10000]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  dir: '.',
  target: 'https://amazonprimea.com/healthz',
  attempts: 3,
  'timeout-ms': 15000,
  'gap-ms': 10000,
};
const PRUNE_DAYS = 90;

export function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key in DEFAULTS) out[key] = argv[++i];
    }
  }
  out.attempts = Number(out.attempts);
  out['timeout-ms'] = Number(out['timeout-ms']);
  out['gap-ms'] = Number(out['gap-ms']);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HTTP attempt. Resolves { ok, httpStatus, latencyMs }. Never throws.
async function attempt(target, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(target, {
      signal: ac.signal,
      redirect: 'manual', // a 200 must come from the origin, not a redirect chain
      headers: { 'User-Agent': 'amazonprimea-status-probe/1.0 (+github-actions)' },
    });
    return { ok: res.status === 200, httpStatus: res.status, latencyMs: Date.now() - start };
  } catch (_) {
    return { ok: false, httpStatus: null, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

// Probe with confirmation retries. UP if any attempt is a 200.
async function probe({ target, attempts, timeoutMs, gapMs }) {
  let last = { ok: false, httpStatus: null, latencyMs: null };
  for (let i = 0; i < attempts; i++) {
    const r = await attempt(target, timeoutMs);
    if (r.ok) return { status: 'up', httpStatus: r.httpStatus, latencyMs: r.latencyMs, tries: i + 1 };
    last = r;
    if (i < attempts - 1) await sleep(gapMs);
  }
  return { status: 'down', httpStatus: last.httpStatus, latencyMs: last.latencyMs, tries: attempts };
}

export async function readHistory(file) {
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch (_) { /* skip corrupt line */ }
  }
  return rows;
}

export function uptimePct(rows, sinceMs) {
  const inWindow = rows.filter((r) => Date.parse(r.t) >= sinceMs);
  if (inWindow.length === 0) return null;
  const up = inWindow.filter((r) => r.status === 'up').length;
  return Math.round((up / inWindow.length) * 10000) / 100; // 2 d.p.
}

async function emitGithubOutput(kv) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  const lines = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  await writeFile(f, lines, { flag: 'a' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir);
  await mkdir(dir, { recursive: true });
  const historyFile = path.join(dir, 'history.jsonl');
  const statusFile = path.join(dir, 'status.json');

  const result = await probe({
    target: args.target,
    attempts: args.attempts,
    timeoutMs: args['timeout-ms'],
    gapMs: args['gap-ms'],
  });

  const now = new Date();
  const record = {
    t: now.toISOString(),
    status: result.status,
    http_status: result.httpStatus,
    latency_ms: result.latencyMs,
    tries: result.tries,
  };

  // Append + prune to the trailing 90 days.
  const cutoff = now.getTime() - PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const history = (await readHistory(historyFile)).filter((r) => Date.parse(r.t) >= cutoff);
  history.push(record);
  await writeFile(historyFile, history.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const dayMs = 24 * 60 * 60 * 1000;
  const snapshot = {
    generated_at: now.toISOString(),
    target: args.target,
    current: record,
    summary: {
      uptime_24h: uptimePct(history, now.getTime() - dayMs),
      uptime_7d: uptimePct(history, now.getTime() - 7 * dayMs),
      uptime_90d: uptimePct(history, now.getTime() - 90 * dayMs),
      checks_total: history.length,
    },
  };
  await writeFile(statusFile, JSON.stringify(snapshot, null, 2) + '\n');

  await emitGithubOutput({
    status: result.status,
    http_status: result.httpStatus ?? '',
    latency_ms: result.latencyMs ?? '',
  });

  const icon = result.status === 'up' ? '🟢' : '🔴';
  console.log(
    `${icon} ${result.status.toUpperCase()} — ${args.target} ` +
    `(http=${result.httpStatus ?? 'n/a'}, latency=${result.latencyMs ?? 'n/a'}ms, tries=${result.tries})`
  );
  console.log(`   history: ${history.length} checks · 24h ${snapshot.summary.uptime_24h ?? 'n/a'}% · 90d ${snapshot.summary.uptime_90d ?? 'n/a'}%`);
}

// Run as a CLI only when invoked directly (not when imported by tests).
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  main().catch((err) => {
    console.error('[status-probe] internal error:', err.message);
    process.exit(2);
  });
}
