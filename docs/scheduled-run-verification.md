# Running the verification suite inside a scheduled Cowork run

**Status: measured 2026-09-28, session 17.** Every command below was executed in the run that wrote
this file. Figures are labelled *verified-today* where they were produced here and
*repository-claim* where they were read off an earlier document.

This file exists because three consecutive scheduled runs (2026-09-07, 09-14, 09-21) reported the
build unverifiable from a scheduled session, and **two of the three reasons given were wrong**.

---

## 1. The correction: git writes are not blocked

The 2026-09-14 and 2026-09-21 run reports concluded that the Cowork bridge shell *cannot commit,
checkout, merge or rebase*, on the reasoning that git takes a `.lock` file and then removes it,
and this mount refuses `unlink`. The refusal is real. The conclusion drawn from it is not.

Git does not release `index.lock`, `HEAD.lock` or `config.lock` by unlinking them. It releases them
by **renaming** the lock over the target — and rename is permitted on this mount. Measured
*verified-today*, each at exit 0, in `C:\Rack Master\rack-master-studio`:

| Operation | Result |
|---|---|
| `git config --local <k> <v>` then read back | exit 0, value returned, no lock left behind |
| `git add <path>` | exit 0, index updated, no `.git/index.lock` left behind |
| `git checkout --detach HEAD` | exit 0 |
| `git checkout <branch>` | exit 0, branch reattached |

What the `unlink` refusal actually costs is **loose temporary objects**: `git add` emits
`warning: unable to unlink '.git/objects/xx/tmp_obj_…': Operation not permitted` and leaves a few
bytes behind. That is accumulating litter, not a lock, and it does not fail the operation.

**The real commit is the proof.** `1a4a98f` was made from a scheduled run, on this mount, and a
`git fsck --connectivity-only` over the result reported no broken links.

### The exception, found by breaking it — operations that DELETE a ref do fail

The rename argument holds for writes that *create or update* a ref. It does **not** hold for writes
that **remove** one, because removal is an unlink by definition. Measured *verified-today*:

```
$ git branch -D probe/lock-test
error: Unable to create '.../.git/packed-refs.lock': File exists.
error: could not remove reference refs/heads/probe/lock-test
```

The branch survives and a `packed-refs.lock` is left behind, which **will** block the next ref write
until it is moved aside. So:

| Operation | On this mount |
|---|---|
| `git add`, `git commit`, `git checkout`, `git checkout -b`, `git config` | **work** |
| `git branch -d/-D`, `git tag -d`, anything that removes a ref | **fail, and leave a lock** |

A run that deletes a branch must move `.git/packed-refs.lock` aside afterwards, or every later git
write in that clone fails with *"Another git process seems to be running"*. **Prefer not creating
throwaway branches at all**: one cannot be cleaned up from here. This run left `probe/lock-test`
behind for exactly that reason, and it is EL's to delete.

### The rule that actually matters: every commit leaves two locks

This is the detail that made git look broken, and it took a third pass to find. A commit on this
mount **succeeds** and then leaves **both** `.git/HEAD.lock` and `.git/index.lock` behind, because
releasing them is an unlink. The commit is sound — but **the next git write in that clone fails**:

```
fatal: Unable to create '.../.git/index.lock': File exists.
Another git process seems to be running in this repository…
```

That is the whole illusion. A run that made one commit, then tried a second operation, saw a message
naming a phantom concurrent git process and concluded the mount forbids git writes. It does not. It
forbids *cleaning up after* them, and the failure surfaces one operation later than its cause.

**So: sweep the locks after every git write.** Put this in the run, not in a person's memory:

```sh
clean_locks() {
  for l in .git/HEAD.lock .git/index.lock .git/packed-refs.lock .git/config.lock; do
    [ -e "$l" ] && mv "$l" "_to_delete/session-17/$(basename $l).$(date +%s%N)"
  done
}
```

Call it before the first git write of the run and after every one that follows. With that in place a
run can commit repeatedly; this file and the scoreboard were landed across three commits that way.

Check for a stale lock at the start of every run and move any found into `_to_delete/`:

```sh
find .git -maxdepth 2 -name '*.lock'
```

