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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Bot, LoaderCircle, SendHorizontal } from "lucide-react";
import { semanggi, type ControlReply, type PlanStep, type ProjectSummary } from "@/lib/semanggi/client";
import { Badge, Button, LoadError, Notice, Select } from "./ui";

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
  const [atBottom, setAtBottom] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // Follows new messages down ONLY while already at the bottom — an operator
  // who scrolled up to reread something earlier in a long conversation should
  // not get yanked back down every time a new turn lands. Reaching the bottom
  // is instead one press of the arrow button away (below).
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Threshold, not exact-zero: a fractional-pixel gap from font rendering or
  // the smooth-scroll animation settling should still count as "at bottom",
  // or the jump button would flicker in and out at rest.
  const NEAR_BOTTOM_PX = 48;
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
  };

  const jumpToBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    setAtBottom(true);
  };

  // Grows with content up to MAX_TEXTAREA_PX, then scrolls — a chat box that
  // just keeps growing eventually pushes the send button off screen.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

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

  // No PageShell here (unlike every other Semanggi page): PageShell lays out
  // a normal scrolling document, and a chat composer that has to stay pinned
  // to the bottom needs the opposite contract — one viewport-tall column with
  // exactly one scrolling region in the middle. `sticky top-0` plus `h-[100dvh]`
  // gets that without touching AgentOS's own shell: the column behaves like a
  // fixed pane once scrolled into view, but never needs to know the sidebar's
  // width the way a true `position: fixed` bar would.
  return (
    <div className="sticky top-0 flex h-[100dvh] w-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Conversation, a command on an existing task, or new work to decompose — the intent router decides which.
          </p>
        </div>
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
      </header>

      {error ? (
        <div className="px-6 pt-3">
          <LoadError error={error} />
        </div>
      ) : null}

      {/* `relative` anchors the jump-to-bottom button to this scroll region
          specifically, not the page — so it stays put over the conversation
          regardless of where the composer or header end up. */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4">
            {messages.length === 0 ? (
              <ChatEmptyState
                onPick={(value) => {
                  setText(value);
                  textareaRef.current?.focus();
                }}
              />
            ) : null}

            {messages.map((message, index) =>
              message.kind === "operator" ? (
                <div key={index} className="flex justify-end">
                  <div className="max-w-[82%] rounded-[20px] bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
                    {message.text}
                  </div>
                </div>
              ) : (
                <SystemMessage key={index} reply={message.reply} />
              ),
            )}
            {busy ? <ThinkingBubble /> : null}
            <div ref={endRef} />
          </div>
        </div>

        {/* Only shown once there's somewhere to jump TO — a conversation that
            already fits on screen has no "end" worth a button for. */}
        {!atBottom && messages.length > 0 ? (
          <button
            type="button"
            aria-label="Jump to latest message"
            onClick={jumpToBottom}
            className="absolute bottom-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-colors hover:bg-accent"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {pendingConfirm ? (
        <div className="shrink-0 px-6 pb-2">
          <div className="mx-auto w-full max-w-3xl">
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
          </div>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
        // `sticky bottom-0` on top of `shrink-0` is deliberate belt-and-braces:
        // the flex column above already keeps this out of the scrolling
        // region, but `sticky` also pins it to the bottom of whatever
        // scrolling ancestor ends up containing this page once mounted
        // inside AgentOS's own shell (D39) — so a composer that "isn't fixed
        // at the bottom" stays fixed even if that outer shell's height/
        // overflow assumptions ever change.
        className="sticky bottom-0 z-10 shrink-0 border-t border-border/70 bg-background/95 px-6 py-3 backdrop-blur-xl"
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[24px] border border-border bg-card px-3 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
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
            className="max-h-[200px] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm outline-none focus:ring-0 placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || text.trim().length === 0}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Empty-state card shown before the first message — mirrors Mission
 * Control's own Chat panel welcome card (icon badge, heading, description,
 * pill-shaped quick prompts) rather than the plain caption this page used to
 * show. Picking a pill fills the composer; it never sends on its own,
 * since a bare "status " or "stop " with no task id isn't a real command.
 */
function ChatEmptyState({ onPick }: { onPick: (text: string) => void }) {
  const prompts: Array<{ label: string; text: string }> = [
    { label: "Check a task", text: "status TASK-" },
    { label: "Stop a task", text: "stop TASK-" },
    { label: "Run a task", text: "run TASK-" },
  ];
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <Bot className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Start a conversation</p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          Write the work you want done — it will be decomposed into a task per phase. Or give a command on an
          existing task.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
        {prompts.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(p.text)}
            className="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Waiting-for-reply indicator — shimmering skeleton bars, shown for the
 * short window between an operator message going out and the controller's
 * reply landing. Mirrors Mission Control's Chat panel "thinking" bubble;
 * Tailwind's built-in `animate-pulse` stands in for the drawer's own
 * framer-motion shimmer so this page doesn't need to depend on `motion/react`
 * (this project's own convention — plain Tailwind, no AgentOS-internal
 * imports).
 */
function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex w-full max-w-[70%] flex-col gap-1.5 rounded-[18px] border border-border bg-card px-3.5 py-3">
        <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-muted" />
        <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-muted" style={{ animationDelay: "150ms" }} />
      </div>
    </div>
  );
}

function SystemMessage({ reply }: { reply: ControlReply }) {
  const tone =
    reply.intent === "CONFIRM" ? "warning" : reply.intent === "WORK" && reply.created ? "success" : "neutral";
  const plan = reply.tasks.length > 0 ? reply.tasks : (reply.plan ?? []);
  // A left accent bar carries the tone at a glance across a long thread,
  // without repeating a colored badge on every line the way the border
  // color alone would ask the eye to do.
  const accent =
    tone === "warning"
      ? "border-l-amber-500/70"
      : tone === "success"
        ? "border-l-emerald-500/70"
        : "border-l-sky-500/50";

  return (
    <div className="flex justify-start">
      <div className={`w-full max-w-[90%] space-y-2.5 rounded-[18px] border border-l-[3px] border-border bg-card px-3.5 py-3 ${accent}`}>
        <div className="flex items-center gap-2">
          <Badge tone={tone === "warning" ? "warning" : tone === "success" ? "success" : "info"}>{reply.intent}</Badge>
          {reply.action ? <Badge tone="neutral">{reply.action}</Badge> : null}
          {reply.taskId ? <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{reply.taskId}</code> : null}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.reply}</p>
        {plan.length > 0 ? (
          <div className="space-y-1.5 pt-0.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {reply.created ? "Decomposed into" : "Proposed plan"}
            </div>
            <PlanTable steps={plan} created={reply.created === true} />
          </div>
        ) : null}
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
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Phase</th>
            <th className="px-2 py-1.5 font-medium">Level</th>
            <th className="px-2 py-1.5 font-medium">Brain</th>
            <th className="px-2 py-1.5 font-medium">Mode</th>
            {created ? <th className="px-2 py-1.5 font-medium">Task</th> : null}
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
