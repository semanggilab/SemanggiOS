"use client";

// Control page: a single conversation column routed by intent.
//
// WHAT THIS PAGE DOES, AND WHAT IT DOESN'T
//
// It sends text and displays what the controller decided. It does NOT
// classify anything itself, does NOT guess the project, and does NOT decide
// whether something is destructive — all of that belongs to the controller,
// and duplicating it here would produce two surfaces that quietly diverge
// the moment one of them changes.
//
// TEMPLATE AND PROFILE AREN'T PICKED HERE ANYMORE (D37)
//
// They used to be a "Context" card re-filled on every request. Both are now
// a project's own setting (Settings → Project), chosen once when the project
// is set up rather than every time someone opens this page. What's left to
// pick per request is which project the work belongs to — the "Active
// Project" dropdown, top-right, matching the one on Summary.
//
// THREE PATHS THAT LOOK DIFFERENT, DELIBERATELY
//
//   CHAT     an ordinary reply
//   TASK     a command on an existing task; a destructive verb demands
//            explicit confirmation, and the confirmation names what stops
//   WORK     split into several tasks; the plan is shown as an ordered list,
//            not as a paragraph
//
// CONFIRM is not a failure. It's §8.2's rule doing its job: a classification
// the router isn't sure about becomes a question, never an action.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { semanggi, type ControlReply, type PlanStep, type ProjectSummary } from "@/lib/semanggi/client";
import { Badge, Button, Card, LoadError, Notice, PageShell, Select } from "./ui";

type Message =
  | { kind: "operator"; text: string; at: number }
  | { kind: "system"; reply: ControlReply; at: number };

const MIN_ROWS = 1;
const MAX_TEXTAREA_PX = 200;

export function ControlPage({ activeWorkspacePath }: { activeWorkspacePath?: string | null }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ text: string; target: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    semanggi
      .projectSummary()
      .then((s) => setProjects(s.projects))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Defaults to whichever project's workspace matches AgentOS's active
  // workspace — the same prefix match Summary uses, and for the same reason
  // (§ workspace filter note there): Semanggi hasn't synced projects from
  // AgentOS yet, so a path is the one thing both sides actually share. Falls
  // back to the first project once results arrive if nothing matches, so the
  // dropdown is never left empty when at least one project exists.
  useEffect(() => {
    if (projectId || projects.length === 0) return;
    const match = activeWorkspacePath
      ? projects.find(
          (p) => p.workspacePath && (p.workspacePath === activeWorkspacePath || p.workspacePath.startsWith(`${activeWorkspacePath}/`)),
        )
      : null;
    setProjectId((match ?? projects[0]).id);
  }, [projects, activeWorkspacePath, projectId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Grows with content up to MAX_TEXTAREA_PX, then scrolls — a chat box that
  // just keeps growing eventually pushes the send button off screen.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  const activeProject = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  const send = async (raw: string, confirm = false) => {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    if (!confirm) setMessages((prev) => [...prev, { kind: "operator", text: value, at: Date.now() }]);
    try {
      const reply = await semanggi.control({
        text: value,
        projectId: projectId || undefined,
        confirm,
      });
      setMessages((prev) => [...prev, { kind: "system", reply, at: Date.now() }]);
      setPendingConfirm(reply.needsConfirmation ? { text: value, target: reply.target?.id ?? "" } : null);
      if (!confirm) setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Control"
      description="Send a request to Semanggi. The intent router decides whether it's a conversation, a command on an existing task, or new work that needs to be decomposed."
      actions={
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Active Project</span>
          <Select value={projectId} onChange={setProjectId} className="min-w-[12rem]">
            {projects.length === 0 ? <option value="">(no projects)</option> : null}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
      }
    >
      {error ? <LoadError error={error} /> : null}

      {activeProject ? (
        <p className="text-xs text-muted-foreground">
          Decomposing into <span className="font-medium text-foreground">{activeProject.name}</span> using that
          project&rsquo;s own template and profile — change those in{" "}
          <a href="/settings#semanggi-projects" className="underline underline-offset-2">
            Settings → Project
          </a>
          .
        </p>
      ) : null}

      <Card className="flex min-h-[24rem] flex-col">
        <div className="flex-1 space-y-3">
          {messages.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Write the work you want done — it will be decomposed into a task per phase.
              <br />
              Or give a command on an existing task: <code>status TASK-XXXX</code>, <code>stop TASK-XXXX</code>,{" "}
              <code>run TASK-XXXX</code>.
            </div>
          ) : null}

          {messages.map((message, index) =>
            message.kind === "operator" ? (
              <div key={index} className="flex justify-end">
                <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{message.text}</div>
              </div>
            ) : (
              <SystemMessage key={index} reply={message.reply} />
            ),
          )}
          <div ref={endRef} />
        </div>
      </Card>

      {pendingConfirm ? (
        <Notice tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Confirmation is required before this runs.</span>
            <span className="flex gap-2">
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void send(pendingConfirm.text, true)}>
                Yes, proceed
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingConfirm(null)}>
                Cancel
              </Button>
            </span>
          </div>
        </Notice>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
        className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter inserts a newline — work requests are
            // often multi-line, and forcing a single line makes people
            // shorten the request until it loses an important requirement.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
          rows={MIN_ROWS}
          placeholder="Message Semanggi…"
          className="max-h-[200px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-0"
        />
        <Button type="submit" size="sm" disabled={busy || text.trim().length === 0}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </form>
    </PageShell>
  );
}

function SystemMessage({ reply }: { reply: ControlReply }) {
  const tone =
    reply.intent === "CONFIRM" ? "warning" : reply.intent === "WORK" && reply.created ? "success" : "neutral";
  const plan = reply.tasks.length > 0 ? reply.tasks : (reply.plan ?? []);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[90%] space-y-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge tone={tone === "warning" ? "warning" : tone === "success" ? "success" : "info"}>{reply.intent}</Badge>
          {reply.action ? <Badge tone="neutral">{reply.action}</Badge> : null}
          {reply.taskId ? <code className="text-[11px]">{reply.taskId}</code> : null}
        </div>
        <p className="whitespace-pre-wrap text-sm">{reply.reply}</p>
        {plan.length > 0 ? <PlanTable steps={plan} created={reply.created === true} /> : null}
      </div>
    </div>
  );
}

