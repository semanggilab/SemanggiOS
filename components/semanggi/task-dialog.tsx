"use client";

// Single-task popup: info, timeline, approvals, comments, and controls.
//
// ONE RULE THAT BINDS EVERYTHING HERE
//
// Every button that stops work names what it's stopping before doing it
// (§8.7). "Cancel" even demands the task name be typed, because CANCELLED is
// a dead end in the state machine — nothing comes back from it — while "Stop"
// can be resumed.
//
// WHY THIS MODAL IS BIG, AND WHY THE SIDE PANEL EXISTS
//
// A task can carry several executions and dozens of timeline events, and the
// two things an operator actually reads in full — a brain's response and
// reasoning, or one event's raw payload — don't fit next to a task's own
// summary at a readable size. The side panel is that reading space: closed
// by default, opened by clicking an execution or a timeline row, closed by
// its own button or by clicking the dimmed backdrop behind it. The pattern
// (backdrop + a panel sliding from the right, absolutely positioned inside
// this dialog) mirrors AgentOS's own Edit Workspace document editor — see
// `workspace-wizard-document-editor.tsx` in the fork — for the same reason
// the rest of this file avoids importing AgentOS components: the visual
// language is worth matching, the code isn't worth coupling to.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ChevronRight, RefreshCw, X } from "lucide-react";
import {
  semanggi,
  relativeTime,
  shortenWorkspacePath,
  type Approval,
  type CatalogModel,
  type Execution,
  type Task,
  type TaskDetail,
  type TranscriptBlock,
  type TranscriptTurn,
  type WorkEvent,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, CopyButton, Empty, Field, LoadError, Notice, Select, statusTone, useModalLayer } from "./ui";

const FINISHED_STATUSES = new Set(["COMPLETE", "CANCELLED"]);

type Tab = "info" | "timeline" | "transcript";

