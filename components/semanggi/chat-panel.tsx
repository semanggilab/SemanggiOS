"use client";

// POC-10 chat room pieces (spec §12.8) — sidebar, header ruang, dan gelembung
// transkrip. Semuanya komponen TAMPILAN: keputusan routing (chat vs router)
// tetap di ControlPage.send(), pengambilan transkrip dan polling tetap di
// sana juga — komponen ini tidak pernah memanggil API sendiri supaya "siapa
// yang memutuskan apa" tetap satu tempat (kepala control-page.tsx).

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Bot, FileText, LoaderCircle, MoreVertical, PanelLeftClose, Pencil, X } from "lucide-react";
import type { Brain, ChatMessage, ChatSession } from "@/lib/semanggi/client";
import { relativeTime } from "@/lib/semanggi/client";
import { Badge, CopyButton } from "./ui";
import { MarkdownView } from "./markdown";

/** Otak masih menyusun jawaban — dasar polling 10 detik (pola D74: poll
 *  berhenti saat tidak ada lagi pesan in-flight). */
export function chatMessageInFlight(status: string): boolean {
  return status === "PENDING" || status === "RUNNING";
}

/** Saran pembuka sesi — SEMUA harus lolos isChatEligible: bukan prefix "/",
 *  bukan verba task-scoped di awal, bukan sapaan (lihat intent.mjs). Kalimat
 *  TANYA adalah bentuk paling alami percakapan; daftar ini dijaga agar tetap
 *  begitu — satu pill yang tanpa sengaja diawali "status" akan dikirim ke
 *  router dan balasannya CONFIRM, bukan jawaban. */
export const CHAT_QUICK_PROMPTS: Array<{ label: string; text: string }> = [
  { label: "Project status", text: "What's the current status of this project?" },
  { label: "Recent activity", text: "Summarize what the agents have been doing recently." },
  { label: "Blockers", text: "Which tasks are blocked right now, and why?" },
  { label: "Next step", text: "What should I look at next in this project?" },
];

/**
 * Sidebar riwayat sesi — newest-first (urutan server, ORDER BY
 * last_active_at DESC). Klik baris membuka ruang; tombol arsip di tiap
 * baris, bukan di dalam ruang saja: sesi yang salah buka bisa disingkirkan
 * tanpa harus masuk ke dalamnya dulu.
 */
