// FILE: OpenInPicker.tsx
// Purpose: Render the chat header "Open In" controls for the currently active project.
// Layer: Chat header action
// Depends on: shared editor metadata, native shell bridge, and preferred editor state.

import { type EditorId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, type ReactNode, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { resolveAvailableEditorOptions } from "../../editorMetadata";
import { ChevronDownIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { readNativeApi } from "~/nativeApi";

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
  actionItems = null,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  actionItems?: ReactNode;
}) {
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const options = useMemo(
    () => resolveAvailableEditorOptions(navigator.platform, availableEditors),
    [availableEditors],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const api = readNativeApi();
      if (!api || !openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      void api.shell.openInEditor(openInCwd, editor);
      setPreferredEditor(editor);
    },
    [preferredEditor, openInCwd, setPreferredEditor],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const api = readNativeApi();
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!api || !openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void api.shell.openInEditor(openInCwd, preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preferredEditor, keybindings, openInCwd]);

  return (
    <Group aria-label="Open in editor">
      <Button
        size="xs"
        variant="outline"
        disabled={!preferredEditor || !openInCwd}
        onClick={() => openInEditor(preferredEditor)}
        title={primaryOption ? `Open in ${primaryOption.label}` : "Open in editor"}
      >
        {primaryOption?.Icon && <primaryOption.Icon aria-hidden="true" className="size-3.5" />}
        <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
          Open
        </span>
      </Button>
      <GroupSeparator className="hidden @sm/header-actions:block" />
      <Menu>
        <MenuTrigger
          render={<Button aria-label="Project actions" size="icon-xs" variant="outline" />}
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup
          align="end"
          className="w-50 rounded-lg border-[color:var(--color-border)] bg-[var(--composer-surface)] shadow-lg"
        >
          <MenuItem
            onClick={() => openInEditor(preferredEditor)}
            disabled={!preferredEditor || !openInCwd}
          >
            {primaryOption?.Icon ? (
              <primaryOption.Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            ) : null}
            <span>Open in editor</span>
            {openFavoriteEditorShortcutLabel && (
              <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
            )}
          </MenuItem>
          {actionItems ? (
            <>
              <MenuSeparator className="mx-1" />
              {actionItems}
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
