#!/usr/bin/env node
/**
 * check-route-surface — the policy registry agrees with blueprint §8.2, row for
 * row, in both directions.
 *
 * **Drift 4 is why this exists.** It was raised in session 3 and lived for five
 * sessions: §8.2 listed 23 rows and the registry carried 20, and the two
 * disagreed in *both* directions at once — two MVP-1 routes missing and a
 * phase-2 route present. Every session that noticed it noticed it by hand, by
 * re-enumerating twenty-odd paths and diffing them by eye, and the finding had
 * to be re-derived from scratch each time because nothing held it.
 *
 * A number in a document is not a control. This is the control.
 *
 * The comparison is by `METHOD path` and nothing else. It does not check
 * audiences, actions or response schemas — `assertRouteCoverage` does that, and
 * a checker whose name is broader than its mechanism is the defect this
 * repository hunts, so the blind spots are stated rather than implied:
 *
 *   - It reads the BUILT blueprint. `src/build.py` reproduces it byte-identically
 *     from `src/parts/`, and `pnpm check:docs` runs that build, so a stale
 *     built file fails there rather than here.
 *   - It cannot tell a correct path from a plausible one. If §8.2 and the
 *     registry both say `/api/client/v1/projekts`, this passes.
 *   - Query strings are stripped: §8.2 writes `/compare?options=` where the
 *     router registers `/compare`. That normalisation is the one place this
 *     checker interprets rather than compares, and it is pinned in the
 *     self-test.
 */

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Rows where §8.2's "phase 2" defers a SUB-FEATURE and not the route.
 *
 * Exemptions-as-data with the reason beside each, because this is the one place
 * the checker must interpret prose rather than compare strings — and an
 * interpretation nobody wrote down is one the next reader re-derives, which is
 * how drift 4 survived five sessions in the first place. The distinction was
 * already recorded in three documents and enforced by none of them.
 *
 * A stale entry fails: see `staleSubFeatureExemptions`. An exemption for a row
 * that is no longer marked phase 2 is a justification honouring nothing.
 */
export const SUB_FEATURE_PHASE_2 = Object.freeze({
  'GET /api/client/v1/submissions/:id':
    '§8.2 reads "Status and disposition. RFI thread is phase 2" — the RFI THREAD is deferred, ' +
    'not the route. The route is MVP-1: §15.2 step 6 cannot complete without it.',
});

/** `METHOD path`, the key both sides are reduced to. */
export function routeKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Every route row in §8.2 of the built blueprint, with whether the blueprint
 * itself marks it phase 2.
 *
 * Bounded to the §8.2 table: the document mentions paths in prose elsewhere,
 * and a checker that swept the whole file would compare the registry against
 * every path anyone ever wrote down.
 */
export function blueprintRoutes(html, exemptions = SUB_FEATURE_PHASE_2) {
  const start = html.indexOf('8.2');
  if (start === -1) return [];
  const tableStart = html.indexOf('<tbody', start);
  const tableEnd = html.indexOf('</tbody>', tableStart);
  if (tableStart === -1 || tableEnd === -1) return [];
  const body = html.slice(tableStart, tableEnd);

  const out = [];
  const rowRe = /<tr>(.*?)<\/tr>/gs;
  let row;
  let band = null;
  while ((row = rowRe.exec(body)) !== null) {
    // A full-width row is a BAND heading — "Client surface", "Internal
    // surface" — not a route. Carried forward so each route knows which
    // section of the table it was filed under.
    const heading = /colspan="3"[^>]*>([^<]+)/.exec(row[1]);
    if (heading !== null) {
      band = heading[1].split('&mdash;')[0].split('—')[0].trim();
      continue;
    }
    const cell = /<td><code>\s*(GET|POST|PUT|DELETE)\s+([^<]+?)\s*<\/code><\/td>/.exec(row[1]);
    if (cell === null) continue;
    // §8.2 writes the query string on one row; the router registers the path.
    const path = cell[2].split('?')[0];
    const key = routeKey(cell[1], path);
    out.push({
      key,
      band,
      path,
      phase2:
        /<b>phase 2<\/b>/i.test(row[1]) && !Object.hasOwn(exemptions, key),
      marked: /<b>phase 2<\/b>/i.test(row[1]),
    });
  }
  return out;
}

