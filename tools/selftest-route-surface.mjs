#!/usr/bin/env node
/**
 * selftest-route-surface — prove the route-surface checker catches things.
 *
 * Runs FIRST, like every self-test here, for the reason F-06 and F-08 record: a
 * checker that silently stopped working reports a clean pass forever, which is
 * worse than no checker because the build stays green while the invariant rots.
 *
 * Every case is a string pair, so this needs no repository, no database and no
 * temp tree — the checker's decision logic is pure by construction. The blind
 * spot that opens (a checker that has lost its grip on the real files) is closed
 * read-only by `assertRealTreeReachable`.
 */

import { sep } from 'node:path';

import {
  SUB_FEATURE_PHASE_2,
  blueprintRoutes,
  check,
  registryRoutes,
  staleSubFeatureExemptions,
  surfaceViolations,
} from './check-route-surface.mjs';

const CASES = [];
const ok = (name, pass) => CASES.push([name, pass]);

function html(rows) {
  return `<h3>8.2 Route surface</h3><table><tbody>${rows}</tbody></table>`;
}
function row(method, path, note = '') {
  return `<tr><td><code>${method}  ${path}</code></td><td>${note}</td><td><code>staff</code></td></tr>`;
}
function registry(mvp1, phase2 = []) {
  const line = ([m, p]) =>
    `  { method: '${m}', path: '${p}', namespace: 'internal', action: 'audit.read', response: 'AuditEvent' },`;
  return (
    `export const ROUTES: readonly RoutePolicy[] = [\n${mvp1.map(line).join('\n')}\n];\n\n` +
    `export const PHASE_2_ROUTES: readonly RoutePolicy[] = [\n${phase2.map(line).join('\n')}\n];\n`
  );
}

// ---- the agreeing case, which must PASS ------------------------------------
const AGREE_HTML = html(row('GET', '/a') + row('POST', '/b') + row('GET', '/z', 'later — <b>phase 2</b>'));
const AGREE_REG = registry(
  [
    ['GET', '/a'],
    ['POST', '/b'],
  ],
  [['GET', '/z']],
);
/**
 * Fixture cases pass an EMPTY exemption table.
 *
 * The list is real-tree data, so applying it to a synthetic blueprint made
 * every fixture trip the stale-exemption check — which is the checker being
 * right about a fixture that does not contain the row the exemption names.
 * Threading the table through is what lets the stale check stay strict on the
 * real tree while the fixtures test everything else.
 */
const NONE = Object.freeze({});

ok('an agreeing pair passes', surfaceViolations(AGREE_HTML, AGREE_REG, NONE).length === 0);

// ---- drift 4, both halves --------------------------------------------------
ok(
  "drift 4's first half: §8.2 lists an MVP-1 route the registry lacks",
  surfaceViolations(AGREE_HTML, registry([['GET', '/a']], [['GET', '/z']]), NONE).some((v) =>
    v.includes('POST /b') && v.includes('never edit the target down'),
  ),
);
ok(
  "drift 4's second half: the registry carries a route §8.2 marks phase 2",
  surfaceViolations(
    AGREE_HTML,
    registry([
      ['GET', '/a'],
      ['POST', '/b'],
      ['GET', '/z'],
    ]),
    NONE,
  ).some((v) => v.includes('GET /z') && v.includes('marks PHASE 2')),
);
ok(
  'a registry route §8.2 does not list at all is an amendment, and says so',
  surfaceViolations(
    AGREE_HTML,
    registry(
      [
        ['GET', '/a'],
        ['POST', '/b'],
        ['POST', '/invented'],
      ],
      [['GET', '/z']],
    ),
    NONE,
  ).some((v) => v.includes('POST /invented') && v.includes('amendment')),
);
ok(
  'a PHASE_2_ROUTES row §8.2 no longer defers is caught',
  surfaceViolations(
    html(row('GET', '/a') + row('POST', '/b') + row('GET', '/z')),
    AGREE_REG,
    NONE,
  ).some((v) => v.includes('GET /z') && v.includes('no longer')),
);

// ---- vacuous passes, both directions ---------------------------------------
ok(
  'a blueprint this cannot parse FAILS rather than agreeing with everything',
  surfaceViolations('<p>no table here</p>', AGREE_REG, NONE).some((v) => v.includes('pass over nothing')),
);
ok(
  'a registry this cannot parse FAILS from the other side',
  surfaceViolations(AGREE_HTML, 'export const NOTHING = [];', NONE).some((v) =>
    v.includes('no routes out of ROUTES'),
  ),
);

// ---- the one normalisation, pinned -----------------------------------------
ok(
  'a query string in §8.2 matches the path the router registers',
  surfaceViolations(html(row('GET', '/c/compare?options=')), registry([['GET', '/c/compare']]), NONE)
    .length === 0,
);
ok(
  'the double space §8.2 writes after GET does not become part of the path',
  blueprintRoutes(html(row('GET', '/a')), NONE)[0]?.key === 'GET /a',
);

// ---- the sub-feature exemption, both directions ----------------------------
const SUB_KEY = Object.keys(SUB_FEATURE_PHASE_2)[0];
const [SUB_METHOD, SUB_PATH] = SUB_KEY.split(' ');
ok(
  'a row whose phase-2 note defers a SUB-FEATURE stays MVP-1',
  blueprintRoutes(html(row(SUB_METHOD, SUB_PATH, 'thread is <b>phase 2</b>')))[0]?.phase2 === false,
);
ok(
  'and it is still recorded as marked, so the exemption is not silently unused',
  blueprintRoutes(html(row(SUB_METHOD, SUB_PATH, 'thread is <b>phase 2</b>')))[0]?.marked === true,
);
ok(
  'a STALE sub-feature exemption fails — the row is no longer marked at all',
  staleSubFeatureExemptions(blueprintRoutes(html(row(SUB_METHOD, SUB_PATH, 'no note')))).length === 1,
);
ok(
  'an exemption naming a row that is still marked does not fail',
  staleSubFeatureExemptions(
    blueprintRoutes(html(row(SUB_METHOD, SUB_PATH, 'thread is <b>phase 2</b>'))),
  ).length === 0,
);

// ---- parser sanity ---------------------------------------------------------
ok('registryRoutes reads both lists', (() => {
  const r = registryRoutes(AGREE_REG);
  return r.mvp1.length === 2 && r.phase2.length === 1;
})());
ok('a row with no code cell is skipped rather than crashing',
   blueprintRoutes(html('<tr><td>heading</td></tr>' + row('GET', '/a')), NONE).length === 1);

// ---- reachability: the REAL tree, read-only --------------------------------
function assertRealTreeReachable() {
  const { counted } = check();
  if (counted.blueprintRows === 0 || counted.registryMvp1 === 0) {
    console.error('selftest-route-surface: the checker read nothing from the REAL repository.');
    console.error('Every case above would still pass against strings while the real scan matched');
    console.error('nothing at all.');
    return false;
  }
  console.log(
    `  reachable   real tree: §8.2 ${String(counted.blueprintRows)} row(s), ` +
      `registry ${String(counted.registryMvp1)} + ${String(counted.registryPhase2)}`,
  );
  return true;
}

function main() {
  if (!assertRealTreeReachable()) {
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  for (const [name, pass] of CASES) {
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}   ${name}`);
    if (!pass) failed += 1;
  }
  if (failed > 0) {
    console.error(`selftest-route-surface: FAIL — ${String(failed)} of ${String(CASES.length)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`selftest-route-surface: PASS — ${String(CASES.length)} case(s).`);
}

if (process.argv[1]?.endsWith(`tools${sep}selftest-route-surface.mjs`)) main();
