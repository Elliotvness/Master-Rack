import { WormError, writeRefusals, type WormObject, type WormStore } from './store.js';

/**
 * An in-memory WORM store that enforces the retention contract.
 *
 * This is a TEST DOUBLE with teeth, not a stub. A fake that accepts every write
 * would let the whole suite pass while the real bucket silently overwrote
 * manifests, so this one refuses exactly what a correctly configured
 * compliance-mode bucket refuses: overwriting a key, and deleting before
 * retention expires.
 *
 * It does NOT prove the live provider behaves this way. Nothing in this
 * repository can prove that; only an upload-then-overwrite attempt against the
 * real bucket can, and that check is recorded separately as an operational
 * step. What this fake proves is that OUR code never asks for an overwrite,
 * which is the half we control.
 */
export class InMemoryWormStore implements WormStore {
  readonly #objects = new Map<string, WormObject>();

  /** Every rejected write, so a test can assert the refusal, not just the absence. */
  readonly refusals: string[] = [];

  /**
   * The clock is injected rather than read. A WORM store that read `Date.now()`
   * could not be tested against a retention boundary without waiting seven
   * years for it.
   */
  constructor(private readonly now: () => string) {}

  async put(object: WormObject): Promise<void> {
    const reasons = writeRefusals(object, {
      alreadyExists: this.#objects.has(object.key),
      now: this.now(),
    });
    if (reasons.length > 0) {
      this.refusals.push(...reasons);
      throw new WormError(reasons.join(' | '));
    }
    this.#objects.set(object.key, object);
  }

  async get(key: string): Promise<WormObject | null> {
    return this.#objects.get(key) ?? null;
  }

  async has(key: string): Promise<boolean> {
    return this.#objects.has(key);
  }

  /**
   * Deletion, modelled so the retention rule can be exercised.
   *
   * Deliberately NOT on the WormStore interface: production code has no reason
   * to delete a manifest, and an interface that offers a delete invites one.
   * This exists so a test can prove the boundary behaves, and so the difference
   * between "before retention" and "after retention" is written down somewhere
   * other than a provider's documentation.
   */
  async attemptDelete(key: string): Promise<{ deleted: boolean; reason: string | null }> {
    const object = this.#objects.get(key);
    if (object === undefined) {
      return { deleted: false, reason: `no object at '${key}'` };
    }
    const until = Date.parse(object.retainUntil);
    const now = Date.parse(this.now());
    if (now < until) {
      return {
        deleted: false,
        reason:
          `'${key}' is retained until ${object.retainUntil} in ${object.mode} mode. ` +
          (object.mode === 'COMPLIANCE'
            ? 'Compliance retention cannot be removed by any user, including the account root.'
            : 'Governance retention can be overridden by a sufficiently privileged key, ' +
              'which is why production does not use it.'),
      };
    }
    this.#objects.delete(key);
    return { deleted: true, reason: null };
  }

  get size(): number {
    return this.#objects.size;
  }
}