type SidePanelState =
  | { kind: "execution"; execution: Execution }
  | { kind: "timeline"; event: WorkEvent }
  | null;

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
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("info");
  const [comment, setComment] = useState("");
  const [model, setModel] = useState("");
  const [confirmCancel, setConfirmCancel] = useState("");
  const [sidePanel, setSidePanel] = useState<SidePanelState>(null);
  // Transcript-tab floating actions share the execution panel's contract
  // (refresh reloads the transcript, the arrow appears only while the tab's
  // content overflows) — but they scroll THIS dialog's own scroll region,
  // because the Transcript tab lives in the modal body, not in a side panel.
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [transcriptOverflowing, setTranscriptOverflowing] = useState(false);
  const checkTranscriptOverflow = useCallback(() => {
    const el = mainScrollRef.current;
    setTranscriptOverflowing(el ? el.scrollHeight > el.clientHeight + 8 : false);
  }, []);
  useEffect(() => {
    checkTranscriptOverflow();
  }, [tab, turns, checkTranscriptOverflow]);

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

  // The transcript is what the side panel reads from, so it loads once up
  // front rather than only when the Transcript tab is opened — an execution
  // clicked from the Info tab needs its turns immediately, not after a
  // detour through a tab the operator never asked to see. Kept as a named
  // callback because the side panel's refresh button calls the same load.
  const loadTranscript = useCallback(() => {
    semanggi
      .transcript(taskId)
      .then((t) => setTurns(t.turns))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [taskId]);

  useEffect(() => {
    loadTranscript();
  }, [loadTranscript]);

  // Escape closes the side panel first, then the dialog — two presses to
  // fully back out matches what the panel's own visual layering already
  // implies (it sits on top), and a single Escape swallowing both would
  // discard the side panel's content the operator may still be reading.
  // Registered through useModalLayer (D79): this dialog now opens ON TOP of
  // the Process Manager, and an unstacked listener would answer Escape at the
  // same time as the layer beneath it.
  useModalLayer(() => {
    if (sidePanel) setSidePanel(null);
    else onClose();
  });

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

  // Tool results arrive as separate turns AFTER the assistant turn that asked
  // for them; pairing them into their call is what lets the conversation show
  // one region per action (call + what came back) instead of two interleaved
  // streams the reader has to correlate by hand.
  const pairedTurns = useMemo(() => pairToolResults(turns), [turns]);

  // Portaled + z-[70] (D79) for the same reason ui.tsx's Modal portals: the
  // Mission Control shell caps inline overlays at its own stacking context,
  // and a Process Manager modal (portaled, z-[70]) beneath this dialog would
  // otherwise paint ABOVE it. SSR guard mirrors Modal's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-lg sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative flex h-[90vh] w-[94vw] max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex shrink-0 items-start justify-between gap-5 border-b border-border px-6 py-4 pr-14">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{taskId}</code>
              <CopyButton text={taskId} label={`Copy task ID ${taskId}`} className="-translate-y-[0.1em] text-xs" />
              {task ? <Badge tone={statusTone(task.status)}>{task.status}</Badge> : null}
              {task?.expedited ? <Badge tone="warning">expedited</Badge> : null}
              {task ? <Badge tone="neutral">{task.qualityClass}</Badge> : null}
              {task?.workspaceMode === "read" ? <Badge tone="info">read</Badge> : null}
            </div>
            <h2 className="mt-2 truncate text-[17px] font-semibold leading-5">{task?.title ?? "Loading…"}</h2>
            {task?.waitReason ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{task.waitReason}</p> : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={mainScrollRef} onScroll={checkTranscriptOverflow} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
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

            {tab === "info" && detail ? (
              <InfoTab detail={detail} onOpenExecution={(execution) => setSidePanel({ kind: "execution", execution })} />
            ) : null}
            {tab === "timeline" ? (
              <Timeline events={events} onOpenEvent={(event) => setSidePanel({ kind: "timeline", event })} />
            ) : null}
            {tab === "transcript" ? <Transcript turns={pairedTurns} /> : null}

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

        {/* Transcript-tab twins of the execution panel's floating actions:
            same contract (refresh reloads the transcript; the arrow appears
            only while content overflows), shown only on this tab — other
            tabs have no live conversation worth jumping to the end of. */}
        {tab === "transcript" ? (
          <div className="absolute bottom-4 right-5 z-20 flex items-center gap-2">
            <button
              type="button"
              title="Reload the latest transcript"
              onClick={loadTranscript}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {transcriptOverflowing ? (
              <button
                type="button"
                title="Jump to the latest message"
                onClick={() => {
                  const el = mainScrollRef.current;
                  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}

        <DetailSidePanel panel={sidePanel} turns={pairedTurns} onClose={() => setSidePanel(null)} onRefresh={loadTranscript} />
      </div>
    </div>,
    document.body,
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

const SESSION_MODE_HINT: Record<"CONTINUE" | "FORK" | "FRESH", string> = {
  CONTINUE: "Resumes the same conversation the brain already had.",
  FORK: "Starts a new conversation recorded as descending from this one — history is not carried over.",
  FRESH: "Starts over with no prior conversation at all.",
};

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
  // A BLOCKED task is already stopped and already parked — Stop and
  // Force-run on it do nothing but suggest otherwise. The Resume region
  // below is the one live control for this status, so the two buttons go
  // dead while it's up.
  const blocked = task.status === "BLOCKED";
  // Every status a revision can legally move to QUEUED from (see
  // state-machine.mjs's TRANSITIONS): the WAIT_* family, RESUMABLE, FAILED,
  // COMPLETE (a revision is the one path allowed to re-queue it), and
  // BLOCKED — the status "Stop" itself parks a task on, specifically so it
  // could be picked up again. CANCELLED is excluded on purpose: it is a
  // dead end in the state machine, and this used to be reachable from here
  // too (the old gate was just "task is finished," which CANCELLED also is).
  // QUEUED, DISPATCHED, RUNNING and CREATED are excluded because each
  // already has its own control above (Stop, Stop, Stop, Start).
  const canRevise = !held && !live && task.status !== "QUEUED" && task.status !== "CANCELLED";
  const [sessionMode, setSessionMode] = useState<"CONTINUE" | "FORK" | "FRESH">("CONTINUE");
  const [instruction, setInstruction] = useState("");

  const reviseLabel = task.status === "BLOCKED" ? "Resume" : task.status === "FAILED" ? "Retry" : "Run again";

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
            disabled={busy || finished || blocked}
            title={
              blocked
                ? "A blocked task is already stopped — use Resume below"
                : live
                  ? "Stops the currently running execution"
                  : "Parks the task so its plan can be changed"
            }
            onClick={() => act(() => semanggi.stop(task.id, "stopped from the Summary page"))}
          >
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished || blocked}
            title={blocked ? "A blocked task can't run until it's resumed" : "Temporarily raises priority; recovers on its own after 30 minutes"}
            onClick={() => act(() => semanggi.expedite(task.id, 30 * 60_000))}
          >
            Force-run (30 min)
          </Button>
        </div>

        {/* Changing the model while running doesn't affect the current
            execution — it applies on the next dispatch. Saying so here is
            cheaper than letting the operator infer it from an unchanged
            result. */}
        <div className="rounded-md border border-border p-2.5">
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
        </div>

        {canRevise ? (
          <div className="rounded-md border border-border p-2.5">
            <div className="mb-2 text-xs font-medium">
              {reviseLabel}
              {task.status === "BLOCKED" ? (
                <span className="ml-1.5 font-normal text-muted-foreground">— this is how a stopped/blocked task gets going again</span>
              ) : null}
            </div>
            <Field label="Session" hint={SESSION_MODE_HINT[sessionMode]} className="min-w-[14rem]">
              <Select value={sessionMode} onChange={(v) => setSessionMode(v as "CONTINUE" | "FORK" | "FRESH")} disabled={busy}>
                <option value="CONTINUE">Continue</option>
                <option value="FORK">Fork</option>
                <option value="FRESH">Fresh</option>
              </Select>
            </Field>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={2}
              placeholder="Optional — what should change this time?"
              disabled={busy}
              className="mt-2 w-full resize-y rounded-md border border-border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled={busy} onClick={() => act(() => semanggi.rerun(task.id, sessionMode, instruction.trim()))}>
                {reviseLabel}
              </Button>
            </div>
          </div>
        ) : null}

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

function InfoTab({
  detail,
  onOpenExecution,
}: {
  detail: TaskDetail;
  onOpenExecution: (execution: Execution) => void;
}) {
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
  // Newest first: an operator opening this tab wants to know what just
  // happened, not what happened first.
  const byNewest = useMemo(() => [...executions].sort((a, b) => b.revisionNo - a.revisionNo), [executions]);

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
                {d.id}
                <CopyButton text={d.id} label={`Copy task ID ${d.id}`} className="mx-0.5 -translate-y-[0.1em] text-[10px]" />
                · {d.status}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-xs font-medium">Executions</div>
        {byNewest.length === 0 ? (
          <Empty>Never run yet.</Empty>
        ) : (
          <div className="space-y-1">
            {byNewest.map((e) => (
              <button
                key={e.id}
                onClick={() => onOpenExecution(e)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <span className="font-mono">#{e.revisionNo}</span>
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                <span className="font-mono">{e.model ?? "—"}</span>
                <span className="text-muted-foreground">{e.tokensBillable.toLocaleString("en-US")} tokens</span>
                <span className="text-muted-foreground">{relativeTime(e.endedAt ?? e.startedAt)}</span>
              </button>
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

function Timeline({ events, onOpenEvent }: { events: WorkEvent[]; onOpenEvent: (event: WorkEvent) => void }) {
  if (events.length === 0) return <Empty>No events recorded yet.</Empty>;
  return (
    <ol className="space-y-1">
      {events.map((e) => (
        <li key={e.seq}>
          <button
            onClick={() => onOpenEvent(e)}
            className="flex w-full gap-3 rounded-md border border-border px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <span className="w-28 shrink-0 text-muted-foreground">{relativeTime(e.at)}</span>
            <span className="w-40 shrink-0 font-mono">{e.kind}</span>
            <span className="w-24 shrink-0 truncate text-muted-foreground">{e.actor}</span>
            <span className="min-w-0 flex-1 truncate">
              {e.kind === "task.comment" ? String(e.payload.text ?? "") : JSON.stringify(e.payload)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  if (turns.length === 0) return <Empty>No transcript recorded yet.</Empty>;
  return (
    <div className="space-y-3">
      {turns.map((t, i) => (
        <div key={i} className={`rounded-md border px-3 py-2 ${t.role === "operator" ? "border-border bg-muted/50" : "border-border"}`}>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{roleLabel(t.role)}</span>
            <span>#{t.revision}</span>
            <span>{relativeTime(t.at)}</span>
          </div>
          <BlockList blocks={t.blocks} fallbackText={t.text} role={t.role} />
        </div>
      ))}
    </div>
  );
}

/**
 * Detail side panel: the reading space for one execution or one timeline
 * event, layered above everything else in the dialog. `absolute inset-0`
 * anchored to the dialog (which is `relative`) rather than `fixed` to the
 * viewport, so it never has to know the dialog's own size or position.
 */
function DetailSidePanel({
  panel,
  turns,
  onClose,
  onRefresh,
}: {
  panel: SidePanelState;
  turns: TranscriptTurn[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    setOverflowing(el ? el.scrollHeight > el.clientHeight + 8 : false);
  }, []);
  // Content height changes with every transcript reload and with the panel
  // opening on a different execution — re-measure on both, not just on
  // scroll, or the jump-to-end button shows up one reload late.
  useEffect(() => {
    checkOverflow();
  }, [panel, turns, checkOverflow]);

  if (!panel) return null;
  return (
    <div className="absolute inset-0 z-30">
      <button
        type="button"
        aria-label="Close detail panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/45 backdrop-blur-[1px]"
      />
      <div
        className="absolute inset-y-0 right-0 flex h-full w-full flex-col border-l border-border bg-background shadow-[0_34px_120px_rgba(0,0,0,0.35)] sm:w-1/2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {panel.kind === "execution" ? "Execution detail" : "Timeline detail"}
            </p>
            <p className="truncate text-sm font-medium">
              {panel.kind === "execution" ? `#${panel.execution.revisionNo} · ${panel.execution.model ?? "no model recorded"}` : panel.event.kind}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close detail panel"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={checkOverflow} className="h-full overflow-y-auto px-4 py-3">
            {panel.kind === "execution" ? (
              <ExecutionDetail execution={panel.execution} turns={turns} />
            ) : (
              <TimelineDetail event={panel.event} />
            )}
          </div>
          {/* Floating actions for the execution conversation: a running
              execution keeps growing, so the two things an operator reaches
              for — "what did it just say?" and "is there more?" — get
              buttons instead of a hunt through the scrollbar. */}
          {panel.kind === "execution" ? (
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button
                type="button"
                title="Reload the latest conversation"
                onClick={onRefresh}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              {overflowing ? (
                <button
                  type="button"
                  title="Jump to the latest message"
                  onClick={() => {
                    const el = scrollRef.current;
                    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono">{value}</span>
    </div>
  );
}

function ExecutionDetail({ execution, turns }: { execution: Execution; turns: TranscriptTurn[] }) {
  // Chronological within the execution — unlike the Executions list itself
  // (newest revision first), a single execution's own turns are a
  // conversation, and a conversation reads top-to-bottom.
  const own = turns.filter((t) => t.executionId === execution.id);
  // A COMPLETE run whose transcript holds no assistant text is not a
  // rendering bug — it is the `length` truncation D82 measured: the final
  // answer turn hit the model output cap and the gateway's fallback reply
  // never reaches subscribers. Saying so beats silence, and beats faking a
  // Response card the model never delivered.
  const hasTextAnswer = own.some(
    (t) =>
      t.role === "assistant" &&
      ((t.blocks ?? []).some((b) => b.type === "text" && stripFinal(String(b.text ?? "")).trim().length > 0) ||
        (!(t.blocks ?? []).length && stripFinal(String(t.text ?? "")).trim().length > 0)),
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        <DetailRow label="Status" value={<Badge tone={statusTone(execution.status)}>{execution.status}</Badge>} />
        <DetailRow label="Model" value={execution.model ?? "—"} />
        <DetailRow label="Tokens" value={execution.tokensBillable.toLocaleString("en-US")} />
        <DetailRow label="Started" value={execution.startedAt ? relativeTime(execution.startedAt) : "—"} />
        <DetailRow label="Ended" value={execution.endedAt ? relativeTime(execution.endedAt) : "—"} />
      </div>

      {execution.result ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Result</div>
          <p className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{execution.result}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Conversation</div>
        {own.length === 0 ? (
          <Empty>No transcript recorded for this execution yet.</Empty>
        ) : (
          own.map((t, i) => (
            <div key={i}>
              <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-medium">{roleLabel(t.role)}</span>
                <span>{relativeTime(t.at)}</span>
              </div>
              <BlockList blocks={t.blocks} fallbackText={t.text} role={t.role} />
            </div>
          ))
        )}
      </div>

      {execution.status === "COMPLETE" && own.length > 0 && !hasTextAnswer ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">No final answer</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This run completed without a final text answer — the final turn likely hit the model output cap
            (stop reason <code className="rounded bg-amber-500/15 px-1">length</code>), and the gateway&rsquo;s
            fallback reply is not delivered to this transcript. The work above may still be intact: check the last
            tool outputs, or revise the task asking only for the conclusion.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TimelineDetail({ event }: { event: WorkEvent }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        <DetailRow label="Kind" value={<code className="text-[11px]">{event.kind}</code>} />
        <DetailRow label="Actor" value={event.actor} />
        <DetailRow label="At" value={relativeTime(event.at)} />
        <DetailRow label="Subject" value={`${event.subjectType} · ${event.subjectId}`} />
      </div>
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Payload</div>
        {event.kind === "task.comment" ? (
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm leading-relaxed">
            {String(event.payload.text ?? "")}
          </p>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px]">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Merges every toolResult turn into the toolCall block it answers, dropping
 * the now-empty turn.
 *
 * The gateway's result frames carry NO call id (measured on the pinned
 * 2026.7.1 wire — `recordToolResult` in session-events.mjs keeps only
 * name/meta/isError/exitCode/durationMs/text), so pairing is FIFO per tool
 * name within one execution. The queue resets whenever executionId changes:
 * a revision 2 call must never swallow a revision 1 result that never
 * matched. A result with no pending call stays visible as its own turn
 * rather than vanishing — §8.7 again, a block that silently disappears is
 * easy to mistake for one that never happened.
 */
function pairToolResults(turns: TranscriptTurn[]): TranscriptTurn[] {
  const pending = new Map<string, TranscriptBlock[]>();
  let currentExecution: string | undefined;
  const paired: TranscriptTurn[] = [];
  for (const turn of turns) {
    if (turn.executionId !== currentExecution) {
      pending.clear();
      currentExecution = turn.executionId;
    }
    if (turn.role !== "toolResult" || !turn.blocks) {
      // Copy the blocks before queuing them: attaching a result mutates the
      // block, and mutating the raw state object would leak the merge into
      // every other render of these turns.
      const blocks = turn.blocks ? turn.blocks.map((block) => ({ ...block })) : turn.blocks;
      for (const block of blocks ?? []) {
        if (block.type === "toolCall" && block.name) {
          const queue = pending.get(block.name) ?? [];
          queue.push(block);
          pending.set(block.name, queue);
        }
      }
      paired.push(blocks ? { ...turn, blocks } : turn);
      continue;
    }
    const remaining: TranscriptBlock[] = [];
    for (const block of turn.blocks) {
      if (block.type !== "toolResult") {
        remaining.push(block);
        continue;
      }
      const call = block.name ? pending.get(block.name)?.shift() : undefined;
      if (call) call.result = block;
      else remaining.push(block);
    }
    if (remaining.length > 0) paired.push({ ...turn, blocks: remaining });
  }
  return paired;
}

/**
 * Brains on this gateway wrap their answer in <final>…</final>. The wrapper
 * is wire vocabulary, not content — an operator reading the transcript wants
 * what's inside, without the tag.
 */
function stripFinal(text: string): string {
  const match = /<final>([\s\S]*?)<\/final>/.exec(text);
  return (match ? match[1] : text).trim();
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * The gateway's role vocabulary is wire-shaped (toolResult, assistant); the
 * transcript is read by people, so each role gets a readable label instead of
 * a capitalized identifier.
 */
function roleLabel(role: string): string {
  switch (role) {
    case "toolResult":
      return "Tool output";
    case "assistant":
      return "Assistant";
    case "user":
      return "User";
    case "operator":
      return "Operator";
    default:
      return role;
  }
}

/**
 * Renders a turn's raw content blocks, distinguishing what a person actually
 * needs to tell apart: the response, the reasoning behind it, and what it
 * ran. Falls back to the flattened text when there are no blocks (an
 * operator's own instruction, or an execution recorded before this UI could
 * read `blocks` at all) rather than showing nothing.
 */
function BlockList({ blocks, fallbackText, role }: { blocks: TranscriptBlock[] | null; fallbackText: string; role?: string }) {
  if (!blocks || blocks.length === 0) {
    // The flattened fallback of an assistant turn can still carry the
    // <final> wrapper; an operator's or tool's flattened text never does.
    const body = role === "assistant" ? stripFinal(fallbackText) : fallbackText;
    if (!body) return null;
    if (role === "assistant") {
      return (
        <div className="relative">
          <CopyButton text={body} label="Copy response source" className="absolute right-0 top-0 z-10 bg-background/85 p-1 backdrop-blur-sm" />
          <Markdownish text={body} />
        </div>
      );
    }
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{body}</p>;
  }
  return (
    <div className="space-y-1.5">
      {blocks.map((block, index) => (
        <TranscriptBlockView key={index} block={block} role={role} />
      ))}
    </div>
  );
}

function TranscriptBlockView({ block, role }: { block: TranscriptBlock; role?: string }) {
  if (block.type === "toolResult") {
    // A result that never paired with a call (the gateway dropped the
    // assistant turn, or the call predates pairing) still gets the same
    // collapsible region treatment as a merged result — same shell, same
    // header vocabulary, titled "Output <name>" so the pair reads as
    // "Call X" / "Output X" when both are visible.
    const name = typeof block.name === "string" ? block.name : null;
    const exit = typeof block.exitCode === "number" ? block.exitCode : null;
    const duration = typeof block.durationMs === "number" ? block.durationMs : null;
    return (
      <TranscriptRegion
        title={
          <>
            <span>Output</span>
            {name ? <code className="rounded bg-sky-500/15 px-1.5 py-0.5 normal-case text-[11px] text-sky-800 dark:text-sky-200">{name}</code> : null}
          </>
        }
        right={
          <>
            {/* exit 0 is success — showing it would badge every healthy run
                with noise; only non-zero exits earn the warning chip. */}
            {exit !== null && exit !== 0 ? (
              <code className="rounded bg-amber-500/15 px-1.5 py-0.5 normal-case text-[10px] text-amber-700 dark:text-amber-300">
                exit {exit}
              </code>
            ) : null}
            {duration !== null ? <span className="normal-case text-muted-foreground">{formatDuration(duration)}</span> : null}
          </>
        }
      >
        <ToolResultBody name={name ?? ""} result={block} />
      </TranscriptRegion>
    );
  }

  if (block.type === "text") {
    // A text block inside a toolResult turn is what a tool printed — shell
    // output, a file listing, a diff — not something the model said. Labeling
    // it "Response" would read the transcript backwards. Same collapsible
    // shell as the block-shaped results above, for the same reason.
    if (role === "toolResult") {
      return (
        <TranscriptRegion title={<span>Output</span>}>
          <ToolResultBody name="" result={block} />
        </TranscriptRegion>
      );
    }
    const body = stripFinal(block.text ?? "");
    if (!body) return null;
    return (
      // Copy takes the region's SOURCE text — the stripped answer, exactly
      // what's rendered — not the wire text with its <final> wrapper.
      <div className="relative rounded-lg border border-border bg-card px-3 py-2">
        <CopyButton text={body} label="Copy response source" className="absolute right-1.5 top-1.5 z-10 bg-card/90 p-1 backdrop-blur-sm" />
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Response</div>
        <Markdownish text={body} />
      </div>
    );
  }

  if (block.type === "thinking") {
    return (
      <details className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
        <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Reasoning
        </summary>
        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{block.thinking}</p>
      </details>
    );
  }

  if (block.type === "toolCall") {
    return <ToolCallView block={block} />;
  }

  if (block.type === "toolEvent") {
    // A `session.tool` lifecycle frame (the `tool-events` cap, D48): wire
    // bookkeeping about a tool call, not the call's output — the output has
    // its own "Output" region, so this only matters when debugging the
    // protocol itself. Collapsed by default in the Reasoning region's shell
    // (dashed border, muted body) for the same reason: long executions emit
    // one per tool phase and none of them change what the run did.
    const name =
      typeof block.toolName === "string" ? block.toolName : typeof block.name === "string" ? block.name : null;
    const phase =
      typeof block.phase === "string" ? block.phase : typeof block.status === "string" ? block.status : null;
    return (
      <details className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
          Tool Event
          {name ? <code className="rounded bg-muted px-1.5 py-0.5 normal-case text-[11px]">{name}</code> : null}
          {phase ? <span className="ml-auto normal-case">{phase}</span> : null}
        </summary>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
          {JSON.stringify((block.payload as object | undefined) ?? block, null, 2)}
        </pre>
      </details>
    );
  }

  // An unrecognised block type — the gateway may add ones this UI doesn't
  // know about yet — is shown, not hidden, per §8.7's spirit: a block that
  // silently disappears is easy to mistake for one that never happened.
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{block.type}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{JSON.stringify(block, null, 2)}</pre>
    </div>
  );
}

/**
 * Wire tool names → the label an operator actually reads. Exec is "Call
 * Exec" (not just "Exec") so the pair with its result region — "Output
 * exec" — reads unambiguously when both sit in one transcript; Read/Write
 * keep the bare verb.
 */
const TOOL_VERB: Record<string, string> = { exec: "Call Exec", read: "Read", write: "Write", edit: "Edit" };

/**
 * The shared collapsible shell for tool call and tool output regions: same
 * border, same header rhythm (chevron, title, badges pushed right), same
 * collapsed-by-default behavior — so a transcript reads as one consistent
 * stack of actions instead of two different shapes of box.
 */
function TranscriptRegion({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {title}
        {right ? <span className="ml-auto flex items-center gap-2 normal-case">{right}</span> : null}
      </summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

/**
 * One collapsed region per tool action: the call (command, file, content)
 * above a delimiter and what came back below it.
 *
 * Collapsed by default because a long execution is dozens of these and the
 * two things an operator scans for — which command ran, did it fail — are
 * both in the header: the verb and path on the left, exit code and duration
 * on the right. The body is only worth opening to read output or review a
 * write.
 */
function ToolCallView({ block }: { block: TranscriptBlock }) {
  const name = typeof block.name === "string" ? block.name : "?";
  const args = block.arguments ?? {};
  const command = typeof args.command === "string" ? args.command : null;
  const path =
    typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? (args.file_path as string) : null;
  // Write content is the payload being written — the one argument worth
  // reading in full, multiline, rather than as a truncated key/value row.
  const content = typeof args.content === "string" ? args.content : null;
  // The edit payload is a list of {oldText, newText} blocks (measured on the
  // cluster wire) — it IS the change, so it renders as a diff instead of a
  // JSON blob in the key/value rows. An unparseable payload stays in `rest`
  // and is shown raw rather than dropped.
  const edits = name === "edit" ? parseEdits(args.edits) : null;
  const rest = Object.entries(args).filter(
    ([key]) => !["command", "path", "file_path", "content"].includes(key) && !(edits && key === "edits"),
  );
  const result = (block.result as TranscriptBlock | undefined) ?? undefined;
  const exit = typeof result?.exitCode === "number" ? result.exitCode : null;
  const duration = typeof result?.durationMs === "number" ? result.durationMs : null;

  return (
    <TranscriptRegion
      title={
        <>
          <span>{TOOL_VERB[name] ?? name}</span>
          {path ? (
            <code className="truncate normal-case text-[11px] text-muted-foreground" title={path}>
              {path}
            </code>
          ) : null}
        </>
      }
      right={
        <>
          {exit !== null && exit !== 0 ? (
            <code className="rounded bg-amber-500/15 px-1.5 py-0.5 normal-case text-[10px] text-amber-700 dark:text-amber-300">
              exit {exit}
            </code>
          ) : null}
          {duration !== null ? <span className="normal-case text-muted-foreground">{formatDuration(duration)}</span> : null}
        </>
      }
    >
      {command ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-zinc-900 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-100">
          {command}
        </pre>
      ) : null}
      {edits ? <EditDiffView edits={edits} /> : null}
      {content ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed">
          {content}
        </pre>
      ) : null}
      {rest.length > 0 ? (
        <dl className="space-y-0.5 text-[11px]">
          {rest.map(([key, value]) => {
            const rendered = typeof value === "string" ? value : JSON.stringify(value);
            return (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{key}</dt>
                <dd className="min-w-0 font-mono" title={rendered}>
                  {rendered}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {result ? (
        <>
          <div className="border-t border-dashed border-border" />
          <ToolResultBody name={name} result={result} />
        </>
      ) : null}
    </TranscriptRegion>
  );
}

// --- Edit diffs --------------------------------------------------------------
//
// An `edit` call is the one tool action whose payload is a CHANGE rather than
// content, and reading oldText/newText as a JSON blob makes the operator do
// the diff in their head — exactly what the transcript exists to spare them.
// So the payload renders as a line diff, computed here: the fork ships no
// diff library and adding one is the rebase tax this component tree exists to
// avoid (same reasoning as Markdownish below).

type EditOp = { oldText: string; newText: string };

/**
 * The wire shape measured on the cluster: `arguments.edits` is an array of
 * {oldText, newText} — possibly several per call, and the tool's own errors
 * reference them as `edits[2]`, so the index is part of the vocabulary.
 * Anything that does not match returns null, which leaves the payload in the
 * raw key/value rows instead of silently dropping it.
 */
function parseEdits(raw: unknown): EditOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const edits: EditOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { oldText, newText } = item as Record<string, unknown>;
    if (oldText === undefined && newText === undefined) return null;
    if (oldText !== undefined && typeof oldText !== "string") return null;
    if (newText !== undefined && typeof newText !== "string") return null;
    edits.push({ oldText: oldText ?? "", newText: newText ?? "" });
  }
  return edits;
}

// oldNo/newNo number the line in ITS OWN text — the wire carries no file
// position (measured: the call is only {path, edits:[{oldText,newText}]}, and
// the tool matches oldText by content), so these are relative to the edit's
// snippet, and the header says so.
type DiffLine = { kind: "same" | "del" | "add"; text: string; oldNo: number | null; newNo: number | null };
type DiffRow = DiffLine | { gap: number };

/**
 * Line diff by longest-common-subsequence. The table is quadratic, so a
 * pathological edit gets a ceiling instead of a hung browser tab; over it the
 * caller falls back to showing before/after.
 */
function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.replace(/\r\n/g, "\n").split("\n");
  const b = newText.replace(/\r\n/g, "\n").split("\n");
  if (a.length * b.length > 2_000_000) return null;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i], oldNo: i + 1, newNo: null });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j], oldNo: null, newNo: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: "del", text: a[i], oldNo: i + 1, newNo: null });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: "add", text: b[j], oldNo: null, newNo: j + 1 });
    j += 1;
  }
  return out;
}

/** First→last changed line on each side, e.g. `L3–5 → L3–6` for the header. */
function diffLineSpan(lines: DiffLine[]): string {
  let oldFirst: number | null = null;
  let oldLast: number | null = null;
  let newFirst: number | null = null;
  let newLast: number | null = null;
  for (const line of lines) {
    if (line.kind === "del" && line.oldNo !== null) {
      oldFirst = oldFirst ?? line.oldNo;
      oldLast = line.oldNo;
    }
    if (line.kind === "add" && line.newNo !== null) {
      newFirst = newFirst ?? line.newNo;
      newLast = line.newNo;
    }
  }
  const span = (first: number | null, last: number | null) =>
    first === null || last === null ? null : first === last ? `L${first}` : `L${first}–${last}`;
  const oldSpan = span(oldFirst, oldLast);
  const newSpan = span(newFirst, newLast);
  // A pure insertion or deletion has only one side; the sign says which.
  if (oldSpan && newSpan) return `${oldSpan} → ${newSpan}`;
  if (oldSpan) return `−${oldSpan}`;
  if (newSpan) return `+${newSpan}`;
  return "";
}

/**
 * Keeps `context` unchanged lines around each change and collapses longer
 * unchanged runs into a single gap row — an edit touching three lines of a
 * 400-line file must not render 400 lines to prove it.
 */
function compactDiff(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === "same") continue;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  }
  const rows: DiffRow[] = [];
  let gap = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (gap > 0) {
        rows.push({ gap });
        gap = 0;
      }
      rows.push(lines[i]);
    } else {
      gap += 1;
    }
  }
  if (gap > 0) rows.push({ gap });
  return rows;
}

const DIFF_ROW_CLASS: Record<DiffLine["kind"], string> = {
  same: "",
  del: "bg-red-500/10 text-red-800 dark:text-red-300",
  add: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
};

const DIFF_PREFIX: Record<DiffLine["kind"], string> = { same: " ", del: "-", add: "+" };

function EditDiffView({ edits }: { edits: EditOp[] }) {
  return (
    <div className="space-y-2">
      {edits.map((edit, index) => (
        <EditDiffBlock key={index} edit={edit} />
      ))}
    </div>
  );
}

function EditDiffBlock({ edit }: { edit: EditOp }) {
  if (edit.oldText === edit.newText) {
    // Measured live: a brain does occasionally submit a no-op edit. Saying so
    // beats rendering an all-context diff that shows nothing.
    return (
      <div className="rounded-md border border-border bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
        old and new text are identical — nothing changed
      </div>
    );
  }
  const lines = diffLines(edit.oldText, edit.newText);
  if (!lines) {
    // Over the LCS ceiling: the honest fallback is the two texts in full,
    // one above the other.
    return (
      <div className="space-y-1.5">
        <div>
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Before</div>
          <pre className="overflow-x-auto whitespace-pre rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed">
            {edit.oldText}
          </pre>
        </div>
        <div>
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">After</div>
          <pre className="overflow-x-auto whitespace-pre rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed">
            {edit.newText}
          </pre>
        </div>
      </div>
    );
  }
  const adds = lines.filter((l) => l.kind === "add").length;
  const dels = lines.filter((l) => l.kind === "del").length;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-2.5 py-1 text-[10px] text-muted-foreground">
        {/* The span an operator scans for — which lines this edit touched.
            The wire carries no file position, so the numbers are relative to
            the edit's own old/new text, and the tooltip says so. */}
        <code
          className="rounded bg-muted px-1 py-0.5"
          title="Line numbers are relative to this edit's own old/new text — the gateway sends no file position."
        >
          {diffLineSpan(lines)}
        </code>
        <span className="ml-auto">
          <span className="text-emerald-700 dark:text-emerald-300">+{adds}</span>{" "}
          <span className="text-red-700 dark:text-red-300">−{dels}</span>
        </span>
      </div>
      <div className="overflow-x-auto bg-card font-mono text-[11px] leading-relaxed">
        {compactDiff(lines).map((row, index) =>
          "gap" in row ? (
            <div key={index} className="bg-muted/40 px-2.5 py-0.5 text-center text-[10px] text-muted-foreground">
              ⋯ {row.gap} unchanged {row.gap === 1 ? "line" : "lines"}
            </div>
          ) : (
            <div key={index} className={`flex ${DIFF_ROW_CLASS[row.kind]}`}>
              <span className="w-8 shrink-0 select-none border-r border-border/40 px-1 text-right text-[10px] opacity-50">
                {row.oldNo ?? ""}
              </span>
              <span className="w-8 shrink-0 select-none border-r border-border/40 px-1 text-right text-[10px] opacity-50">
                {row.newNo ?? ""}
              </span>
              <span className="w-5 shrink-0 select-none text-center opacity-60">{DIFF_PREFIX[row.kind]}</span>
              {/* A blank line still needs height, or consecutive empties read
                  as one line. */}
              <span className="whitespace-pre pr-2.5">{row.text || " "}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * What a tool printed, in the shape it was printed in: shell output reads as
 * a terminal, file contents and model-shaped text read as prose. Only the
 * `text` field is shown — exit, duration and failure state live in the
 * region's header, and anything else is wire bookkeeping.
 *
 * A failed call gets the red treatment (transparent fill, red border): when
 * scanning a transcript, the failed command is the one thing that must not
 * look identical to everything around it.
 */
function ToolResultBody({ name, result }: { name: string; result: TranscriptBlock }) {
  const failed = result.isError === true;
  const text = typeof result.text === "string" ? result.text : "";
  if (!text) return null;
  return (
    <div className={`relative ${failed ? "rounded-md border border-red-500/50 bg-red-500/10 px-2.5 py-2" : ""}`}>
      {name === "exec" ? (
        <pre
          className={`overflow-x-auto whitespace-pre-wrap rounded-md bg-zinc-900 px-2.5 py-2 font-mono text-[11px] leading-relaxed ${
            failed ? "text-red-300" : "text-zinc-100"
          }`}
        >
          {text}
        </pre>
      ) : (
        <>
          {/* Markdown-rendered tool output (file reads, written content) —
              the copy affordance belongs to the region, top-right inside it,
              and copies the raw source the renderer received. */}
          <CopyButton text={text} label="Copy output source" className="absolute right-1 top-1 z-10 bg-background/85 p-1 backdrop-blur-sm" />
          <Markdownish text={text} className={failed ? "text-red-700 dark:text-red-300" : undefined} />
        </>
      )}
    </div>
  );
}

/**
 * Markdown, enough of it to read a transcript — no dependency.
 *
 * The fork ships no markdown renderer and pulling one in would add a package
 * upstream doesn't carry, which is exactly the rebase tax this component
 * tree exists to avoid. What brains actually write — headings, lists, code
 * fences, inline code, bold, links — fits in this box; anything else falls
 * through as plain paragraphs instead of disappearing.
 */
/** GFM pipe tables — the one block shape deliverable reports kept using
 *  that the renderer dropped into a plain paragraph (TASK reports read from
 *  a `read` tool result were the visible case). */
function isTableSeparator(line: string): boolean {
  return line.includes("|") && line.includes("-") && /^[\s|:-]+$/.test(line);
}

function isTableStart(line: string, next: string | undefined): boolean {
  return line.includes("|") && next !== undefined && isTableSeparator(next);
}

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

function Markdownish({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isBlockStart = (line: string, next?: string) =>
    line.startsWith("```") ||
    /^#{1,4}\s/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    isTableStart(line, next);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed">
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <div key={key++} className={heading[1].length <= 2 ? "text-sm font-semibold" : "text-xs font-semibold uppercase tracking-wide"}>
          {renderInline(heading[2], `h${key}`)}
        </div>,
      );
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-0.5 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-0.5 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th key={idx} className="border border-border bg-muted px-2 py-1 text-left font-medium">
                    {renderInline(cell, `th${key}-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="border border-border px-2 py-1 align-top">
                      {renderInline(cell, `td${key}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key++}>{renderInline(paragraph.join(" "), `p${key}`)}</p>);
  }
  return <div className={`space-y-2 text-sm leading-relaxed ${className}`}>{blocks}</div>;
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  let seq = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const [token] = match;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyBase}-c${seq++}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyBase}-b${seq++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      nodes.push(
        <a key={`${keyBase}-a${seq++}`} href={match[5]} className="underline underline-offset-2">
          {match[4]}
        </a>,
      );
    } else {
      nodes.push(
        <em key={`${keyBase}-i${seq++}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
