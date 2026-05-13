import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Sidebar hook declaration order", () => {
  it("declares sidebar view callback dependencies before the callback is created", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

    const currentProjectTargetIndex = source.indexOf(
      "const currentProjectShortcutTargetId = useMemo",
    );
    const startAddProjectIndex = source.indexOf("const handleStartAddProject = useCallback");
    const viewChangeIndex = source.indexOf("const handleSidebarViewChange = useCallback");

    expect(currentProjectTargetIndex).toBeGreaterThanOrEqual(0);
    expect(startAddProjectIndex).toBeGreaterThanOrEqual(0);
    expect(viewChangeIndex).toBeGreaterThanOrEqual(0);
    expect(currentProjectTargetIndex).toBeLessThan(viewChangeIndex);
    expect(startAddProjectIndex).toBeLessThan(viewChangeIndex);
  });
});
