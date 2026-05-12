import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  PROVIDER_DISPLAY_NAMES,
  type KanbanBoardSnapshot,
  type ModelSelection,
  type ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

import type { CreateKanbanCardInput } from "../../kanbanStore";
import {
  buildCreateKanbanCardInput,
  createDefaultKanbanModelSelection,
  type KanbanCreateCardMode,
} from "./kanbanCreateCard.logic";

const PROVIDER_OPTIONS: readonly ProviderKind[] = [
  "codex",
  "claudeAgent",
  "cursor",
  "gemini",
  "opencode",
];

const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "full-access": "Full access",
  "approval-required": "Approval required",
};

export interface KanbanCreateCardDialogProps {
  readonly snapshot: KanbanBoardSnapshot;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreateCard: (input: CreateKanbanCardInput) => Promise<void> | void;
}

function isProviderKind(value: string): value is ProviderKind {
  return PROVIDER_OPTIONS.includes(value as ProviderKind);
}

function isRuntimeMode(value: string): value is RuntimeMode {
  return value === "full-access" || value === "approval-required";
}

function isCreateMode(value: string): value is KanbanCreateCardMode {
  return value === "thread" || value === "specPath" || value === "manual";
}

function Field(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{props.label}</span>
      {props.children}
      {props.hint ? <span className="block text-xs text-muted-foreground">{props.hint}</span> : null}
    </label>
  );
}

export function KanbanCreateCardDialog({
  snapshot,
  open,
  onOpenChange,
  onCreateCard,
}: KanbanCreateCardDialogProps) {
  const defaultModelSelection = useMemo(() => createDefaultKanbanModelSelection(), []);
  const [mode, setMode] = useState<KanbanCreateCardMode>("specPath");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [specPath, setSpecPath] = useState("");
  const [inlineSpec, setInlineSpec] = useState("");
  const [sourceThreadId, setSourceThreadId] = useState("");
  const [provider, setProvider] = useState<ProviderKind>(defaultModelSelection.provider);
  const [model, setModel] = useState(defaultModelSelection.model);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [tasksText, setTasksText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formErrorId = "kanban-create-card-error";

  const resetForm = () => {
    setMode("specPath");
    setTitle("");
    setDescription("");
    setSpecPath("");
    setInlineSpec("");
    setSourceThreadId("");
    setProvider(defaultModelSelection.provider);
    setModel(defaultModelSelection.model);
    setRuntimeMode(DEFAULT_RUNTIME_MODE);
    setTasksText("");
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const modelSelection = {
        provider,
        model: model.trim() || DEFAULT_MODEL_BY_PROVIDER[provider],
      } satisfies ModelSelection;
      await onCreateCard(
        buildCreateKanbanCardInput({
          boardId: snapshot.board.id,
          projectId: snapshot.board.projectId,
          mode,
          title,
          description,
          specPath,
          inlineSpec,
          sourceThreadId: sourceThreadId.trim() ? (sourceThreadId.trim() as ThreadId) : null,
          modelSelection,
          runtimeMode,
          tasksText,
        }),
      );
      resetForm();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Kanban card</DialogTitle>
            <DialogDescription>
              Add a card to {snapshot.board.title} with an optional task checklist.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Source">
                <Select
                  value={mode}
                  onValueChange={(value) => {
                    if (isCreateMode(value)) {
                      setMode(value);
                    }
                  }}
                >
                  <SelectTrigger aria-label="Card source">
                    <SelectValue>
                      {mode === "thread"
                        ? "Thread and spec path"
                        : mode === "manual"
                          ? "Inline spec"
                          : "Spec path"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem hideIndicator value="specPath">
                      Spec path
                    </SelectItem>
                    <SelectItem hideIndicator value="thread">
                      Thread and spec path
                    </SelectItem>
                    <SelectItem hideIndicator value="manual">
                      Inline spec
                    </SelectItem>
                  </SelectPopup>
                </Select>
              </Field>

              <Field label="Runtime mode">
                <Select
                  value={runtimeMode}
                  onValueChange={(value) => {
                    if (isRuntimeMode(value)) {
                      setRuntimeMode(value);
                    }
                  }}
                >
                  <SelectTrigger aria-label="Runtime mode">
                    <SelectValue>{RUNTIME_MODE_LABELS[runtimeMode]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem hideIndicator value="full-access">
                      Full access
                    </SelectItem>
                    <SelectItem hideIndicator value="approval-required">
                      Approval required
                    </SelectItem>
                  </SelectPopup>
                </Select>
              </Field>
            </div>

            <Field label="Title">
              <Input
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="Implement kanban orchestration"
                nativeInput
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="Optional context for the card"
              />
            </Field>

            {mode === "thread" ? (
              <Field label="Source thread">
                <Input
                  value={sourceThreadId}
                  onChange={(event) => setSourceThreadId(event.currentTarget.value)}
                  placeholder="thread-..."
                  nativeInput
                />
              </Field>
            ) : null}

            <Field
              label="Spec path"
              hint={
                mode === "manual"
                  ? "Required reference path for the card. Inline notes stay in the description."
                  : undefined
              }
            >
              <Input
                value={specPath}
                onChange={(event) => setSpecPath(event.currentTarget.value)}
                placeholder="docs/specs/kanban-task.md"
                nativeInput
              />
            </Field>

            {mode === "manual" ? (
              <Field label="Inline spec" hint="Optional notes added to the card description.">
                <Textarea
                  value={inlineSpec}
                  onChange={(event) => setInlineSpec(event.currentTarget.value)}
                  placeholder="Describe the implementation target"
                />
              </Field>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
              <Field label="Provider">
                <Select
                  value={provider}
                  onValueChange={(value) => {
                    if (!isProviderKind(value)) {
                      return;
                    }
                    setProvider(value);
                    setModel(DEFAULT_MODEL_BY_PROVIDER[value]);
                  }}
                >
                  <SelectTrigger aria-label="Provider">
                    <SelectValue>{PROVIDER_DISPLAY_NAMES[provider]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {PROVIDER_OPTIONS.map((providerOption) => (
                      <SelectItem hideIndicator key={providerOption} value={providerOption}>
                        {PROVIDER_DISPLAY_NAMES[providerOption]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>

              <Field label="Model">
                <Input
                  value={model}
                  onChange={(event) => setModel(event.currentTarget.value)}
                  placeholder={DEFAULT_MODEL_BY_PROVIDER[provider]}
                  nativeInput
                />
              </Field>
            </div>

            <Field label="Initial tasks" hint="One task per line. Bullets are accepted.">
              <Textarea
                value={tasksText}
                onChange={(event) => setTasksText(event.currentTarget.value)}
                placeholder={"- Add payload tests\n- Wire dialog"}
              />
            </Field>

            {error ? (
              <div
                id={formErrorId}
                role="alert"
                aria-live="polite"
                className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground"
              >
                {error}
              </div>
            ) : null}
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Create card
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