/**
 * Which path prefix each §8.2 band is for.
 *
 * WHY THIS IS A CONTROL AND NOT A TIDY-UP. The bands are how a reader decides
 * what a route IS — the table's own subtitle says the client and internal
 * namespaces are "hard-separated by actor_type", and the band is where that
 * separation is visible at a glance. The registry keys `namespace` off the same
 * distinction, `authorize.test.ts` asserts a client-namespace route is always a
 * `/api/client` path, and `NAMESPACE_ACTORS` decides who may reach it.
 *
 * The §8.2 amendment of 2026-09-05 filed two `/api/client` routes inside the
 * Internal surface band, and `POST /api/client/v1/invitations` had been sitting
 * there since the table was written. Nothing noticed, because this checker
 * compared rows and never asked which band they were in — so the blueprint said
 * two client routes were internal surface while the code said otherwise, and
 * both were green. A reader deciding an authorization question from the
 * blueprint would have got it wrong.
 */
export const BAND_PREFIXES = Object.freeze({
  'Authentication surface': '/api/auth/',
  'Client surface': '/api/client/',
  'Internal surface': '/api/internal/',
});

/**
 * Every §8.2 row filed under a band its path does not belong to, plus any band
 * heading this rule does not know.
 *
 * Pure, for the reason every other function here is: the self-test feeds it
 * rows rather than a blueprint.
 */
export function bandViolations(rows, prefixes = BAND_PREFIXES) {
  const problems = [];
  let placed = 0;
  for (const row of rows) {
    if (row.band === null || row.band === undefined) {
      problems.push(
        `${row.key} appears in §8.2 before any band heading. Every route belongs to a band — ` +
          'the band is how a reader tells a client route from an internal one.',
      );
      continue;
    }
    const prefix = prefixes[row.band];
    if (prefix === undefined) {
      problems.push(
        `§8.2 has a band this checker does not know: "${row.band}". Add it to BAND_PREFIXES with ` +
          'the path prefix it is for, or the rows under it are unchecked.',
      );
      continue;
    }
    placed += 1;
    if (!row.path.startsWith(prefix)) {
      problems.push(
        `${row.key} is filed under "${row.band}", whose rows are ${prefix}… . The band is where ` +
          'a reader sees the client/internal separation, and the registry keys `namespace` off ' +
          'the same distinction — a row in the wrong band says the opposite of what the code does.',
      );
    }
  }
  // A rule that placed nothing checked nothing.
  if (rows.length > 0 && placed === 0) {
    problems.push(
      'no §8.2 row was matched to a known band — refusing to report that every row is filed ' +
        'correctly when none of them was checked.',
    );
  }
  return problems;
}

/** `ROUTES` and `PHASE_2_ROUTES` from the registry source, as key lists. */
export function registryRoutes(src) {
  const listOf = (name) => {
    const start = src.indexOf(`export const ${name}`);
    if (start === -1) return [];
    const end = src.indexOf('\n];', start);
    if (end === -1) return [];
    const slice = src.slice(start, end);
    const out = [];
    const re = /^ {2}\{ method: '(GET|POST|PUT|DELETE)', path: '([^']+)'/gm;
    let m;
    while ((m = re.exec(slice)) !== null) out.push(routeKey(m[1], m[2]));
    return out;
  };
  return { mvp1: listOf('ROUTES'), phase2: listOf('PHASE_2_ROUTES') };
}

/**
 * Every disagreement, both directions, MVP-1 and phase-2 separately.
 *
 * Pure, taking both sides as text, so the self-test needs no repository.
 */
/**
 * Exemptions naming a row §8.2 no longer marks phase 2 at all. Same posture as
 * check-rls's dead-entry check: the list is data, and dead entries fail.
 */
export function staleSubFeatureExemptions(blueprint, exemptions = SUB_FEATURE_PHASE_2) {
  const marked = new Set(blueprint.filter((r) => r.marked).map((r) => r.key));
  return Object.keys(exemptions)
    .filter((key) => !marked.has(key))
    .map(
      (key) =>
        `SUB_FEATURE_PHASE_2 names ${key}, which §8.2 no longer marks phase 2 at all. Remove the ` +
        'exemption — a justification for a distinction that is gone is not evidence.',
    );
}

