import { describe, expect, it } from 'vitest';

import {
  REVIEW_PACKAGE_KEYS,
  ReviewPackageError,
  assembleReviewPackage,
  type Acknowledgement,
  type Assumption,
  type ReviewPackageInput,
} from './index.js';

function assumption(key = 'pallet.overhang.front', over: Partial<Assumption> = {}): Assumption {
  return {
    key,
    assumedValue: { value: 101_600, unit: 'um' },
    why: 'No pallet overhang was supplied; the planning default was used.',
    scope: 'every position in unit U-1',
    ...over,
  };
}

function acknowledgement(over: Partial<Acknowledgement> = {}): Acknowledgement {
  return {
    acknowledgedBy: 'client-user-1',
    acknowledgedAt: '2026-08-31T12:00:00Z',
    auditEventId: 'audit-1',
    keys: ['pallet.overhang.front'],
    ...over,
  };
}

function packageInput(over: Partial<ReviewPackageInput> = {}): ReviewPackageInput {
  return {
    submissionId: 'sub-1',
    assumptions: [assumption()],
    acknowledgement: acknowledgement(),
    plan: { displayListId: 'dl-plan' },
    elevation: { displayListId: 'dl-elev' },
    inputs: { revisionId: 'rev-1', facilityId: 'fac-1' },
    findings: [],
    bom: { lineCount: 0 },
    ...over,
  };
}

/** `exactOptionalPropertyTypes` distinguishes absent from undefined; this drops the key. */
function withoutAcknowledgement(input: ReviewPackageInput): ReviewPackageInput {
  const copy: Record<string, unknown> = { ...input };
  delete copy['acknowledgement'];
  return copy as unknown as ReviewPackageInput;
}

describe('§11.6 — the register is at the TOP of the internal review package', () => {
  it('puts assumptions first, before plan, elevation, inputs, findings and the BOM', () => {
    const pkg = assembleReviewPackage(packageInput());
    expect(Object.keys(pkg)[0]).toBe('assumptions');
    expect(REVIEW_PACKAGE_KEYS[0]).toBe('assumptions');
    expect([...REVIEW_PACKAGE_KEYS]).toEqual(Object.keys(pkg));
  });

  it('stamps each assumption with who acknowledged it and when', () => {
    // The point of §11.6: the internal conversation "you accepted a 4-inch
    // overhang" is settled by reading the package, not by remembering.
    const pkg = assembleReviewPackage(packageInput());
    expect(pkg.assumptions[0]?.acknowledgedBy).toBe('client-user-1');
    expect(pkg.assumptions[0]?.acknowledgedAt).toBe('2026-08-31T12:00:00Z');
  });

  it('carries the audit event id, so the acknowledgement can be checked against the chain', () => {
    const pkg = assembleReviewPackage(packageInput());
    expect(pkg.acknowledgementAuditEventId).toBe('audit-1');
  });

  it('refuses to assemble a package whose register nobody acknowledged', () => {
    expect(() => assembleReviewPackage(withoutAcknowledgement(packageInput()))).toThrow(
      ReviewPackageError,
    );
  });

  it('refuses an acknowledgement with no audit event id — AC-15 is what makes it checkable', () => {
    expect(() =>
      assembleReviewPackage(packageInput({ acknowledgement: acknowledgement({ auditEventId: '  ' }) })),
    ).toThrow(/audit event/);
  });

  it('refuses when the acknowledgement misses a key the register holds', () => {
    expect(() =>
      assembleReviewPackage(
        packageInput({ assumptions: [assumption(), assumption('floor.position')] }),
      ),
    ).toThrow(/floor\.position/);
  });

  it('refuses an acknowledgement that names nobody', () => {
    expect(() =>
      assembleReviewPackage(
        packageInput({ acknowledgement: acknowledgement({ acknowledgedBy: '   ' }) }),
      ),
    ).toThrow(/names no-one/);
  });

  it('refuses an acknowledgement with no time on it', () => {
    expect(() =>
      assembleReviewPackage(
        packageInput({ acknowledgement: acknowledgement({ acknowledgedAt: '' }) }),
      ),
    ).toThrow(ReviewPackageError);
  });

  it('refuses an acknowledgement covering a key the register does not hold', () => {
    // Coverage is checked in BOTH directions. An acknowledgement over keys that
    // are not in this register was taken against a different register, and a
    // reviewer reading it would not be able to tell.
    expect(() =>
      assembleReviewPackage(
        packageInput({
          acknowledgement: acknowledgement({
            keys: ['pallet.overhang.front', 'aisle.width'],
          }),
        }),
      ),
    ).toThrow(/aisle\.width/);
  });

  it('refuses an acknowledgement of an empty register — there was nothing to accept', () => {
    expect(() => assembleReviewPackage(packageInput({ assumptions: [] }))).toThrow(
      ReviewPackageError,
    );
  });

  it('assembles with an empty register and no acknowledgement — there was nothing to accept', () => {
    const pkg = assembleReviewPackage(
      withoutAcknowledgement(packageInput({ assumptions: [] })),
    );
    expect(pkg.assumptions).toEqual([]);
    expect(pkg.acknowledgementAuditEventId).toBeUndefined();
    // The empty-register shape keeps the published order too, minus the key
    // that has nothing to say.
    expect(Object.keys(pkg)).toEqual(
      REVIEW_PACKAGE_KEYS.filter((k) => k !== 'acknowledgementAuditEventId'),
    );
  });
});
