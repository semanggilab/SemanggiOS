"use client";

// Popup satu task: informasi, linimasa, persetujuan, komentar, dan kendali.
//
// SATU ATURAN YANG MENGIKAT DI SINI
//
// Setiap tombol yang menghentikan pekerjaan menyebut apa yang dihentikan
// sebelum melakukannya (§8.7). "Batalkan" bahkan menuntut nama task diketik,
// karena CANCELLED adalah jalan buntu di mesin state — tidak ada yang kembali
// dari sana — sementara "Hentikan" bisa dilanjutkan.

import { useCallback, useEffect, useState } from "react";
import {
  semanggi,
  relativeTime,
  type Approval,
  type CatalogModel,
  type Task,
  type TaskDetail,
  type WorkEvent,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Empty, Field, LoadError, Notice, Select, statusTone } from "./ui";

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

  // Escape menutup: dialog yang hanya bisa ditutup dengan tombol kecil di pojok
  // membuat orang mengklik di luar dan kehilangan komentar yang sedang ditulis.
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
              {task?.expedited ? <Badge tone="warning">didahulukan</Badge> : null}
              {task ? <Badge tone="neutral">{task.qualityClass}</Badge> : null}
              {task?.workspaceMode === "read" ? <Badge tone="info">baca</Badge> : null}
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold">{task?.title ?? "Memuat…"}</h2>
            {task?.waitReason ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{task.waitReason}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Tutup
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error ? <LoadError error={error} onRetry={load} /> : null}

          {pendingApprovals.length > 0 ? (
            <ApprovalPanel approvals={pendingApprovals} busy={busy} onDecide={(id, d, note) => act(() => semanggi.decide(id, d, note))} />
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
                ["info", "Informasi"],
                ["timeline", `Linimasa (${events.length})`],
                ["transcript", "Percakapan"],
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

          <Card title="Komentar">
            <div className="flex flex-col gap-2">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="Catatan untuk task ini — tersimpan di log append-only dan muncul di linimasa."
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
                  Kirim komentar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ApprovalPanel({
  approvals,
  busy,
  onDecide,
}: {
  approvals: Approval[];
  busy: boolean;
  onDecide: (id: string, decision: "APPROVE" | "REJECT", note?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Card title="Menunggu keputusan Anda" className="border-amber-500/40">
      <div className="space-y-3">
        {approvals.map((a) => (
          <div key={a.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge tone="warning">{a.level}</Badge>
              <span className="text-sm">{a.question}</span>
            </div>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Catatan (opsional, tersimpan bersama keputusan)"
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => onDecide(a.id, "APPROVE", note || undefined)}>
                Setujui
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => onDecide(a.id, "REJECT", note || undefined)}>
                Tolak
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
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
    <Card title="Kendali">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !held} title={held ? "" : "Hanya task tertahan yang bisa dilepas"} onClick={() => act(() => semanggi.start(task.id))}>
            Mulai
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished}
            title={live ? "Menghentikan run yang sedang berjalan" : "Memarkir task supaya rencananya bisa diubah"}
            onClick={() => act(() => semanggi.stop(task.id, "dihentikan lewat halaman Summary"))}
          >
            Hentikan
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished}
            title="Menaikkan prioritas sementara; pulih sendiri setelah 30 menit"
            onClick={() => act(() => semanggi.expedite(task.id, 30 * 60_000))}
          >
            Paksa jalan (30 menit)
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !finished} onClick={() => act(() => semanggi.rerun(task.id, "FRESH"))}>
            Jalankan ulang
          </Button>
        </div>

        {/* Mengubah model saat berjalan tidak berpengaruh pada run yang sedang
            berlangsung — ia berlaku pada dispatch berikutnya. Menyebutkannya di
            sini lebih murah daripada membiarkan operator menyimpulkan sendiri
            dari hasil yang tidak berubah. */}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Brain / model" hint={live ? "Berlaku pada dispatch berikutnya, bukan pada run yang sedang berjalan." : undefined}>
            <Select value={model} onChange={onModel} disabled={busy} className="min-w-[16rem]">
              <option value="">(ikuti rute kategori/level)</option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} — {m.provider}/{m.model}
                  {m.effort ? ` @${m.effort}` : ""}
                  {m.effortMode === "preference" ? " (effort tidak aktif)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => semanggi.setModel(task.id, model ? [model] : []))}>
            Simpan model
          </Button>
        </div>

        {!finished ? (
          <details className="rounded-md border border-red-500/30 p-2">
            <summary className="cursor-pointer text-xs font-medium text-red-600 dark:text-red-300">Batalkan task</summary>
            <div className="mt-2 space-y-2">
              <Notice tone="danger">
                CANCELLED adalah jalan buntu — tidak ada revisi yang bisa mengikutinya. Untuk berhenti sementara, pakai
                &ldquo;Hentikan&rdquo;.
              </Notice>
              <input
                value={confirmCancel}
                onChange={(event) => onConfirmCancel(event.target.value)}
                placeholder={`Ketik ${task.id} untuk mengonfirmasi`}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="danger"
                disabled={busy || confirmCancel.trim().toUpperCase() !== task.id.toUpperCase()}
                onClick={() => act(() => semanggi.cancel(task.id, "dibatalkan lewat halaman Summary"))}
              >
                Batalkan permanen
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
  const rows: Array<[string, string]> = [
    ["Project", task.projectId],
    ["Prioritas", `${task.priority} (efektif ${task.effectivePriority})`],
    ["Kelas kualitas", task.qualityClass],
    ["Worker", task.workerId ?? "—"],
    ["Workspace", task.workspacePath ?? "(milik project)"],
    ["Mode workspace", task.workspaceMode],
    ["Kebijakan sesi", task.sessionPolicy],
    ["Model policy", JSON.stringify(task.modelPolicy)],
    ["Dibuat", relativeTime(task.createdAt)],
    ["Diperbarui", relativeTime(task.updatedAt)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1 text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="truncate text-right font-mono">{v}</span>
          </div>
        ))}
      </div>

      {dependencies.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-medium">Menunggu</div>
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
        <div className="mb-1 text-xs font-medium">Eksekusi</div>
        {executions.length === 0 ? (
          <Empty>Belum pernah dijalankan.</Empty>
        ) : (
          <div className="space-y-1">
            {executions.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs">
                <span className="font-mono">#{e.revisionNo}</span>
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                <span className="font-mono">{e.model ?? "—"}</span>
                <span className="text-muted-foreground">{e.tokensBillable.toLocaleString("id-ID")} token</span>
                <span className="text-muted-foreground">{relativeTime(e.endedAt ?? e.startedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium">Instruksi</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{task.description}</pre>
      </details>
    </div>
  );
}

function Timeline({ events }: { events: WorkEvent[] }) {
  if (events.length === 0) return <Empty>Belum ada kejadian tercatat.</Empty>;
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
  if (turns.length === 0) return <Empty>Belum ada percakapan yang terekam.</Empty>;
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