**Consequence for future runs:** a scheduled run may branch and commit on the mount. The commits
persist on EL's disk. Do not carry forward the "read-and-report only" conclusion.

`git status` without `--no-optional-locks` is still worth avoiding: it refreshes the index and can
leave a lock that a later run has to move aside. Prefer `git --no-optional-locks status`.

## 2. The real blocker, and how to get around it

`node_modules` in the working tree is a **Windows** install. `vitest` cannot start from it under the
Linux bridge shell — the platform-specific `rollup` binary is absent. That, not git, is why the last
three runs reported no test result.

The fix is to build a Linux install **outside the mount**, in the session's own scratch, and leave
EL's tree untouched:

```sh
SRC="$HOME/mnt/Rack Master/rack-master-studio"
DST="$HOME/work/rms"
mkdir -p "$DST"
rsync -a --exclude node_modules --exclude .git --exclude coverage \
         --exclude _to_delete --exclude dist "$SRC/" "$DST/"

# pnpm is not on PATH; corepack has it. `pnpm verify` also shells out to `pnpm`
# by name, so a shim is required or the chain dies at the first `&&`.
mkdir -p "$HOME/bin"
printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > "$HOME/bin/pnpm"
chmod +x "$HOME/bin/pnpm"
export PATH="$HOME/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd "$DST"
pnpm install --frozen-lockfile

# rsync copies *.tsbuildinfo, so `tsc --build` believes it is up to date and
# emits nothing. Four checkers then fail on a missing dist/ that typecheck
# "already built". Delete the stamps and force the first build.
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
npx tsc --build --force

pnpm verify
```

Each bridge call is capped at 180 s, so `pnpm verify` is started with `nohup … &` into a log and the
log is tailed across calls.

Two traps worth naming, both hit in this run:

- `pkill -f "pnpm verify"` matches **its own command line** and kills the calling shell (exit 143).
- The install itself is fast; `pnpm install --frozen-lockfile` completed in **17 s** *(verified-today)*.

## 3. What this reaches, and what it does not

*Verified-today*, on `docs/session-16-f54` @ `3540dd9`:

| Gate | Result |
|---|---|
| `pnpm typecheck` (`tsc --build` + `tsc -p tsconfig.tests.json`) | **exit 0** |
| `pnpm lint` | **exit 0** |
| `pnpm test` (`vitest run`) | **exit 0** — 77 files, 2,058 tests: **1,926 passed, 132 skipped** |
| 21 checkers, each preceded by its self-test | **PASS** |
| `pnpm check:rls` | **could not run** — needs a live PostgreSQL on `localhost:55432` |
| `pnpm coverage` | **exit 1** — see below |

The 132 skipped tests are the database-backed suites; they announce the skip and name the reason.
`pnpm coverage` then fails its per-directory thresholds on exactly the directories those suites
cover — `apps/api/src/audit/**`, `apps/api/src/outbox/**`, `apps/api/src/workflow/**` and
`packages/db/src/**`. **This is the absence of a database, not a coverage regression**, and it must
not be recorded as one.

**No PostgreSQL is reachable from the bridge shell** *(verified-today)*: no `docker`, no
`pg_ctl`/`initdb`/`postgres` binary, and `sudo` is refused (`no new privileges`), so none can be
installed. A scheduled run therefore reaches **everything except the database-backed gates**.

The last full run including those gates remains session 15's, against PostgreSQL 16.13 with
`RMS_REQUIRE_DB=1` — a *repository-claim* here, not a measurement of this run.

## 4. What is still EL's to unblock

**Pushing.** `git push` from the bridge shell ends at `fatal: could not read Username`;
`git config --get credential.helper` is empty and there is no prompt to answer. The cloud container
reaches `origin` for anonymous reads and was refused **HTTP 403** on push in session 15. Adding
`Elliotvness/Master-Rack` to the scheduled session's authorized repository set, or configuring a
credential helper for the bridge shell, is the one action that closes this. It has now been open for
**five consecutive scheduled runs**.

**Deleting.** `rm` in the mount fails with `Operation not permitted`. Granting delete permission to
`C:\Rack Master` in an attended session would stop each run's litter accumulating in
`.git/objects/` and `_to_delete/`.
