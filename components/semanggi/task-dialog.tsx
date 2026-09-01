"use client";

// Single-task popup: info, timeline, approvals, comments, and controls.
//
// ONE RULE THAT BINDS EVERYTHING HERE
//
// Every button that stops work names what it's stopping before doing it
// (§8.7). "Cancel" even demands the task name be typed, because CANCELLED is
// a dead end in the state machine — nothing comes back from it — while "Stop"
// can be resumed.

import { useCallback, useEffect, useState } from "react";
import {
  semanggi,
  relativeTime,
  shortenWorkspacePath,
  type Approval,
  type CatalogModel,
  type Task,
  type TaskDetail,
  type WorkEvent,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Empty, Field, LoadError, Notice, Select, statusTone } from "./ui";

const FINISHED_STATUSES = new Set(["COMPLETE", "CANCELLED"]);

type Tab = "info" | "timeline" | "transcript";

export function TaskDialog({
  taskId,
  models,
  onClose,
  onChanged,
}: {
  taskId: string;
  models: CatalogModel[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [turns, setTurns] = useState<Array<{ role: string; at: number; text: string; revision: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("info");
  const [comment, setComment] = useState("");
  const [model, setModel] = useState("");
  const [confirmCancel, setConfirmCancel] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const [d, e] = await Promise.all([semanggi.task(taskId), semanggi.events(taskId)]);
      setDetail(d);
      setEvents(e.events);
      const preferred = (d.task.modelPolicy?.preferred as string[] | undefined) ?? [];
      setModel(preferred[0] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "transcript" || turns.length > 0) return;
    semanggi
      .transcript(taskId)
      .then((t) => setTurns(t.turns))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [tab, taskId, turns.length]);

  // Escape closes: a dialog only closable via a tiny corner button makes
  // people click outside and lose the comment they were writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const task = detail?.task;
  const pendingApprovals = (detail?.approvals ?? []).filter((a) => !a.decision);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-xl border border-border bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{taskId}</code>
              {task ? <Badge tone={statusTone(task.status)}>{task.status}</Badge> : null}
              {task?.expedited ? <Badge tone="warning">expedited</Badge> : null}
              {task ? <Badge tone="neutral">{task.qualityClass}</Badge> : null}
              {task?.workspaceMode === "read" ? <Badge tone="info">read</Badge> : null}
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold">{task?.title ?? "Loading…"}</h2>
            {task?.waitReason ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{task.waitReason}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error ? <LoadError error={error} onRetry={load} /> : null}

          {pendingApprovals.length > 0 ? (
            <ApprovalPanel
              approvals={pendingApprovals}
              busy={busy}
              onDecide={(id, decision, note) =>
                // ApprovalRow only ever offers options straight from the
                // approval's own `options` list with COMMENT filtered out —
                // "APPROVE"/"REJECT"/"MODIFY" is what's actually possible
                // here, `decision` is just typed as `string` one level up so
                // ApprovalPanel doesn't need to know that union.
                act(() => semanggi.decide(id, decision as "APPROVE" | "REJECT" | "MODIFY", note))
              }
            />
          ) : null}

          {task ? (
            <Controls
              task={task}
              models={models}
              model={model}
              onModel={setModel}
              busy={busy}
              confirmCancel={confirmCancel}
              onConfirmCancel={setConfirmCancel}
              act={act}
            />
          ) : null}

          <div className="flex gap-1 border-b border-border">
            {(
              [
                ["info", "Info"],
                ["timeline", `Timeline (${events.length})`],
                ["transcript", "Transcript"],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
                  tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "info" && detail ? <InfoTab detail={detail} /> : null}
          {tab === "timeline" ? <Timeline events={events} /> : null}
          {tab === "transcript" ? <Transcript turns={turns} /> : null}

          {/* Once a task is COMPLETE or CANCELLED there is nothing left an
              operator can still do to it, and a comment box that's still
              live for a dead-end task invites notes that read as
              instructions nobody will ever act on. The timeline in the
              Timeline tab still shows every comment that was made while it
              mattered. */}
          {task && !FINISHED_STATUSES.has(task.status) ? (
            <Card title="Comments">
              <div className="flex flex-col gap-2">
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  placeholder="A note for this task — stored in the append-only log and shown in the timeline."
                  className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || comment.trim().length === 0}
                    onClick={() =>
                      act(async () => {
                        await semanggi.comment(taskId, comment.trim());
                        setComment("");
                      })
                    }
                  >
                    Send comment
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const DECISION_LABEL: Record<string, string> = {
  APPROVE: "Approve",
  REJECT: "Reject",
  MODIFY: "Request changes",
};

/**
 * One row per pending approval, with buttons built from `a.options` rather
 * than a fixed Approve/Reject pair.
 *
 * Every approval the controller creates offers MODIFY alongside
 * APPROVE/REJECT (see approvals.create in the controller), but until now
 * this panel only ever rendered two hardcoded buttons — so the one decision
 * that requires the operator to actually explain what should change was
 * present in the data and invisible in the UI. MODIFY blocks the task the
 * same way REJECT does; the note is the only record of *why*, which is why
 * it's required rather than optional for that one option.
 */
function ApprovalPanel({
  approvals,
  busy,
  onDecide,
}: {
  approvals: Approval[];
  busy: boolean;
  onDecide: (id: string, decision: string, note?: string) => void;
}) {
  return (
    <Card title="Needs your decision" className="border-amber-500/40">
      <div className="space-y-4">
        {approvals.map((a) => (
          <ApprovalRow key={a.id} approval={a} busy={busy} onDecide={onDecide} />
        ))}
      </div>
    </Card>
  );
}

function ApprovalRow({
  approval,
  busy,
  onDecide,
}: {
  approval: Approval;
  busy: boolean;
  onDecide: (id: string, decision: string, note?: string) => void;
}) {
  const [note, setNote] = useState("");
  const decidable = approval.options.filter((o) => o !== "COMMENT");
  const modifyOffered = decidable.includes("MODIFY");
  const modifyBlocked = modifyOffered && note.trim().length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge tone="warning">{approval.level}</Badge>
        <span className="text-sm">{approval.question}</span>
      </div>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={
          modifyOffered ? "What should change? Required for “Request changes”." : "Note (optional, stored with the decision)"
        }
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex flex-wrap gap-2">
        {decidable.map((option) => {
          const variant = option === "APPROVE" ? "default" : option === "REJECT" ? "danger" : "outline";
          const disabled = busy || (option === "MODIFY" && modifyBlocked);
          return (
            <Button
              key={option}
              size="sm"
              variant={variant}
              disabled={disabled}
              title={option === "MODIFY" && modifyBlocked ? "Describe what should change first" : undefined}
              onClick={() => onDecide(approval.id, option, note || undefined)}
            >
              {DECISION_LABEL[option] ?? option}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function Controls({
  task,
  models,
  model,
  onModel,
  busy,
  confirmCancel,
  onConfirmCancel,
  act,
}: {
  task: Task;
  models: CatalogModel[];
  model: string;
  onModel: (value: string) => void;
  busy: boolean;
  confirmCancel: string;
  onConfirmCancel: (value: string) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const live = ["RUNNING", "DISPATCHED"].includes(task.status);
  const finished = ["COMPLETE", "CANCELLED"].includes(task.status);
  const held = task.status === "CREATED";

  return (
    <Card title="Controls">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !held} title={held ? "" : "Only a held task can be released"} onClick={() => act(() => semanggi.start(task.id))}>
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished}
            title={live ? "Stops the currently running execution" : "Parks the task so its plan can be changed"}
            onClick={() => act(() => semanggi.stop(task.id, "stopped from the Summary page"))}
          >
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished}
            title="Temporarily raises priority; recovers on its own after 30 minutes"
            onClick={() => act(() => semanggi.expedite(task.id, 30 * 60_000))}
          >
            Force-run (30 min)
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !finished} onClick={() => act(() => semanggi.rerun(task.id, "FRESH"))}>
            Re-run
          </Button>
        </div>

        {/* Changing the model while running doesn't affect the current
            execution — it applies on the next dispatch. Saying so here is
            cheaper than letting the operator infer it from an unchanged
            result. */}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Brain / model" hint={live ? "Applies on the next dispatch, not the currently running execution." : undefined}>
            <Select value={model} onChange={onModel} disabled={busy} className="min-w-[16rem]">
              <option value="">(follow category/level routing)</option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} — {m.provider}/{m.model}
                  {m.effort ? ` @${m.effort}` : ""}
                  {m.effortMode === "preference" ? " (effort not enforced)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => semanggi.setModel(task.id, model ? [model] : []))}>
            Save model
          </Button>
        </div>

        {!finished ? (
          <details className="rounded-md border border-red-500/30 p-2">
            <summary className="cursor-pointer text-xs font-medium text-red-600 dark:text-red-300">Cancel task</summary>
            <div className="mt-2 space-y-2">
              <Notice tone="danger">
                CANCELLED is a dead end — no revision can follow it. To pause temporarily, use &ldquo;Stop&rdquo; instead.
              </Notice>
              <input
                value={confirmCancel}
                onChange={(event) => onConfirmCancel(event.target.value)}
                placeholder={`Type ${task.id} to confirm`}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="danger"
                disabled={busy || confirmCancel.trim().toUpperCase() !== task.id.toUpperCase()}
                onClick={() => act(() => semanggi.cancel(task.id, "cancelled from the Summary page"))}
              >
                Cancel permanently
              </Button>
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function InfoTab({ detail }: { detail: TaskDetail }) {
  const { task, executions, dependencies } = detail;
  const rows: Array<[string, string, string?]> = [
    ["Project", task.projectId],
    ["Priority", `${task.priority} (effective ${task.effectivePriority})`],
    ["Quality class", task.qualityClass],
    ["Worker", task.workerId ?? "—"],
    [
      "Workspace",
      task.workspacePath ? shortenWorkspacePath(task.workspacePath) : "(project's own)",
      task.workspacePath ?? undefined,
    ],
    ["Workspace mode", task.workspaceMode],
    ["Session policy", task.sessionPolicy],
    ["Model policy", JSON.stringify(task.modelPolicy)],
    ["Created", relativeTime(task.createdAt)],
    ["Updated", relativeTime(task.updatedAt)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v, full]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1 text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="truncate text-right font-mono" title={full}>
              {v}
            </span>
          </div>
        ))}
      </div>

      {dependencies.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-medium">Waiting on</div>
          <div className="flex flex-wrap gap-2">
            {dependencies.map((d) => (
              <Badge key={d.id} tone={d.status === "COMPLETE" ? "success" : "neutral"}>
                {d.id} · {d.status}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-xs font-medium">Executions</div>
        {executions.length === 0 ? (
          <Empty>Never run yet.</Empty>
        ) : (
          <div className="space-y-1">
            {executions.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs">
                <span className="font-mono">#{e.revisionNo}</span>
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                <span className="font-mono">{e.model ?? "—"}</span>
                <span className="text-muted-foreground">{e.tokensBillable.toLocaleString("en-US")} tokens</span>
                <span className="text-muted-foreground">{relativeTime(e.endedAt ?? e.startedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium">Instructions</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{task.description}</pre>
      </details>
    </div>
  );
}

function Timeline({ events }: { events: WorkEvent[] }) {
  if (events.length === 0) return <Empty>No events recorded yet.</Empty>;
  return (
    <ol className="space-y-1">
      {events.map((e) => (
        <li key={e.seq} className="flex gap-3 rounded-md border border-border px-2 py-1.5 text-xs">
          <span className="w-28 shrink-0 text-muted-foreground">{relativeTime(e.at)}</span>
          <span className="w-40 shrink-0 font-mono">{e.kind}</span>
          <span className="w-24 shrink-0 truncate text-muted-foreground">{e.actor}</span>
          <span className="min-w-0 flex-1 truncate" title={JSON.stringify(e.payload)}>
            {e.kind === "task.comment" ? String(e.payload.text ?? "") : JSON.stringify(e.payload)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Transcript({ turns }: { turns: Array<{ role: string; at: number; text: string; revision: number }> }) {
  if (turns.length === 0) return <Empty>No transcript recorded yet.</Empty>;
  return (
    <div className="space-y-2">
      {turns.map((t, i) => (
        <div key={i} className={`rounded-md border px-3 py-2 text-xs ${t.role === "operator" ? "border-border bg-muted/50" : "border-border"}`}>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{t.role}</span>
            <span>#{t.revision}</span>
            <span>{relativeTime(t.at)}</span>
          </div>
          <pre className="whitespace-pre-wrap font-sans">{t.text}</pre>
        </div>
      ))}
    </div>
  );
}
