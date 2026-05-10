import { describe, expect, it } from "vitest";

import {
  WORKTREE_BRANCH_PREFIX,
  buildBroCodeBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  resolveUniqueBroCodeBranchName,
  resolveThreadBranchRegressionGuard,
} from "./git";

describe("isTemporaryWorktreeBranch", () => {
  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(buildTemporaryWorktreeBranchName())).toBe(true);
  });

  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/DEADBEEF `)).toBe(true);
  });

  it("rejects semantic branch names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("feature/demo")).toBe(false);
  });
});

describe("resolveThreadBranchRegressionGuard", () => {
  it("keeps a semantic branch when the next branch is only a temporary worktree placeholder", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/semantic-branch",
        nextBranch: `${WORKTREE_BRANCH_PREFIX}/deadbeef`,
      }),
    ).toBe("feature/semantic-branch");
  });

  it("accepts real branch changes", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: "feature/new",
      }),
    ).toBe("feature/new");
  });

  it("allows clearing the branch", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: null,
      }),
    ).toBeNull();
  });
});

describe("buildBroCodeBranchName", () => {
  it("uses brocode as the branch namespace", () => {
    expect(buildBroCodeBranchName("fix toast copy")).toBe("brocode/fix-toast-copy");
  });

  it("keeps non-brocode namespaces inside the brocode branch", () => {
    expect(buildBroCodeBranchName("feature/refine-toolbar-actions")).toBe(
      "brocode/feature/refine-toolbar-actions",
    );
  });

  it("normalizes legacy app-style prefixes before rebuilding the branch", () => {
    expect(buildBroCodeBranchName("t3code/refine toolbar actions")).toBe(
      "brocode/refine-toolbar-actions",
    );
    expect(buildBroCodeBranchName("dpcode/refine toolbar actions")).toBe(
      "brocode/refine-toolbar-actions",
    );
  });

  it("falls back to brocode/update when no preferred name is provided", () => {
    expect(buildBroCodeBranchName()).toBe("brocode/update");
  });
});

describe("resolveUniqueBroCodeBranchName", () => {
  it("increments suffix when the brocode branch already exists", () => {
    expect(
      resolveUniqueBroCodeBranchName(
        ["main", "brocode/fix-toast-copy", "brocode/fix-toast-copy-2"],
        "fix toast copy",
      ),
    ).toBe("brocode/fix-toast-copy-3");
  });
});
