Based on an adversarial review of the provided progress scoreboard, the following issues, inconsistencies, and contract violations have been identified:

### 1. Inconsistent Task Count Denominator (Arithmetic Error & Contract Violation)
*   **Citations**: 
    *   Headline table: `Plan-task completion, task count | 6 of 43 - 14%`
    *   Method section: `The 43 tasks named by ### T-. / ### P-. headings in tasks/todo.md, plus the ten Phase 4 bullets.`
*   **Issue**: The stated method defines the task inventory as the 43 heading-defined tasks *plus* the 10 Phase 4 bullets, which mathematically yields a total of 53 tasks. However, the headline completion metric uses a denominator of 43 (`6 of 43`). 
    *   If the 10 Phase 4 bullets are *not* included in the 43, the denominator is missing 10 tasks, and the progress is overstated (6 of 53 is **11.3%**, not 14%).
    *   If the 10 bullets *are* already included in the 43, then the phrasing *"plus the ten Phase 4 bullets"* is misleading and mathematically incorrect.
    *   This violates **Contract Requirement 1** (reproducible, not misleading method) and **Contract Requirement 4** (correct arithmetic).

### 2. Mathematically Impossible Phase 4 Points (Weighting Inconsistency)
*   **Citations**: 
    *   Method section: `Weights. The plan's own T-shirt sizes: XS=1, S=2, M=4, L=8.`
    *   Caveat section: `Phase 4 is ten M/L tasks...`
    *   By phase table: `Phase 4 - The interface | 42 [Points]`
*   **Issue**: The weighting scheme is internally inconsistent. If Phase 4 consists of exactly 10 tasks that are all sized as either M (4 points) or L (8 points), the total points ($P$) must satisfy the equation:
    $$4x + 8y = P$$
    where $x$ (number of M tasks) and $y$ (number of L tasks) are integers, and $x + y = 10$. 
    This simplifies to:
    $$4(10 - y) + 8y = 42 \implies 40 + 4y = 42 \implies 4y = 2 \implies y = 0.5$$
    Because $y$ must be an integer, it is mathematically impossible to achieve a sum of 42 points using only 4-point and 8-point tasks. The point total for Phase 4 is mathematically incorrect based on the stated rules.

### 3. Unverified "Verified" Progress (Misleading Framing & Claim Presented as Measurement)
*   **Citations**: 
    *   By phase table: `Phase 1 - Catalog and schema integrity | 10 | 10 | 100% | T-01.T-04 complete and verified`
    *   Not verified today section: `The suite could not be run: node_modules holds win32 native binaries and the available shell is Linux.`
    *   Not verified today section: `Neither figure describes 6f05043, which is unpushed and has been tested by nothing.`
*   **Issue**: The author frames Phase 1 as "verified" on the current branch (`6f05043`). However, the author explicitly states that the test suite could not be run due to a platform mismatch, and that the current commit has been "tested by nothing." 
    *   Without running the test suite or migrations on the current commit, "schema integrity" cannot be independently verified. 
    *   Therefore, labeling Phase 1 as "verified" on this branch is a claim presented as a measurement, violating **Contract Requirement 2** (distinguishing verified figures from repository claims).

### 4. Unstated Assumption for Phase 0 / T-00 Weighting
*   **Citations**: 
    *   Method section: `P-00 carries no size and is scored M.`
    *   By phase table: `Phase 0 - Make CI real | 1 [Points] | 0 | 0% | T-00 in progress`
*   **Issue**: While the author explicitly states the exception/assumption for weighting P-00 (which has no size and is scored as M/4 points), they fail to state the assumption or rule for weighting T-00. T-00 is assigned 1 point (XS) in the Phase 0 row, but the text does not clarify if T-00 was explicitly sized in the plan or if this was an unstated assumption made by the author.