export function ChatSessionsSidebar({
  sessions,
  activeSessionId,
  onOpen,
  onNew,
  onArchiveToggle,
  onCollapse,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onArchiveToggle: (session: ChatSession) => void;
  /** Sembunyikan daftar jadi rail tipis — panggilan dari header sidebar,
   *  bukan ikon di tiap baris: collapse adalah keputusan tentang SEMUA
   *  sesi, bukan tentang satu sesi. */
  onCollapse: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sessions</span>
        <button
          type="button"
          aria-label="Collapse session list"
          title="Collapse the session list to a rail"
          onClick={onCollapse}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-semibold transition-colors hover:border-primary/50"
      >
        <Bot className="h-3.5 w-3.5" />
        New session
      </button>

      {sessions.length === 0 ? (
        <p className="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground">
          No chat sessions yet — free-form questions with a Brain of your choice.
        </p>
      ) : (
        <div className="space-y-1">
          {sessions.map((session) => {
            const archived = session.status === "ARCHIVED";
            const active = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 transition-colors ${
                  active ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent/60"
                } ${archived ? "opacity-55" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(session.id)}
                  title={session.title ?? `Session ${session.id}`}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-medium">
                    {session.title ?? "Untitled chat"}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {relativeTime(session.lastActiveAt)}
                    {archived ? " · archived" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={archived ? `Unarchive ${session.id}` : `Archive ${session.id}`}
                  title={archived ? "Unarchive this session" : "Archive this session"}
                  onClick={() => onArchiveToggle(session)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Menu "3 dot vertical" untuk sesi (pola D78 BrainRowActions): rename dan
 * arsip dikumpulkan di satu titik, karena lebar header sudah dipakai fakta
 * (judul, badge brain) — tombol teks tersebar membuat header sesi bengkak
 * sebelum transkrip mulai. Klik-luar dan Escape menutup tanpa memicu item
 * yang kebetulan diklik (mousedown, bukan click).
 */
function SessionMenu({
  archived,
  onRename,
  onArchiveToggle,
}: {
  archived: boolean;
  onRename: () => void;
  onArchiveToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const itemClass = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent";
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Session actions"
        title="Session actions"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-8 z-40 w-40 rounded-lg border border-border bg-background py-1 shadow-lg">
          <button
            type="button"
            className={itemClass}
            title="Rename this session"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Rename…
          </button>
          <button
            type="button"
            className={itemClass}
            title={archived ? "Unarchive this session" : "Archive this session"}
            onClick={() => {
              setOpen(false);
              onArchiveToggle();
            }}
          >
            {archived ? <ArchiveRestore className="h-3.5 w-3.5 shrink-0" /> : <Archive className="h-3.5 w-3.5 shrink-0" />}
            {archived ? "Unarchive" : "Archive"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Header ruang: identitas sesi + otak + menu + tutup. Brain adalah tombol —
 * itulah pintu picker dua tingkat (§7.4); ganti brain sesi aktif lewat situ
 * dan KONFIRMASI reset context (§10.2) dipegang pemanggil, bukan di sini.
 * Judul bisa diganti INLINE (menu Rename…): input menggantikan judul, Enter
 * menyimpan, Escape membuang — modal untuk satu field pendek hanya
 * memindahkan teks dua kali.
 */
export function ChatRoomHeader({
  session,
  brain,
  onPickBrain,
  onArchiveToggle,
  onRename,
  onClose,
}: {
  session: ChatSession;
  brain: Brain | null;
  onPickBrain: () => void;
  onArchiveToggle: () => void;
  onRename: (title: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const archived = session.status === "ARCHIVED";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const startRename = () => {
    setDraft(session.title ?? "");
    setEditing(true);
  };
  const commit = async () => {
    if (saving) return;
    const title = draft.trim();
    setEditing(false);
    if (!title || title === (session.title ?? "")) return;
    setSaving(true);
    try {
      await onRename(title);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-background/95 px-4 py-2 backdrop-blur">
      {editing ? (
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- dialog-less inline edit: the whole point is landing in the field
          autoFocus
          value={draft}
          disabled={saving}
          maxLength={200}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={() => void commit()}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={session.title ?? `Session ${session.id}`}>
          {session.title ?? "Untitled chat"}
        </span>
      )}
      {archived ? <Badge tone="warning">archived</Badge> : null}
      <button
        type="button"
        onClick={onPickBrain}
        title="Change this session's Brain (resets its conversation context)"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-primary/50"
      >
        <Bot className="h-3 w-3 text-muted-foreground" />
        {brain ? brain.name : "unknown brain"}
        {brain ? (
          <span className="text-muted-foreground">
            · {brain.provider}/{brain.model}
            {isFreeTierLabel(brain.quotaTier) ? " · free" : ""}
          </span>
        ) : null}
      </button>
      <SessionMenu archived={archived} onRename={startRename} onArchiveToggle={onArchiveToggle} />
      <button
        type="button"
        aria-label="Close session"
        title="Close this session (it stays in the sidebar)"
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function isFreeTierLabel(tier: string | null | undefined): boolean {
  return typeof tier === "string" && tier.toLowerCase().startsWith("free");
}

/** Satu gelembung transkrip. Operator: kanan, tinted — gaya yang sama dengan
 *  gelembung operator jalur router supaya satu bahasa visual. Brain: kiri,
 *  kartu dengan MarkdownView (jawaban panjang adalah niat utama percakapan)
 *  + status pengiriman yang jujur (PENDING/RUNNING → kerangka berdenyut,
 *  FAILED → error-nya ditulis, bukan disembunyikan). */
export function ChatMessageView({
  message,
  brain,
  onOpenFile,
}: {
  message: ChatMessage;
  brain: Brain | null;
  onOpenFile: (path: string) => void;
}) {
  if (message.role === "operator") {
    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[82%] space-y-1.5">
          {/* Salin pesan sendiri — operator memindai ulang prompt panjangnya
           * sebelum mengirim ulang ke brain lain; seleksi manual pada bubble
           * tinted selalu mungkin, tombol ini membuatnya satu klik.
           * Di KIRI bubble: kanan adalah tepi kolom transkrip. */}
          <CopyButton
            text={message.content}
            label="Copy message"
            className="absolute -left-8 top-1.5 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
          <div className="rounded-[20px] bg-primary/15 px-4 py-2.5 text-sm leading-relaxed text-foreground">
            {message.content}
          </div>
          {message.attachments && message.attachments.length > 0 ? (
            <AttachmentChips paths={message.attachments} onOpenFile={onOpenFile} />
          ) : null}
        </div>
      </div>
    );
  }

  const inFlight = chatMessageInFlight(message.status);
  const failed = message.status === "FAILED";
  return (
    <div className="flex justify-start">
      <div className="relative w-full max-w-[90%] space-y-2 rounded-[18px] border border-border bg-card px-3.5 py-3">
        {message.content ? (
          <CopyButton text={message.content} label="Copy reply source" className="absolute right-2 top-2 z-10 p-1" />
        ) : null}
        <div className="flex items-center gap-2 pr-8">
          <Badge tone={failed ? "danger" : "neutral"}>{brain ? brain.name : "brain"}</Badge>
          {inFlight ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              {message.status.toLowerCase()}
            </span>
          ) : null}
        </div>
        {message.content ? (
          <MarkdownView content={message.content} onOpenFile={onOpenFile} />
        ) : failed ? (
          <p className="text-xs text-red-600 dark:text-red-300">{message.error ?? "Delivery failed."}</p>
        ) : (
          <div className="flex w-full max-w-[70%] flex-col gap-1.5">
            <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-muted" style={{ animationDelay: "150ms" }} />
          </div>
        )}
        {message.attachments && message.attachments.length > 0 ? (
          <AttachmentChips paths={message.attachments} onOpenFile={onOpenFile} />
        ) : null}
      </div>
    </div>
  );
}

/** Chip lampiran transkrip — nama pendek, path penuh di title, klik membuka
 *  panel viewer (pola chip composer D76). */
function AttachmentChips({ paths, onOpenFile }: { paths: string[]; onOpenFile: (path: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          onClick={() => onOpenFile(path)}
          title={`Open ${path} in the viewer panel`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <FileText className="h-3 w-3" />
          {path.split("/").pop()}
        </button>
      ))}
    </div>
  );
}

/** Empty state ruang baru — pill pembuka (lihat CHAT_QUICK_PROMPTS). */
export function ChatRoomEmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <Bot className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Ask about this project's work</p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          Free-form questions, answered by this session's Brain with live task and project context — no task is created.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
        {CHAT_QUICK_PROMPTS.map((p) => (
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
