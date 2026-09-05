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

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Bot, LoaderCircle, SendHorizontal } from "lucide-react";
import {
  semanggi,
  type CatalogModel,
  type ControlReply,
  type PlanStep,
  type ProjectDocStatus,
  type ProjectDocs,
  type ProjectSummary,
} from "@/lib/semanggi/client";
import { Badge, Button, Empty, LoadError, Modal, Notice, Select } from "./ui";
import { TaskDialog } from "./task-dialog";

type Message =
  | { kind: "operator"; text: string; at: number }
  | { kind: "system"; reply: ControlReply; at: number };

const MIN_ROWS = 1;
const MAX_TEXTAREA_PX = 200;

// SATU template bersama: tombol "Register tasks" di modal dokumen dan pill
// quick-prompt di empty state harus menyisipkan teks yang sama persis — dua
// salinan akan menyimpang sendiri. "langsung jalankan" dieja benar karena
// frasa itulah yang dideteksi controller untuk memutuskan CREATED vs QUEUED.
const REGISTER_TASKS_TEXT = "/prepare daftarkan semua tasks yang ada di docs/tasks.md dan langsung jalankan";

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
  const [docs, setDocs] = useState<ProjectDocs | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  useEffect(() => {
    semanggi
      .projectSummary()
      .then((s) => setProjects(s.projects))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // The task dialog's model picker needs the catalog; a failure here only
    // degrades that picker, so it is swallowed instead of bannering the page.
    semanggi
      .models()
      .then((m) => setModels(m.models))
      .catch(() => {});
  }, []);

  // Readiness checklist is per project — refetch whenever the selection
  // changes, so switching projects re-grades the pills immediately.
  useEffect(() => {
    if (!projectId) {
      setDocs(null);
      return;
    }
    let cancelled = false;
    semanggi
      .projectDocs(projectId)
      .then((d) => {
        if (!cancelled) setDocs(d);
      })
      .catch(() => {
        if (!cancelled) setDocs(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // The composer is position:fixed against the window (below), so it is out
  // of the flex flow — the chat region would extend behind it and hide the
  // newest messages, the exact overflow bug this layout change exists for.
  // Measuring the composer (it grows with the textarea, up to 200px) and
  // padding the scroll content by that height makes the conversation END
  // exactly above the input, nothing behind anything.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setComposerHeight(el.offsetHeight));
    observer.observe(el);
    setComposerHeight(el.offsetHeight);
    return () => observer.disconnect();
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
    <div className="flex h-[100dvh] w-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div>
          {/* Readiness pills — the first job of a new project is getting it
              READY to run tasks, and readiness is legible as documents.
              Amber = missing, emerald = present; click to read the document. */}
          {docs ? (
            <div className="hidden flex-wrap items-center gap-2 pb-2 sm:flex">
              {docs.docs.map((d) => (
                <DocPill key={d.name} doc={d} onOpen={() => setOpenDoc(d.name)} />
              ))}
            </div>
          ) : null}
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
          <div
            className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4"
            style={{ paddingBottom: composerHeight + 16 }}
          >
            {messages.length === 0 ? (
              <ChatEmptyState
                docs={docs}
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
                <SystemMessage key={index} reply={message.reply} onOpenTask={setOpenTask} />
              ),
            )}
            {busy ? <ThinkingBubble /> : null}
            <div ref={endRef} />
          </div>
        </div>

        {/* Only shown once there's somewhere to jump TO — a conversation that
            already fits on screen has no "end" worth a button for. The bottom
            offset matches the fixed composer's height plus breathing room, or
            the button would sit behind the input. */}
        {!atBottom && messages.length > 0 ? (
          <button
            type="button"
            aria-label="Jump to latest message"
            onClick={jumpToBottom}
            style={{ bottom: composerHeight + 16 }}
            className="absolute left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-colors hover:bg-accent"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* position:fixed against the window — the composer must stay visible
          no matter how the AgentOS shell scrolls or offsets this page; the
          chat region above compensates with measured padding (above), so no
          content ever hides behind it. */}
      <div
        ref={composerRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border/70 bg-background/95 px-6 pt-3 backdrop-blur-xl"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {pendingConfirm ? (
            <div className="pb-2">
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
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(text);
            }}
          >
            <div className="flex items-end gap-2 rounded-[24px] border border-border bg-card px-3 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
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
      </div>

      {openDoc && projectId && docs ? (
        <DocModal
          projectId={projectId}
          name={openDoc}
          template={docs.template}
          createAction={
            // The bootstrap action offered in the chat empty state is offered
            // again where a missing document is actually discovered — the
            // modal the readiness pill opens. Same text, same behavior, and
            // the same ordering rule: tasks derive from plans, so "Create
            // tasks" exists only once docs/plans.md is there.
            openDoc === "plans"
              ? { label: "Create plans", text: createPlansText(docs) }
              : openDoc === "tasks" && docs.docs.find((d) => d.name === "plans")?.exists === true
                ? { label: "Create tasks", text: createTasksText(docs) }
                : null
          }
          footerAction={
            // Registration only makes sense once the document exists — the
            // modal's own fetched existence gates it (see DocModal).
            openDoc === "tasks" ? { label: "Register tasks", text: REGISTER_TASKS_TEXT } : null
          }
          missingNote={
            openDoc === "tasks" && docs.docs.find((d) => d.name === "plans")?.exists !== true
              ? "Tasks are created from the implementation plan — “Create tasks” appears once docs/plans.md exists."
              : null
          }
          onCreateAction={(value) => {
            // Mirrors the chat quick-prompt pills exactly: fill the composer
            // (never auto-send), then close the modal and land the cursor in
            // the input so the operator can adjust before sending. The
            // textarea is always mounted, so focusing synchronously is safe
            // even though the modal unmounts in the same update.
            setText(value);
            setOpenDoc(null);
            textareaRef.current?.focus();
          }}
          onClose={() => setOpenDoc(null)}
        />
      ) : null}

      {openTask ? (
        <TaskDialog
          taskId={openTask}
          models={models}
          onClose={() => setOpenTask(null)}
          // The conversation has no task list of its own to refresh — the
          // dialog's own reload keeps its content current.
          onChanged={() => {}}
        />
      ) : null}
    </div>
  );
}

/**
 * Readiness pill — amber dot for a missing document, emerald for a present
 * one. Label is the filename stem only (no directory, no extension): the
 * directory is an implementation detail the operator shouldn't have to
 * remember. Clicking opens the document read-only.
 */
function DocPill({ doc, onOpen }: { doc: ProjectDocStatus; onOpen: () => void }) {
  const border = doc.exists
    ? "border-[hsl(var(--status-success)/0.28)]"
    : "border-[hsl(var(--status-warning)/0.30)]";
  const dot = doc.exists ? "bg-emerald-400" : "bg-amber-300";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={doc.exists ? `Open ${doc.dir}/${doc.name}.md` : `${doc.dir}/${doc.name}.md does not exist yet`}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-card/75 px-2.5 py-1 text-[0.66rem] font-semibold text-foreground shadow-sm ${border} transition-colors hover:bg-card`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{doc.name}</span>
    </button>
  );
}

/**
 * Read-only document viewer. Width is at least 60% of the window so a real
 * planning document doesn't cramp into a dialog-sized column, and the
 * markdown is rendered (headings, lists, task checkboxes, code, emphasis) —
 * showing raw `#`/`**` syntax for a document whose whole value is its
 * structure would defeat the purpose of reading it here.
 *
 * A missing plans/tasks document gets the same bootstrap button the chat
 * empty state offers (`createAction`); the modal's OWN fetched existence is
 * what gates it, not the readiness pills' possibly stale status. When the
 * action is withheld by the plans-before-tasks rule, `missingNote` says so
 * instead of leaving an unexplained gap.
 */
function DocModal({
  projectId,
  name,
  template,
  createAction,
  footerAction,
  missingNote,
  onCreateAction,
  onClose,
}: {
  projectId: string;
  name: string;
  template: string;
  createAction?: { label: string; text: string } | null;
  footerAction?: { label: string; text: string } | null;
  missingNote?: string | null;
  onCreateAction?: (text: string) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    semanggi
      .projectDoc(projectId, name)
      .then((d) => {
        if (cancelled) return;
        setExists(d.exists);
        setContent(d.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, name]);

  return (
    <Modal title={`${name}.md — ${template}`} onClose={onClose} width="min-w-[60vw] max-w-[90vw]">
      {error ? <LoadError error={error} /> : null}
      {exists === null && !error ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
      ) : exists === false ? (
        <div className="space-y-3">
          <Empty>{`memory or docs file for “${name}” does not exist yet.`}</Empty>
          {createAction && onCreateAction ? (
            <div className="flex justify-center">
              <Button onClick={() => onCreateAction(createAction.text)}>{createAction.label}</Button>
            </div>
          ) : missingNote ? (
            <p className="text-center text-xs text-muted-foreground">{missingNote}</p>
          ) : null}
        </div>
      ) : content !== null ? (
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <MarkdownView content={content} />
        </div>
      ) : null}
      {footerAction && onCreateAction && exists === true ? (
        <div className="mt-3 flex justify-end border-t border-border pt-3">
          <Button variant="outline" onClick={() => onCreateAction(footerAction.text)}>
            {footerAction.label}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Minimal markdown renderer — headings, lists (including the `- [ ]` task
 * checkboxes plans.md is specified to use), fenced code, blockquotes, rules,
 * and inline emphasis/code/links. Hand-rolled because the fork must not gain
 * an npm dependency for one read-only view, and because the documents this
 * renders are the repo's own planning docs whose constructs this covers.
 */
function MarkdownView({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let key = 0;

  const renderInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let k = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const token = match[0];
      if (token.startsWith("**")) parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
      else if (token.startsWith("`")) parts.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{token.slice(1, -1)}</code>);
      else if (token.startsWith("[")) {
        const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
        parts.push(
          <a key={k++} href={m?.[2] ?? "#"} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {m?.[1] ?? token}
          </a>,
        );
      } else parts.push(<em key={k++}>{token.slice(1, -1)}</em>);
      last = match.index + token.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-[0.8em] leading-relaxed">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      // GFM table: header row, dashed separator, body rows. plans.md dan
      // breakdown dokumen lain memakainya — merender garis pipi mentah di
      // viewer yang seharusnya memformat markdown akan mengalahkan tujuan
      // viewer itu sendiri.
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = splitRow(lines[i]);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        body.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50">
              <tr>
                {header.map((cell, ci) => (
                  <th key={ci} className="px-2 py-1 font-medium">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-t border-border/60">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1">
                      {renderInline(cell)}
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
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const size = ["text-lg", "text-base", "text-sm", "text-sm"][heading[1].length - 1];
      blocks.push(
        <p key={key++} className={`${size} font-semibold pt-1`}>
          {renderInline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-border/60" />);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-border pl-2 text-muted-foreground">
          {renderInline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }
    const task = line.match(/^\s*- \[( |x|X)\]\s+(.*)$/);
    if (task) {
      blocks.push(
        <div key={key++} className="flex items-start gap-1.5">
          <span className={task[1] === " " ? "text-muted-foreground" : "text-emerald-500"}>
            {task[1] === " " ? "☐" : "☑"}
          </span>
          <span className={task[1] !== " " ? "text-muted-foreground line-through" : ""}>{renderInline(task[2])}</span>
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(
        <div key={key++} className="flex items-start gap-1.5">
          <span className="text-muted-foreground">•</span>
          <span>{renderInline(line.replace(/^\s*[-*]\s+/, ""))}</span>
        </div>,
      );
      i++;
      continue;
    }
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (ordered) {
      blocks.push(
        <div key={key++} className="flex items-start gap-1.5">
          <span className="text-muted-foreground">{ordered[1]}.</span>
          <span>{renderInline(ordered[2])}</span>
        </div>,
      );
      i++;
      continue;
    }
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-1.5" />);
      i++;
      continue;
    }
    blocks.push(<p key={key++} className="leading-relaxed">{renderInline(line)}</p>);
    i++;
  }
  return <div className="space-y-1 text-sm">{blocks}</div>;
}

/**
 * The exact WORK prompts behind the "Create plans" / "Create tasks" actions.
 * Module-level (and docs-driven) so the chat empty state and the document
 * modal share ONE text each — two copies would silently diverge, the exact
 * failure mode this page's header warns against.
 */
function createPlansText(docs: ProjectDocs | null): string {
  const hasDoc = (name: string) => docs?.docs.some((d) => d.name === name);
  const extraDocs = (docs?.docs ?? [])
    .filter((d) => d.exists && !["blueprint", "decisions", "architecture", "brief", "plans", "tasks"].includes(d.name))
    .map((d) => `docs/${d.name}.md`);
  const list = [
    "memory/blueprint.md",
    "memory/decisions.md",
    ...(hasDoc("architecture") ? ["docs/architecture.md"] : []),
    "docs/brief.md",
    ...extraDocs,
  ];
  const tail = list.length > 2 ? `, dan ${list[list.length - 1]}` : "";
  return (
    `/prepare Baca semua dokumen di ${list.slice(0, -1).join(", ")}${tail} (jika ada). Berdasarkan dokumen-dokumen tersebut, buat rencana implementasi yang berisi:\n` +
    `1. Daftar task implementasi yang harus dikerjakan, diurutkan berdasarkan dependensi\n` +
    `2. Untuk setiap task: judul, deskripsi singkat, role yang mengerjakan, temporary ID, dan task mana yang harus selesai lebih dulu (menggunakan temprary ID)\n` +
    `3. Estimasi kompleksitas (simple/medium/complex) dan level effort pengerjaan (low/normal/critical) per task\n\n` +
    `Tulis hasilnya ke docs/plans.md.`
  );
}

function createTasksText(docs: ProjectDocs | null): string {
  const hasDoc = (name: string) => docs?.docs.some((d) => d.name === name);
  const sources = ["memory/blueprint.md", ...(hasDoc("architecture") ? ["docs/architecture.md"] : []), "docs/plans.md"];
  return (
    `/prepare Baca ${sources.join(", ")}.\n` +
    `Analisis dokumen-dokumen tersebut dan buat daftar task implementasi yang terstruktur dalam format checklist di docs/tasks.md. \n` +
    `Untuk setiap task, sebutkan: judul, deskripsi, role yang mengerjakan, temporary ID, task mana yang harus selesai lebih dulu (dependensi menggunakan temprary ID), estimasi kompleksitas (simple/medium/complex) dan level effort pengerjaan (low/normal/critical).\n\n` +
    `Jika docs/plans.md tidak ada jangan lanjutkan proses.`
  );
}

/**
 * Empty-state card shown before the first message — mirrors Mission
 * Control's own Chat panel welcome card (icon badge, heading, description,
 * pill-shaped quick prompts) rather than the plain caption this page used to
 * show. Picking a pill REPLACES the composer text and focuses it; it never
 * sends on its own, since a bare "status " with no task id isn't a real
 * command.
 *
 * "Create plans" / "Create tasks" appear only while the corresponding
 * document is missing — they exist to bootstrap the readiness checklist, and
 * lingering after the file exists would invite overwriting it by accident.
 * The two are also mutually exclusive: tasks are derived FROM plans, so
 * "Create tasks" is offered only once docs/plans.md exists, and while plans
 * is missing only "Create plans" is shown — a task list built before any
 * plan exists would be guesswork (the tasks prompt itself refuses to run
 * without docs/plans.md).
 */
function ChatEmptyState({ docs, onPick }: { docs: ProjectDocs | null; onPick: (text: string) => void }) {
  const docStatus = (name: string) => docs?.docs.find((d) => d.name === name);
  const plansDoc = docStatus("plans");
  const tasksDoc = docStatus("tasks");
  const plansMissing = plansDoc ? plansDoc.exists === false : false;
  const tasksMissing = tasksDoc ? tasksDoc.exists === false : false;

  const prompts: Array<{ label: string; text: string }> = [
    ...(plansMissing ? [{ label: "Create plans", text: createPlansText(docs) }] : []),
    ...(tasksMissing && plansDoc?.exists === true ? [{ label: "Create tasks", text: createTasksText(docs) }] : []),
    // The mirror of the doc modal's Register button: offered only once
    // docs/tasks.md exists — registering requires a document to register.
    ...(tasksDoc?.exists === true ? [{ label: "Register tasks", text: REGISTER_TASKS_TEXT }] : []),
    { label: "/work", text: "/work " },
    { label: "/task", text: "/task " },
    { label: "Check a task", text: "/task status " },
    { label: "Stop a task", text: "/task stop " },
    { label: "Run a task", text: "/task run " },
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

function SystemMessage({ reply, onOpenTask }: { reply: ControlReply; onOpenTask: (taskId: string) => void }) {
  const tone =
    reply.intent === "CONFIRM"
      ? "warning"
      : (reply.intent === "WORK" || reply.intent === "PREPARE") && reply.created
        ? "success"
        : "neutral";
  const plan = reply.tasks.length > 0 ? reply.tasks : (reply.plan ?? []);
  // Replies attribute the UI surface as "_(agentos-ui)_" — the plumbing's own
  // name (§8.4's shared-token label). What the operator should read is the
  // surface, not the plumbing.
  const displayReply = reply.reply.replace(/_\(agentos-ui\)_/g, "Semanggi");
  // A reply about a task IS the way in: clicking the region opens the same
  // detail dialog Summary uses, so the conversation and the board share one
  // reading space instead of two.
  const clickable = Boolean(reply.taskId);
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
      <div
        onClick={clickable ? () => onOpenTask(reply.taskId as string) : undefined}
        title={clickable ? `Open ${reply.taskId} detail` : undefined}
        className={`w-full max-w-[90%] space-y-2.5 rounded-[18px] border border-l-[3px] border-border bg-card px-3.5 py-3 ${accent} ${
          clickable ? "cursor-pointer transition-colors hover:border-primary/50" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <Badge tone={tone === "warning" ? "warning" : tone === "success" ? "success" : "info"}>{reply.intent}</Badge>
          {reply.action ? <Badge tone="neutral">{reply.action}</Badge> : null}
          {reply.taskId ? <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{reply.taskId}</code> : null}
        </div>
        <MarkdownView content={displayReply} />
        {reply.registered && reply.registered.length > 0 ? (
          <div className="space-y-1.5 pt-0.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Registered tasks</div>
            <div className="space-y-1">
              {reply.registered.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenTask(task.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">{task.localId}</code>
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  <Badge tone={task.status === "QUEUED" ? "info" : "neutral"}>{task.status}</Badge>
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