function PlanTable({ steps, created }: { steps: PlanStep[]; created: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 py-1 font-medium">#</th>
            <th className="px-2 py-1 font-medium">Phase</th>
            <th className="px-2 py-1 font-medium">Level</th>
            <th className="px-2 py-1 font-medium">Brain</th>
            <th className="px-2 py-1 font-medium">Mode</th>
            {created ? <th className="px-2 py-1 font-medium">Task</th> : null}
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={step.role} className="border-t border-border">
              <td className="px-2 py-1 text-muted-foreground">{index + 1}</td>
              <td className="px-2 py-1">
                <div className="font-medium">{step.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {step.role}
                  {step.after.length > 0 ? ` · after ${step.after.join(", ")}` : ""}
                </div>
              </td>
              <td className="px-2 py-1">
                <Badge tone={step.level === "critical" ? "warning" : "neutral"}>{step.level}</Badge>
              </td>
              <td className="px-2 py-1">
                {step.brain ? (
                  <span title={step.brainNote ?? undefined}>
                    {step.brain}
                    {/* `pinned` means the operator chose it; `level` means it
                        fell out of the candidate pool. The distinction matters
                        when a result disappoints and someone asks "who picked
                        this". */}
                    <span className="ml-1 text-[10px] text-muted-foreground">({step.brainSource})</span>
                  </span>
                ) : (
                  <span className="text-red-600 dark:text-red-300">none yet</span>
                )}
                {step.brainNote ? <div className="text-[10px] text-amber-600 dark:text-amber-300">{step.brainNote}</div> : null}
              </td>
              <td className="px-2 py-1 text-muted-foreground">{step.workspaceMode}</td>
              {created ? (
                <td className="px-2 py-1">
                  <code className="text-[10px]">{step.taskId}</code>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
