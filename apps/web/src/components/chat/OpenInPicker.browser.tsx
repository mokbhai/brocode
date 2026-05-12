import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { DEFAULT_SHORTCUT_FALLBACKS } from "../../keybindings";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { OpenInPicker } from "./OpenInPicker";

async function mountOpenInPicker() {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <OpenInPicker
      keybindings={DEFAULT_SHORTCUT_FALLBACKS}
      availableEditors={["vscode"]}
      openInCwd="/repo/project"
      actionItems={
        <>
          <MenuItem>
            <span>Show terminal</span>
          </MenuItem>
          <MenuItem>
            <span>Show browser</span>
          </MenuItem>
          <MenuItem>
            <span>Split chat</span>
          </MenuItem>
          <MenuSeparator className="mx-1" />
          <MenuItem>
            <span>Add action</span>
          </MenuItem>
        </>
      }
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("OpenInPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("shows project actions from the editor dropdown", async () => {
    const mounted = await mountOpenInPicker();

    try {
      await page.getByLabelText("Project actions").click();

      await expect.element(page.getByText("Open in editor")).toBeInTheDocument();
      await expect.element(page.getByText("Show terminal")).toBeInTheDocument();
      await expect.element(page.getByText("Show browser")).toBeInTheDocument();
      await expect.element(page.getByText("Split chat")).toBeInTheDocument();
      await expect.element(page.getByText("Add action")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