export function surfaceViolations(html, registrySrc, exemptions = SUB_FEATURE_PHASE_2) {
  const problems = [];
  const blueprint = blueprintRoutes(html, exemptions);
  const registry = registryRoutes(registrySrc);

  // A comparison over nothing agrees with everything.
  if (blueprint.length === 0) {
    problems.push(
      'parsed no routes out of blueprint §8.2. Refusing to report agreement between the ' +
        'registry and a table this checker could not read — that is a pass over nothing.',
    );
  }
  if (registry.mvp1.length === 0) {
    problems.push('parsed no routes out of ROUTES. Same refusal, from the other side.');
  }
  if (problems.length > 0) return problems;

  problems.push(...staleSubFeatureExemptions(blueprint, exemptions));

  const bpMvp1 = new Set(blueprint.filter((r) => !r.phase2).map((r) => r.key));
  const bpPhase2 = new Set(blueprint.filter((r) => r.phase2).map((r) => r.key));
  const regMvp1 = new Set(registry.mvp1);
  const regPhase2 = new Set(registry.phase2);

  for (const key of bpMvp1) {
    if (!regMvp1.has(key)) {
      problems.push(
        `§8.2 lists ${key} as MVP-1 and ROUTES does not carry it. This is drift 4's first ` +
          'half: the blueprint governs, so add the route — never edit the target down to meet ' +
          'the code.',
      );
    }
  }
  for (const key of regMvp1) {
    if (!bpMvp1.has(key)) {
      problems.push(
        bpPhase2.has(key)
          ? `ROUTES carries ${key}, which §8.2 marks PHASE 2. This is drift 4's second half. ` +
            'Move it to PHASE_2_ROUTES.'
          : `ROUTES carries ${key}, which §8.2 does not list at all. Either the blueprint needs ` +
            'an amendment — a decision, not a code change — or the route should not exist.',
      );
    }
  }
  for (const key of regPhase2) {
    if (!bpPhase2.has(key)) {
      problems.push(
        `PHASE_2_ROUTES carries ${key}, which §8.2 does not mark phase 2. A row held back for a ` +
          'reason the blueprint no longer gives is a row nobody will remember to restore.',
      );
    }
  }
  return problems;
}

export function check(root = ROOT) {
  const html = readFileSync(join(root, 'rack-master-studio-blueprint.html'), 'utf8');
  const src = readFileSync(join(root, 'apps', 'api', 'src', 'authz', 'routes.ts'), 'utf8');
  const blueprint = blueprintRoutes(html);
  return {
    // TWO independent questions, reported together and kept apart in code.
    // `surfaceViolations` diffs §8.2 against the registry, row for row.
    // `bandViolations` asks whether §8.2 is internally consistent — whether each
    // row is filed under the band its path belongs to — which needs no registry
    // and is not a diff. Folding the second into the first made the first's
    // self-test fixtures, which are synthetic paths with no bands, start
    // failing a rule they were never written about.
    problems: [...surfaceViolations(html, src), ...bandViolations(blueprint)],
    counted: {
      blueprintRows: blueprint.length,
      blueprintMvp1: blueprint.filter((r) => !r.phase2).length,
      blueprintPhase2: blueprint.filter((r) => r.phase2).length,
      registryMvp1: registryRoutes(src).mvp1.length,
      registryPhase2: registryRoutes(src).phase2.length,
    },
  };
}

function main() {
  const { problems, counted } = check();
  console.log(
    `check-route-surface: §8.2 lists ${String(counted.blueprintRows)} row(s) — ` +
      `${String(counted.blueprintMvp1)} MVP-1, ${String(counted.blueprintPhase2)} phase 2; ` +
      `the registry carries ${String(counted.registryMvp1)} and ${String(counted.registryPhase2)}.`,
  );
  if (problems.length > 0) {
    console.error('\ncheck-route-surface: FAIL');
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('check-route-surface: PASS — the registry and §8.2 agree row for row.');
}

if (process.argv[1]?.endsWith(`tools${sep}check-route-surface.mjs`)) main();
