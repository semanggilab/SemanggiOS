"use client";

// Halaman Control: satu kolom percakapan yang dirutekan menurut intent.
//
// APA YANG DILAKUKAN HALAMAN INI, DAN APA YANG TIDAK
//
// Ia mengirim teks dan menampilkan apa yang controller putuskan. Ia TIDAK
// mengklasifikasikan sendiri, tidak menebak project, dan tidak memutuskan
// apakah sesuatu destruktif — semua itu milik controller, dan menduplikasinya
// di sini akan menghasilkan dua permukaan yang menyimpang diam-diam begitu
// salah satunya diubah.
//
// TIGA JALUR YANG TERLIHAT BERBEDA, SENGAJA
//
//   CHAT     balasan biasa
//   TASK     perintah pada task yang sudah ada; verba destruktif menuntut
//            konfirmasi eksplisit, dan konfirmasinya menyebut apa yang berhenti
//   WORK     dipecah menjadi beberapa task; rencananya ditampilkan sebagai
//            daftar berurut, bukan sebagai paragraf
//
// CONFIRM bukan kegagalan. Ia adalah aturan §8.2 yang bekerja: klasifikasi yang
// tidak yakin menjadi pertanyaan, tidak pernah menjadi aksi.

import { useEffect, useRef, useState } from "react";
import { semanggi, type ControlReply, type PlanStep, type ProjectSummary } from "@/lib/semanggi/client";
import { Badge, Button, Card, LoadError, Notice, PageShell, Select } from "./ui";

type Message =
  | { kind: "operator"; text: string; at: number }
  | { kind: "system"; reply: ControlReply; at: number };

const TEMPLATES = ["software", "backend", "frontend", "research", "content"];
const PROFILES = ["balanced", "fast", "quality"];

export function ControlPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [template, setTemplate] = useState("software");
  const [profile, setProfile] = useState("balanced");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ text: string; target: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    semanggi
      .projectSummary()
      .then((s) => {
        setProjects(s.projects);
        setProjectId((current) => current || (s.projects[0]?.id ?? ""));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        template,
        profile,
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
    >
      {error ? <LoadError error={error} /> : null}

      <Card
        title="Context"
        subtitle="Determines where decomposed tasks are filed and how their levels are resolved."
      >
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Project</span>
            <Select value={projectId} onChange={setProjectId} className="min-w-[16rem]">
              {projects.length === 0 ? <option value="">(no projects)</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.id}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Template</span>
            <Select value={template} onChange={setTemplate}>
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Profile</span>
            <Select value={profile} onChange={setProfile}>
              {PROFILES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

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
        className="flex gap-2"
      >
        <textarea
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
          rows={3}
          placeholder="Example: build an ordering service with NestJS, with authentication and a product catalog"
          className="flex-1 resize-y rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button type="submit" disabled={busy || text.trim().length === 0}>
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
