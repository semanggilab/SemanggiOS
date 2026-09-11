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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Bot, FileText, LoaderCircle, PanelLeftOpen, Paperclip, SendHorizontal, X } from "lucide-react";
import {
  semanggi,
  type Brain,
  type CatalogModel,
  type ChatMessage,
  type ChatSession,
  type ControlReply,
  type PlanStep,
  type ProjectDocStatus,
  type ProjectDocs,
  type ProjectSummary,
  type Task,
  type TranscriptTurn,
  type WorkspaceFile,
} from "@/lib/semanggi/client";
import { Badge, Button, CopyButton, Empty, LoadError, Modal, Notice, Select } from "./ui";
import { MarkdownView } from "./markdown";
import { useViewer, viewerWidthPct } from "./viewer-context";
import { TaskDialog } from "./task-dialog";
import { ChatMessageView, ChatRoomEmptyState, ChatRoomHeader, ChatSessionsSidebar, chatMessageInFlight } from "./chat-panel";
import { BrainPickerModal } from "./brain-picker";

type Message =
  | { kind: "operator"; text: string; at: number }
  | { kind: "system"; reply: ControlReply; at: number };

const MIN_ROWS = 1;
const MAX_TEXTAREA_PX = 200;

/** Polling transkrip chat (pola D74): 10 detik, dan hanya selama ada pesan
 *  brain yang masih PENDING/RUNNING — poll pada transkrip diam adalah
 *  permintaan yang jawabannya tidak akan berubah. */
const CHAT_POLL_MS = 10_000;

// --- lampiran operator: teks saja (D77) ---------------------------------------
//
// Daftar ini MENGACU kosakata server (UPLOAD_TEXT_EXTS di
// domain/workspace-files.mjs), bukan menyalinnya bebas: server tetap pemilik
// aturannya, daftar ini hanya menolak lebih awal supaya operator tidak
// menunggu satu round-trip untuk dibilang tidak. Selisih daftar menurunkan
// dirinya menjadi UX kasar, bukan celah keamanan — pemeriksaan isi (endusan
// NUL) tetap di server.
const TEXT_UPLOAD_EXTS = [
  ".md", ".markdown", ".mdx", ".txt", ".text", ".log",
  ".json", ".jsonl", ".ndjson", ".csv", ".tsv",
  ".yml", ".yaml", ".toml", ".ini", ".conf", ".cfg",
  ".xml", ".html", ".htm", ".css", ".scss", ".less",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".php",
  ".sh", ".bash", ".zsh", ".sql", ".graphql", ".svg",
] as const;

const TEXT_UPLOAD_ACCEPT = TEXT_UPLOAD_EXTS.join(",");

function isTextUploadName(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_UPLOAD_EXTS.some((ext) => lower.endsWith(ext));
}

/** Satu lampiran yang menunggu di composer: diunggah ke staging, rujukan
 *  @tmp/uploads/… sudah tersisip ke teks, chip-nya menunggu dikirim. */
type Attachment = { name: string; path: string };

// SATU template bersama: tombol "Register tasks" di modal dokumen dan pill
// quick-prompt di empty state harus menyisipkan teks yang sama persis — dua
// salinan akan menyimpang sendiri. "langsung jalankan" dieja benar karena
// frasa itulah yang dideteksi controller untuk memutuskan CREATED vs QUEUED.
const REGISTER_TASKS_TEXT = "/prepare daftarkan semua tasks yang ada di docs/tasks.md dan langsung jalankan";

// Saran command saat operator mengetik "/" — daftar ini MENIRU kosakata
// prefix yang diterima classifier (INTENT_PREFIX di intent.mjs), bukan
// kosakata baru: bila router menambah prefix, daftar ini ikut, atau saran
// akan menawarkan command yang tidak jalan. Muncul hanya sebelum spasi
// pertama ("/pr" menyaring, "/prepare " sudah terlanjur lengkap dan
// menyembunyikan saran agar tidak menutupi percakapan).
const SLASH_COMMANDS: Array<{ prefix: string; hint: string }> = [
  { prefix: "/prepare", hint: "one analyst task → docs/plans.md + docs/tasks.md" },
  { prefix: "/work", hint: "new work, decomposed into phased tasks" },
  { prefix: "/task", hint: "command on existing tasks (status/run/cancel/…)" },
  { prefix: "/doc", hint: "review or revise a document — @file picks it, the verb picks the role" },
];

// --- pelengkapan otomatis di composer (D73) ----------------------------------
//
// Tiga token, satu mesin. Mengetik "/" menawarkan command, "TASK-" atau "#"
// menawarkan task id, "@" menawarkan berkas workspace — dan ketiganya memakai
// daftar, tombol, dan tombol panah yang SAMA. Tiga implementasi terpisah akan
// menyimpang pada perilaku kecil (Escape, Tab, urutan) dan hanya satu di
// antaranya yang akan diperbaiki saat ada yang salah.
//
// Polanya diuji terhadap teks SEBELUM kursor, bukan terhadap seluruh isi:
// operator yang kembali ke tengah kalimat untuk menambahkan sebuah id tidak
// sedang mengetik di ujung, dan saran yang hanya muncul di ujung akan diam
// justru saat ia paling dibutuhkan.
const TOKEN_PATTERNS = {
  // Tetap dibatasi ke AWAL pesan: "/task" adalah deklarasi intent, dan router
  // hanya membacanya di posisi itu (INTENT_PREFIX). Menawarkannya di tengah
  // kalimat berarti menawarkan sesuatu yang tidak akan berlaku.
  slash: /^(\/\w*)$/,
  task: /(^|\s)((?:#|TASK-)[A-Za-z0-9]*)$/i,
  file: /(^|\s)(@[A-Za-z0-9._\-/]*)$/,
} as const;

type TokenKind = keyof typeof TOKEN_PATTERNS;
type Suggestion = { value: string; label: string; hint?: string };

/** Token yang sedang diketik tepat sebelum kursor, kalau ada. */
function activeToken(text: string, caret: number): { kind: TokenKind; token: string; start: number } | null {
  const before = text.slice(0, caret);
  for (const kind of ["slash", "task", "file"] as TokenKind[]) {
    const m = TOKEN_PATTERNS[kind].exec(before);
    if (m) {
      const token = m[kind === "slash" ? 1 : 2];
      return { kind, token, start: before.length - token.length };
    }
  }
  return null;
}

export function ControlPage({
  activeWorkspacePath,
  onProjectChange,
}: {
  activeWorkspacePath?: string | null;
  /** Panel viewer hidup di luar `<main>` dan tidak bisa membaca dropdown
   *  "Active Project" halaman ini — ia diberi tahu lewat callback ini. */
  onProjectChange?: (projectId: string) => void;
}) {
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

  // Pelengkapan otomatis: satu daftar untuk tiga token (lihat TOKEN_PATTERNS).
  // `dismissed` membuat Escape menutup daftar tanpa ia muncul lagi pada
  // ketikan berikutnya — dan reset begitu token berubah menjadi token lain.
  const [caret, setCaret] = useState(0);
  const [pickIndex, setPickIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const viewer = useViewer();

  const token = activeToken(text, caret);
  const dismissedHere = token !== null && dismissed === `${token.kind}:${token.token}`;

  // Kandidat per jenis token. Untuk task dan berkas, penyaringannya di sisi
  // klien atas daftar yang sudah diambil sekali per project — sebuah
  // permintaan jaringan per ketikan akan membuat daftar berkedip dan
  // menampilkan hasil yang tertinggal satu huruf di belakang.
  const suggestions: Suggestion[] = (() => {
    if (!token || dismissedHere) return [];
    if (token.kind === "slash") {
      const q = token.token.toLowerCase();
      return SLASH_COMMANDS.filter((c) => c.prefix.startsWith(q)).map((c) => ({
        value: c.prefix,
        label: c.prefix,
        hint: c.hint,
      }));
    }
    if (token.kind === "task") {
      // "#4F59" dan "TASK-4F59" mencari hal yang sama — router menormalkan
      // keduanya ke satu bentuk (normalizeTaskIds), jadi daftar ini juga.
      const q = token.token.replace(/^#/, "").replace(/^TASK-/i, "").toLowerCase();
      return tasks
        .filter((t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((t) => ({ value: t.id, label: t.id, hint: `${t.status} · ${t.title}` }));
    }
    const q = token.token.slice(1).toLowerCase();
    return files
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 8)
      .map((f) => ({ value: `@${f.path}`, label: f.path, hint: f.editable ? "markdown" : "read-only" }));
  })();
  const listOpen = suggestions.length > 0;

  // --- POC-10 chat room (spec §12.8) ---------------------------------------
  //
  // Semua keputusan tetap di halaman ini (kepala berkas): komponen
  // chat-panel hanya menampilkan. `openChat` adalah salinan transkrip hasil
  // poll; `roomSession` sesi yang sedang dibuka — SESI TERBUKA TIDAK IKUT
  // PINDAH saat Active Project berganti (§7.3): guard projectId di server
  // akan menolak pesan, dan UI menunjukkan itu sebagai notice + routing
  // jatuh kembali ke router, bukan menutup ruang diam-diam.
  const [chatBrains, setChatBrains] = useState<Brain[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [openChat, setOpenChat] = useState<{ session: ChatSession; messages: ChatMessage[] } | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatUploading, setChatUploading] = useState(false);
  const [chatUploadError, setChatUploadError] = useState<string | null>(null);
  const [chatAttachments, setChatAttachments] = useState<Attachment[]>([]);
  // Dipakai untuk memaksa poll segera (setelah kirim/arsip/ganti brain);
  // poll yang berjalan tidak di-restart oleh state transkripnya sendiri.
  const [chatPollTick, setChatPollTick] = useState(0);
  const [pickerMode, setPickerMode] = useState<null | "new" | "switch">(null);
  const [brainSwitchTarget, setBrainSwitchTarget] = useState<Brain | null>(null);
  // Sidebar sesi bisa dilipat jadi rail tipis: transkrip yang sedang dibaca
  // adalah alasan halaman ini dibuka, dan pada layar sempit daftar sesi
  // mencuri lebar kolom percakapan. Tanpa persistence — keadaan pilihan
  // tampilan segar per kunjungan sudah cukup (pola yang sama dengan lebar
  // viewer yang juga tidak di-persist).
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  // Router reply saat ruang terbuka tetap masuk riwayat router (`messages`),
  // tapi yang DIRENDER di ruang hanyalah yang lahir setelah ruang dibuka —
  // dua jendela waktu, satu sumber data.
  const roomOpenedAt = useRef(0);

  const roomSession = openChat?.session ?? null;
  const roomBrain = roomSession ? (chatBrains.find((b) => b.id === roomSession.brainId) ?? null) : null;
  const roomProjectMatches = roomSession !== null && roomSession.projectId === projectId;
  // Syarat routing chat: ruang terbuka, AKTIF, dan milik project aktif.
  // Selain itu composer berperilaku persis seperti sebelum POC-10.
  const chatRoomUsable = roomSession !== null && roomSession.status === "ACTIVE" && roomProjectMatches;

  useEffect(() => {
    // Satu kali per muat halaman: daftar untuk picker + pelabelan bubble.
    // Kegagalannya menurunkan picker menjadi nama kosong — bukan alasan
    // membannner seluruh halaman.
    semanggi
      .brains()
      .then((r) => setChatBrains(r.brains))
      .catch(() => {});
  }, []);

  const refreshChatSessions = useCallback(() => {
    if (!projectId) return;
    semanggi
      .listChatSessions(projectId)
      .then((r) => setChatSessions(r.sessions))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setChatSessions([]);
      return;
    }
    refreshChatSessions();
  }, [projectId, refreshChatSessions]);

  // Ambil + poll transkrip ruang terbuka. Poll HANYAH dilanjutkan selama ada
  // pesan brain in-flight; berhenti total pada transkrip diam, dan
  // chatPollTick memulai ulang seketika setiap ada aksi (kirim pesan, arsip,
  // ganti brain) — pola yang sama dengan DocTaskLive.
  useEffect(() => {
    if (!chatSessionId) {
      setOpenChat(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const r = await semanggi.chatSession(chatSessionId);
        if (cancelled) return;
        setOpenChat(r);
        setChatError(null);
        const moving = r.messages.some((m) => m.role === "brain" && chatMessageInFlight(m.status));
        if (!moving) return;
      } catch (err) {
        if (cancelled) return;
        setChatError(err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) timer = setTimeout(poll, CHAT_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [chatSessionId, chatPollTick]);

  const openRoom = useCallback((id: string) => {
    setChatSessionId(id);
    roomOpenedAt.current = Date.now();
    setChatAttachments([]);
    setChatError(null);
    setChatUploadError(null);
  }, []);

  const closeRoom = useCallback(() => setChatSessionId(null), []);

  // Rename judul sesi (PATCH sudah lama menerima title — UI-nya yang belum).
  // Transkrip ruang ikut di-refresh karena presentasi sesi (judul) hidup di
  // dua tempat: header ruang dan baris sidebar.
  const renameSession = useCallback(
    async (session: ChatSession, title: string) => {
      try {
        await semanggi.patchChatSession(session.id, { title });
        if (chatSessionId === session.id) setChatPollTick((t) => t + 1);
        refreshChatSessions();
      } catch (err) {
        setChatError(err instanceof Error ? err.message : String(err));
      }
    },
    [chatSessionId, refreshChatSessions],
  );

  const toggleArchive = useCallback(
    async (session: ChatSession) => {
      const next = session.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
      try {
        await semanggi.patchChatSession(session.id, { status: next });
        if (chatSessionId === session.id) setChatPollTick((t) => t + 1);
        refreshChatSessions();
      } catch (err) {
        setChatError(err instanceof Error ? err.message : String(err));
      }
    },
    [chatSessionId, refreshChatSessions],
  );

  // Jalur chat composer: operator bubble TIDAK di-append lokal — baris
  // operator adalah baris transkrip DONE di server, append lokal hanya akan
  // menduplikasinya saat poll berikutnya mendarat.
  const sendChat = async (value: string) => {
    const session = roomSession;
    if (!session) return;
    setChatBusy(true);
    setChatError(null);
    try {
      await semanggi.sendChatMessage(session.id, {
        text: value,
        projectId,
        attachments: chatAttachments.length > 0 ? chatAttachments.map((a) => a.path) : undefined,
      });
      setText("");
      setCaret(0);
      setChatAttachments([]);
      setChatPollTick((t) => t + 1);
      refreshChatSessions();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatBusy(false);
    }
  };

  // Unggahan ruang: akar chat/<id>/uploads (§7.5) — TIDAK ada token "@"
  // disisipkan ke teks; attachments dikirim sebagai daftar path dan server
  // yang menuliskannya ke prompt agen.
  const uploadChatFiles = async (list: FileList) => {
    const session = roomSession;
    if (!session) return;
    if (session.status !== "ACTIVE" || !roomProjectMatches) {
      setChatUploadError("Uploads need an active session on the active project.");
      return;
    }
    setChatUploading(true);
    setChatUploadError(null);
    const staged: Attachment[] = [];
    try {
      for (const file of Array.from(list)) {
        if (!isTextUploadName(file.name)) {
          setChatUploadError(`${file.name}: only text files can be attached (md, txt, json, csv, yml, …)`);
          continue;
        }
        try {
          const saved = await semanggi.uploadChatFile(session.id, file.name, file);
          staged.push({ name: file.name, path: saved.path });
        } catch (err) {
          setChatUploadError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      setChatUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    if (staged.length > 0) {
      setChatAttachments((prev) => [...prev, ...staged]);
      textareaRef.current?.focus();
    }
  };

  // Chip ruang hanya membuang dari PESAN yang disusun — berkasnya tidak punya
  // endpoint hapus (beda staging D77): yang yatim disapu penyapu TTL, dan
  // mengaku bisa menghapusnya akan menjanjikan hal yang tidak dilakukan.
  const removeChatAttachment = (attachment: Attachment) => {
    setChatAttachments((prev) => prev.filter((a) => a.path !== attachment.path));
  };

  const handlePickerSelect = async (brainId: string | null) => {
    const mode = pickerMode;
    setPickerMode(null);
    if (mode === "switch") {
      // No-op untuk brain yang sama (server pun begitu); beda brain → dialog
      // konfirmasi reset context (§10.2) sebelum menyentuh sesi.
      if (!roomSession || brainId === null || brainId === roomSession.brainId) return;
      setBrainSwitchTarget(chatBrains.find((b) => b.id === brainId) ?? null);
      return;
    }
    if (!projectId) return;
    setChatBusy(true);
    setChatError(null);
    try {
      const r = await semanggi.createChatSession({ projectId, brainId: brainId ?? undefined });
      refreshChatSessions();
      roomOpenedAt.current = Date.now();
      setChatSessionId(r.session.id);
      textareaRef.current?.focus();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatBusy(false);
    }
  };

  const confirmBrainSwitch = async () => {
    const session = roomSession;
    if (!session || !brainSwitchTarget) return;
    setChatBusy(true);
    try {
      await semanggi.switchChatBrain(session.id, brainSwitchTarget.id, true);
      setBrainSwitchTarget(null);
      setChatPollTick((t) => t + 1);
      refreshChatSessions();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatBusy(false);
    }
  };

  // Groom: pesan router yang lahir SETELAH ruang dibuka, untuk render
  // interleave di dalam ruang (lihat roomOpenedAt).
  const roomRouterMessages = openChat ? messages.filter((m) => m.at >= roomOpenedAt.current) : [];

  // Daftar task diambil saat token-nya PERTAMA kali muncul (task jarang lahir
  // menit ini juga), tetapi daftar BERKAS diambil SETIAP kali token "@" aktif:
  // deliverables/<task-id>/ lahir terus dari task yang selesai, dan daftar yang
  // di-cache sejak "@" pertama menunjukkan dunia kemarin (laporan operator:
  // "file hasil pengerjaan tidak muncul"). Satu permintaan per aktivasi token,
  // bukan per ketikan.
  useEffect(() => {
    if (!projectId || token?.kind !== "task" || tasks.length > 0) return;
    semanggi
      .tasks({ project: projectId })
      .then((r) => setTasks(r.tasks))
      .catch(() => {});
  }, [projectId, token?.kind, tasks.length]);

  useEffect(() => {
    if (!projectId || token?.kind !== "file") return;
    let cancelled = false;
    semanggi
      .workspaceFiles(projectId)
      .then((r) => {
        if (!cancelled) setFiles(r.files);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, token?.kind]);

  // Berganti project membuang keduanya: menawarkan task id dari project lain
  // menghasilkan perintah yang ditolak controller, dengan alasan yang tidak
  // akan terbaca sebagai "itu id project yang salah".
  useEffect(() => {
    setTasks([]);
    setFiles([]);
    if (projectId) onProjectChange?.(projectId);
  }, [projectId, onProjectChange]);

  useEffect(() => setPickIndex(0), [text, caret]);

  /** Mengganti token yang sedang diketik dengan pilihan, lalu satu spasi. */
  const applySuggestion = (value: string) => {
    if (!token) return;
    const next = `${text.slice(0, token.start)}${value} ${text.slice(caret)}`;
    const position = token.start + value.length + 1;
    setText(next);
    setDismissed(null);
    setPickIndex(0);
    // Kursor dikembalikan ke belakang sisipan, bukan ke ujung teks: sebuah
    // penyuntingan di tengah kalimat tidak boleh melempar kursor ke akhir.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(position, position);
      setCaret(position);
    });
  };

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
    // openChat ikut menjadi dep: di dalam ruang, pesan baru datang dari poll
    // transkrip, bukan dari `messages` jalur router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, openChat]);

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
    if (!value || busy || chatBusy) return;
    // Routing composer POC-10 (§3.1.1): ruang terbuka + project cocok + teks
    // LAYAK chat → endpoint chat. "Layak" dinilai SERVER lewat
    // /work/chat/eligible (aturan hidup di intent.mjs bersama tesnya) — UI
    // tidak menyalin kosakata verba/prefix, dua salinan pasti menyimpang.
    // Command ("/…", verba task) tetap ke router, termasuk jalur CONFIRM.
    if (!confirm && chatRoomUsable) {
      let eligible = false;
      try {
        eligible = (await semanggi.chatEligible(value)).eligible;
      } catch {
        // Gerbang tak terjangkau → jatuh ke jalur router: menahan pesan
        // hanya karena pemeriksaan routing gagal membuat chat terasa mati.
      }
      if (eligible) {
        await sendChat(value);
        return;
      }
    }
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
      if (!confirm) {
        setText("");
        setCaret(0);
        // Rujukan sudah terkirim — staging kini milik task yang mengadopsinya.
        // Chip yang tertinggal menautkan berkas yang tak dirujuk teks apa pun.
        setAttachments([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Lampiran operator (D76 staging, D77 adopsi per-task): unggah ke
  // tmp/uploads/, sisipkan rujukan @tmp/uploads/<nama> ke composer — rujukan
  // itulah yang dibaca agen. Begitu pesan menciptakan task, controller
  // menyalin berkasnya ke deliverables/<task-id>/tmp/uploads/ dan menulis
  // ulang rujukannya; preamble task menginstruksikan penghapusannya segera
  // setelah dimuat. Berurutan, bukan Promise.all: kegagalan satu berkas
  // dilaporkan per berkas dan berkas lain tetap terunggah.
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    // Ruang terbuka → akar sesi chat (§7.5); tanpa ruang → staging proyek
    // (D76/D77). Dua akar, dua umur: staging diadopsi task, chat disapu TTL.
    if (roomSession) {
      await uploadChatFiles(list);
      return;
    }
    if (!projectId) return;
    setUploading(true);
    setUploadError(null);
    const inserted: string[] = [];
    const staged: Attachment[] = [];
    try {
      for (const file of Array.from(list)) {
        // D77: hanya teks. Ditolak di sini supaya pesan galatnya menyebut
        // berkas yang bermasalah, bukan menunggu 400 dari server.
        if (!isTextUploadName(file.name)) {
          setUploadError(`${file.name}: only text files can be attached (md, txt, json, csv, yml, …)`);
          continue;
        }
        try {
          const saved = await semanggi.upload(projectId, file.name, file);
          inserted.push(`@${saved.path}`);
          staged.push({ name: file.name, path: saved.path });
        } catch (err) {
          setUploadError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    if (inserted.length > 0) {
      setAttachments((prev) => [...prev, ...staged]);
      setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ` : "") + inserted.join(" "));
      textareaRef.current?.focus();
    }
  };

  // Tombol "×" pada chip: hapus berkas STAGING di server (bukan sekadar
  // menyembunyikan chip — berkas yang ditinggalkan akan hidup sampai TTL
  // dan bisa dibaca task yang tidak dimaksudkan), lalu buang rujukannya dari
  // teks. Rujukan yang dibiarkan tanpa berkasnya adalah janji yang tidak
  // akan ditepati agen.
  const removeAttachment = async (attachment: Attachment) => {
    if (!projectId) return;
    try {
      await semanggi.deleteUpload(projectId, attachment.path);
    } catch (err) {
      setUploadError(`${attachment.name}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.path !== attachment.path));
    const token = `@${attachment.path}`;
    setText((prev) => prev.split(`${token} `).join("").split(token).join("").trimEnd());
  };

  // Staging tmp/uploads/ adalah per-proyek — chip dari proyek lama adalah
  // tautan ke berkas di workspace lain, dan "×"-nya akan menghapus di proyek
  // yang salah. TOKEN di teks ikut dibuang, bukan hanya chipnya: token proyek
  // lama adalah janji berkas yang tak pernah ada di proyek baru (adopsi akan
  // mencatatnya missing, lalu agen diberi instruksi membaca berkas yang tak
  // ada). Semua token @tmp/uploads/… disapu — token tanpa chip pun yatim di
  // proyek berikutnya. Galat unggah ikut dibersihkan: ia milik proyek itu juga.
  useEffect(() => {
    setText((prev) => prev.replace(/@tmp\/uploads\/\S+/g, "").replace(/[ \t]{2,}/g, " ").trimEnd());
    setAttachments([]);
    setUploadError(null);
    // Chip chat milik sesi — sesi TIDAK ikut pindah project (§7.3), tapi
    // lampiran yang menunggu di composer tidak boleh menyusup ke ruang yang
    // project-nya sudah lain.
    setChatAttachments([]);
    setChatUploadError(null);
  }, [projectId]);

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
                <DocPill
                  key={d.name}
                  doc={d}
                  onOpen={() => {
                    // Dokumen yang ADA dibuka di panel viewer di kanan (permintaan
                    // operator 2026-09-11: membaca sambil memandu percakapan,
                    // bukan dialog yang menutupi transkrip). Yang BELUM ada tetap
                    // ke modal DocModal — di sanalah tombol bootstrap
                    // "Create plans/tasks" hidup; panel viewer untuk berkas yang
                    // tidak ada hanya bisa berkata "tidak ada".
                    if (d.exists) viewer.open(`${d.dir}/${d.name}.md`);
                    else setOpenDoc(d.name);
                  }}
                />
              ))}
            </div>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Conversation, a command on an existing task, or new work to decompose — with a chat session open,
            free-form questions go to its Brain.
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
      {chatError ? (
        <div className="px-6 pt-3">
          <LoadError
            error={chatError}
            onRetry={roomSession ? () => setChatPollTick((t) => t + 1) : undefined}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar sesi chat (§12.8) — tersembunyi di bawah lg. Padding bawah
            setinggi composer yang fixed: tanpa itu sesi paling bawah bersembunyi
            di balik bilah input. Rail tipis saat dilipat: satu tombol expand —
            "New session" butuh picker penuh, jadi rail tidak menjanjikannya. */}
        <aside className="hidden shrink-0 flex-col border-r border-border/70 lg:flex">
          {chatSidebarCollapsed ? (
            <div className="flex flex-col items-center gap-1 px-1 py-3" style={{ paddingBottom: composerHeight }}>
              <button
                type="button"
                aria-label="Show session list"
                title="Show the session list"
                onClick={() => setChatSidebarCollapsed(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="w-64 overflow-y-auto" style={{ paddingBottom: composerHeight }}>
              <ChatSessionsSidebar
                sessions={chatSessions}
                activeSessionId={chatSessionId}
                onOpen={openRoom}
                onNew={() => setPickerMode("new")}
                onArchiveToggle={(session) => void toggleArchive(session)}
                onCollapse={() => setChatSidebarCollapsed(true)}
              />
            </div>
          )}
        </aside>

        {/* `relative` anchors the jump-to-bottom button to this scroll region
            specifically, not the page — so it stays put over the conversation
            regardless of where the composer or header end up. */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
            {roomSession ? (
              /* Sticky di dalam region scroll — identitas ruang ikut gulir
               * keluar pandangan justru saat transkrip panjang dibaca. */
              <div className="sticky top-0 z-10">
                <ChatRoomHeader
                  session={roomSession}
                  brain={roomBrain}
                  onPickBrain={() => setPickerMode("switch")}
                  onArchiveToggle={() => void toggleArchive(roomSession)}
                  onRename={(title) => renameSession(roomSession, title)}
                  onClose={closeRoom}
                />
              </div>
            ) : null}
            <div
              className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4"
              style={{ paddingBottom: composerHeight + 16 }}
            >
              {roomSession && openChat ? (
                <>
                  {!roomProjectMatches ? (
                    <Notice tone="warning">
                      {`This session belongs to project ${
                        projects.find((p) => p.id === roomSession.projectId)?.name ?? roomSession.projectId
                      } — switch the Active Project there to keep chatting in it. Commands still go to the router.`}
                    </Notice>
                  ) : null}
                  {roomSession.status === "ARCHIVED" ? (
                    <Notice tone="warning">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>This session is archived — unarchive it to send messages.</span>
                        <Button size="sm" variant="outline" onClick={() => void toggleArchive(roomSession)}>
                          Unarchive
                        </Button>
                      </div>
                    </Notice>
                  ) : null}
                  {openChat.messages.length === 0 && roomRouterMessages.length === 0 ? (
                    <ChatRoomEmptyState
                      onPick={(value) => {
                        setText(value);
                        setCaret(value.length);
                        textareaRef.current?.focus();
                      }}
                    />
                  ) : null}

                  {/* Transkrip server + balasan router yang lahir sejak ruang
                   * dibuka, interleave menurut waktu — command yang diketik di
                   * ruang tetap dijawab inline, tapi badge-nya menyatakan
                   * bahwa balasan itu milik riwayat router, bukan transkrip
                   * sesi yang tersimpan. */}
                  {[
                    ...openChat.messages.map((m) => ({
                      t: m.createdAt,
                      key: m.id,
                      node: <ChatMessageView message={m} brain={roomBrain} onOpenFile={viewer.open} />,
                    })),
                    ...roomRouterMessages.map((m, i) => ({
                      t: m.at,
                      key: `local-${m.at}-${i}`,
                      node:
                        m.kind === "operator" ? (
                          <div className="group flex justify-end">
                            <div className="relative max-w-[82%]">
                              <CopyButton
                                text={m.text}
                                label="Copy message"
                                className="absolute -left-8 top-1.5 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              />
                              <div className="rounded-[20px] bg-primary/15 px-4 py-2.5 text-sm leading-relaxed text-foreground">
                                {m.text}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                              Router — kept in the command history, not this transcript
                            </div>
                            <SystemMessage reply={m.reply} onOpenTask={setOpenTask} onOpenFile={viewer.open} />
                          </div>
                        ),
                    })),
                  ]
                    .sort((a, b) => a.t - b.t)
                    .map((item) => (
                      <div key={item.key}>{item.node}</div>
                    ))}
                </>
              ) : (
                <>
                  {messages.length === 0 ? (
                    <ChatEmptyState
                      docs={docs}
                      onPick={(value) => {
                        // Caret ikut dipindah ke ujung: token yang sedang diketik
                        // ditentukan oleh posisi kursor, jadi pill "/doc @" hanya
                        // memunculkan pencarian berkas kalau kursornya memang di
                        // belakang "@".
                        setText(value);
                        setCaret(value.length);
                        textareaRef.current?.focus();
                      }}
                    />
                  ) : null}

                  {messages.map((message, index) =>
                    message.kind === "operator" ? (
                      <div key={index} className="group flex justify-end">
                        {/* Tinted, not filled: a full `bg-primary` bubble reads as a
                      button and dominates the column; /15 keeps the operator's
                      own words visually secondary to the system's replies. */}
                        <div className="relative max-w-[82%]">
                          <CopyButton
                            text={message.text}
                            label="Copy message"
                            className="absolute -left-8 top-1.5 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          />
                          <div className="rounded-[20px] bg-primary/15 px-4 py-2.5 text-sm leading-relaxed text-foreground">
                            {message.text}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <SystemMessage key={index} reply={message.reply} onOpenTask={setOpenTask} onOpenFile={viewer.open} />
                    ),
                  )}
                </>
              )}
              {busy ? <ThinkingBubble /> : null}
              <div ref={endRef} />
            </div>
          </div>

          {/* Only shown once there's somewhere to jump TO — a conversation that
              already fits on screen has no "end" worth a button for. The bottom
              offset matches the fixed composer's height plus breathing room, or
              the button would sit behind the input. */}
          {!atBottom && (messages.length > 0 || (openChat?.messages.length ?? 0) > 0) ? (
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
      </div>

      {/* position:fixed against the window — the composer must stay visible
          no matter how the AgentOS shell scrolls or offsets this page; the
          chat region above compensates with measured padding (above), so no
          content ever hides behind it. */}
      <div
        ref={composerRef}
        className="fixed bottom-0 left-0 z-20 border-t border-border/70 bg-background/95 px-6 pt-3 backdrop-blur-xl"
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          // Composer ber-`position: fixed` terhadap JENDELA, bukan terhadap
          // kolom ini — jadi ia tidak ikut menyusut saat panel viewer terbuka
          // dan separuhnya akan tertutup panel. Lebarnya dihitung dari lebar
          // panel yang sama yang dipakai shell (viewer-context), bukan dari
          // salinan angka kedua yang bisa berbeda.
          right: `${viewerWidthPct(viewer)}%`,
        }}
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
          {listOpen ? (
            // Suggestions float ABOVE the input, chat-completion style. The
            // list mirrors SLASH_COMMANDS order (prepare/work/task/doc) so
            // ArrowDown walks the same order the eye already scanned.
            <div className="relative mb-2">
              <div className="absolute bottom-full left-0 z-30 max-h-72 w-96 max-w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background shadow-lg">
                {suggestions.map((item, i) => (
                  <button
                    key={item.value}
                    type="button"
                    // mousedown, not click: clicking would blur the textarea
                    // first and the focus return below would fight the click.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySuggestion(item.value);
                    }}
                    onMouseEnter={() => setPickIndex(i)}
                    className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors ${
                      i === pickIndex ? "bg-accent" : "hover:bg-accent/60"
                    }`}
                  >
                    <span className="w-full truncate font-mono text-xs font-semibold">{item.label}</span>
                    {item.hint ? <span className="w-full truncate text-[10px] text-muted-foreground">{item.hint}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {uploadError ? (
            <div className="pb-2">
              <Notice tone="warning">{uploadError}</Notice>
            </div>
          ) : null}
          {chatUploadError ? (
            <div className="pb-2">
              <Notice tone="warning">{chatUploadError}</Notice>
            </div>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(text);
            }}
          >
            <div className="rounded-[24px] border border-border bg-card px-3 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
              {(roomSession ? chatAttachments : attachments).length > 0 ? (
                // Chip DI DALAM kartu composer, bukan di atasnya: mereka bagian
                // dari pesan yang sedang disusun — ring focus-within kartu ikut
                // membingkainya. Dua tombol per chip karena dua tujuan berbeda:
                // nama = buka viewer, "×" = hapus. Hanya basename yang tampil —
                // jalur penuh (staging) ada di title, sebagaimana file chip di
                // balasan chat.
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {(roomSession ? chatAttachments : attachments).map((attachment) => (
                    <span
                      key={attachment.path}
                      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() => viewer.open(attachment.path)}
                        title={`Open ${attachment.path} in the viewer panel`}
                        className="inline-flex max-w-[16rem] items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate">{attachment.path.split("/").pop()}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        title={
                          roomSession
                            ? "Remove from this message (the file is swept by the TTL cleaner)"
                            : "Remove attachment (deletes the staged file)"
                        }
                        disabled={busy || uploading || chatBusy || chatUploading}
                        onClick={() =>
                          roomSession ? removeChatAttachment(attachment) : void removeAttachment(attachment)
                        }
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setCaret(event.target.selectionStart ?? event.target.value.length);
                  }}
                  // Kursor bisa pindah tanpa teks berubah (klik, panah, Home) —
                  // dan token yang sedang diketik ditentukan oleh posisinya,
                  // bukan hanya oleh isinya.
                  onSelect={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
                  onKeyDown={(event) => {
                    // Suggestion keys come first: with the list open, Enter
                    // COMPLETES rather than sends — otherwise the most common
                    // flow ("type /, press enter") would send a bare "/" to the
                    // router and get a CONFIRM back.
                    if (listOpen) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setPickIndex((i) => (i + 1) % suggestions.length);
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setPickIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                        return;
                      }
                      if (event.key === "Enter" || event.key === "Tab") {
                        event.preventDefault();
                        applySuggestion(suggestions[pickIndex].value);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        // Ditandai per TOKEN, bukan sebagai satu bendera: menutup
                        // daftar untuk "@doc" tidak boleh membungkam daftar
                        // berikutnya yang muncul untuk "TASK-".
                        setDismissed(token ? `${token.kind}:${token.token}` : null);
                        return;
                      }
                    }
                    // Enter sends, Shift+Enter inserts a newline — work requests are
                    // often multi-line, and forcing a single line makes people
                    // shorten the request until it loses an important requirement.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(text);
                    }
                  }}
                  rows={MIN_ROWS}
                  placeholder={roomSession ? `Message ${roomBrain?.name ?? "brain"}…` : "Message Semanggi…"}
                  className="max-h-[200px] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm outline-none focus:ring-0 placeholder:text-muted-foreground"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  // D77: dialog pemilih berkas hanya menawarkan teks — penolakan
                  // paling murah adalah berkas yang tak pernah bisa dipilih.
                  // Pemeriksaan isTextUploadName tetap ada: accept hanyalah
                  // saran bagi dialog, bukan pagar.
                  accept={TEXT_UPLOAD_ACCEPT}
                  hidden
                  onChange={(event) => void uploadFiles(event.target.files)}
                />
                {/* Salin draf — muncul hanya saat ada isinya: menyalin string
                    kosong ke papan klip akan MENIMPA apa yang operator baru
                    saja salin, dan itu kerusakan kecil yang sulit dilacak.
                    Slot-nya tetap dipasang supaya paperclip/send tidak
                    bergeser saat ketikan pertama masuk. */}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                  {text.trim().length > 0 ? (
                    <CopyButton text={text} label="Copy draft" iconClassName="h-4 w-4" />
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label="Attach text files"
                  title={
                    roomSession
                      ? "Attach text files to this session (chat/<id>/uploads, referenced by your next message, swept by the TTL cleaner)"
                      : "Attach text files (md, txt, json, …) — staged in tmp/uploads/, adopted into the task's deliverables/ on send, deleted after the task loads them"
                  }
                  disabled={
                    busy ||
                    uploading ||
                    chatBusy ||
                    chatUploading ||
                    (roomSession ? !chatRoomUsable : !projectId)
                  }
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {uploading || chatUploading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={busy || chatBusy || text.trim().length === 0}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy || chatBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                </button>
              </div>
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
            setCaret(value.length);
            setOpenDoc(null);
            textareaRef.current?.focus();
          }}
          onClose={() => setOpenDoc(null)}
        />
      ) : null}

      {pickerMode ? (
        <BrainPickerModal
          brains={chatBrains}
          currentBrainId={pickerMode === "switch" ? (roomSession?.brainId ?? null) : null}
          allowDefault={pickerMode === "new"}
          onSelect={(brainId) => void handlePickerSelect(brainId)}
          onClose={() => setPickerMode(null)}
        />
      ) : null}

      {brainSwitchTarget ? (
        <Modal
          title={`Switch to ${brainSwitchTarget.name}?`}
          subtitle={`${brainSwitchTarget.provider}/${brainSwitchTarget.model}`}
          onClose={() => setBrainSwitchTarget(null)}
          width="max-w-md"
          footer={
            <>
              <Button size="sm" variant="outline" disabled={chatBusy} onClick={() => setBrainSwitchTarget(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" disabled={chatBusy} onClick={() => void confirmBrainSwitch()}>
                Yes, reset context
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed">
            Switching this session&apos;s Brain resets the model&apos;s conversation context — the new Brain answers
            without the history of this session. The transcript itself stays readable.
          </p>
        </Modal>
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
 * Document viewer with an inline editor. Width is at least 60% of the window
 * so a real planning document doesn't cramp into a dialog-sized column, and
 * the markdown is rendered (headings, lists, task checkboxes, code,
 * emphasis) — showing raw `#`/`**` syntax for a document whose whole value
 * is its structure would defeat the purpose of reading it here.
 *
 * EDIT/SAVE: "Edit" swaps the reader for a 1:1 split — textarea on the left,
 * rendered markdown on the right — and every keystroke re-renders the
 * preview from the SAME draft state, so what Save persists is exactly what
 * the operator was shown, not what they hope they typed. Save hides the
 * editor and restores the reader; Cancel sits next to Save and appears and
 * disappears WITH it — it discards the draft and returns to the reader, and
 * the next Edit re-seeds from the saved content, so discarded text can't
 * resurrect. The buttons are rendered in the modal header next to the title
 * (Modal's `actions`): they belong to the document being viewed, and
 * floating them above the content made them shift position on every mode
 * swap.
 * The two split panes scroll in lockstep (proportional sync) so the preview
 * keeps showing the region being edited instead of drifting away from it.
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Every whitelisted document is editable from here, memory/ included
  // (D58 reversed D55's read-only lock on blueprint/decisions): the agents
  // only READ those files (spec §9's two-tier bootstrap), so the operator's
  // edits are authoritative, and the controller's PUT accepts them. The
  // controller remains the policy owner — if it ever refuses a name again,
  // the save fails loudly into `saveError` rather than being pre-judged
  // here.

  // Lockstep scrolling for the edit split. The sync is PROPORTIONAL — each
  // pane's scrollTop as a fraction of its own scrollable range — because the
  // rendered markdown is never the same height as its source (tables,
  // headings, spacing), so line-for-line mapping would drift on the first
  // construct. Writing the other pane's scrollTop fires that pane's own
  // scroll event; without the driver guard the two handlers would answer
  // each other forever. The driver lives in a ref, not state: the echo
  // arrives on the very next event, and a state update is still in flight by
  // then. A short timeout releases the guard once scrolling stops, so the
  // OTHER pane is free to become the driver the moment the operator grabs it.
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const syncDriver = useRef<"editor" | "preview" | null>(null);
  const syncRelease = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncScroll = (source: "editor" | "preview") => {
    if (syncDriver.current && syncDriver.current !== source) return;
    const from = source === "editor" ? editorRef.current : previewRef.current;
    const to = source === "editor" ? previewRef.current : editorRef.current;
    if (!from || !to) return;
    syncDriver.current = source;
    const fromRange = from.scrollHeight - from.clientHeight;
    const toRange = to.scrollHeight - to.clientHeight;
    // A pane with nothing to scroll can neither drive nor follow — forcing
    // scrollTop on it would just fight the browser back to zero.
    if (fromRange > 0 && toRange > 0) to.scrollTop = (from.scrollTop / fromRange) * toRange;
    // Release the guard shortly after scrolling stops: the echo of the last
    // programmatic write has long been swallowed by then, and whichever pane
    // the operator touches next must be free to become the driver.
    if (syncRelease.current) clearTimeout(syncRelease.current);
    syncRelease.current = setTimeout(() => {
      syncDriver.current = null;
    }, 150);
  };
  useEffect(
    () => () => {
      if (syncRelease.current) clearTimeout(syncRelease.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setEditing(false);
    setSaveError(null);
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

  const startEditing = () => {
    // Seed the draft from the fetched content, not from the last draft —
    // otherwise a reopened edit session silently resurrects text the
    // operator already discarded by closing the modal.
    setDraft(content ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await semanggi.saveProjectDoc(projectId, name, draft);
      setContent(draft);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${name}.md — ${template}`}
      // Gated on a loaded, existing document: while the fetch is in flight
      // (`content === null`) there is nothing to edit or save yet.
      actions={
        content !== null && !error ? (
          editing ? (
            // Cancel appears and disappears WITH Save — one edit mode, one
            // pair: it discards the draft and returns to the reader. The
            // next Edit re-seeds from the saved content (startEditing), so
            // nothing the operator threw away can resurrect.
            <>
              <Button size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={startEditing}>
              Edit
            </Button>
          )
        ) : null
      }
      onClose={onClose}
      width="min-w-[60vw] max-w-[90vw]"
    >
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
        <>
          {saveError ? <div className="mb-2"><LoadError error={saveError} /></div> : null}
          {editing ? (
            // 1:1 split: the editor owns the left half and the live preview
            // the right — equal widths, scrolling in lockstep (syncScroll) so
            // the preview keeps showing the region being edited. Scrolling
            // EITHER pane drives the other proportionally; without the sync a
            // long document's preview would sit at the top while the cursor
            // works three screens down.
            <div className="grid grid-cols-2 gap-3">
              <textarea
                ref={editorRef}
                onScroll={() => syncScroll("editor")}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                className="h-[62vh] w-full resize-none rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
              />
              {/* Copy anchors to a NON-scrolling wrapper: an absolute child
                  of the scroll container itself would scroll away with the
                  content, and a copy control that vanishes once the draft is
                  longer than one screen defeats its own purpose. Copies the
                  raw markdown source — what Save persists — not the render. */}
              <div className="relative">
                <div
                  ref={previewRef}
                  onScroll={() => syncScroll("preview")}
                  className="h-[62vh] overflow-y-auto rounded-md border border-border bg-background p-3"
                >
                  <MarkdownView content={draft} />
                </div>
                <CopyButton
                  text={draft}
                  label="Copy markdown source"
                  className="absolute right-1.5 top-1.5 z-10 bg-background/85 p-1 backdrop-blur-sm"
                />
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="max-h-[70vh] overflow-y-auto pr-1">
                <MarkdownView content={content} />
              </div>
              <CopyButton
                text={content}
                label="Copy document source"
                className="absolute right-1.5 top-1.5 z-10 bg-background/85 p-1 backdrop-blur-sm"
              />
            </div>
          )}
        </>
      ) : null}
      {footerAction && onCreateAction && exists === true && !editing ? (
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
    // Berhenti tepat setelah "@": itu memicu pencarian berkas di composer,
    // jadi pill ini menyerahkan kursor persis di tempat daftar akan muncul.
    { label: "/doc", text: "/doc @" },
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

function SystemMessage({
  reply,
  onOpenTask,
  onOpenFile,
}: {
  reply: ControlReply;
  onOpenTask: (taskId: string) => void;
  onOpenFile: (path: string) => void;
}) {
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
        className={`relative w-full max-w-[90%] space-y-2.5 rounded-[18px] border border-l-[3px] border-border bg-card px-3.5 py-3 ${accent} ${
          clickable ? "cursor-pointer transition-colors hover:border-primary/50" : ""
        }`}
      >
        {/* Copies the markdown SOURCE of the reply — the bubble is one
            rendered region, so the affordance sits in its top-right corner;
            stopPropagation (inside CopyButton) keeps the click from also
            opening the task on clickable bubbles. */}
        <CopyButton text={displayReply} label="Copy reply source" className="absolute right-2 top-2 z-10 p-1" />
        <div className="flex items-center gap-2 pr-8">
          <Badge tone={tone === "warning" ? "warning" : tone === "success" ? "success" : "info"}>{reply.intent}</Badge>
          {reply.action ? <Badge tone="neutral">{reply.action}</Badge> : null}
          {reply.taskId ? (
            <>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{reply.taskId}</code>
              <CopyButton text={reply.taskId} label={`Copy task ID ${reply.taskId}`} className="-translate-y-[0.12em] text-[11px]" />
            </>
          ) : null}
        </div>
        <MarkdownView content={displayReply} onOpenFile={onOpenFile} />
        {/* Berkas yang disebut balasan /doc — yang dirujuk permintaan plus
            keluarannya. Dirender terpisah dari markdown karena keduanya
            adalah HASIL perintah, bukan sekadar nama yang kebetulan lewat di
            dalam kalimat: yang ini pantas terlihat sebagai baris tersendiri. */}
        {reply.files && reply.files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {reply.files.map((path) => (
              <button
                key={path}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFile(path);
                }}
                title={`Buka ${path} di panel viewer`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <FileText className="h-3 w-3" />
                {path}
              </button>
            ))}
          </div>
        ) : null}
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
                  {/* Copies the REAL task id, not the document-local T-code
                      shown next to it: the id is what a /task command
                      accepts, and the tooltip names exactly what gets
                      copied. Span variant — the row itself is a <button>. */}
                  <CopyButton as="span" text={task.id} label={`Copy task ID ${task.id}`} className="-translate-y-[0.12em] text-[10px]" />
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
        {/* /doc yang membuat task adalah pekerjaan yang berjalan SETELAH balasan
            ini mendarat — tanpa bagian ini, operator hanya melihat "task
            dibuat" lalu harus membuka dialog sendiri untuk tahu progresnya. */}
        {reply.intent === "DOC" && reply.taskId ? (
          <DocTaskLive taskId={reply.taskId} />
        ) : null}
      </div>
    </div>
  );
}

/** Status yang masih bergerak: belum terminal dan belum diparkir untuk manusia.
 *  WAIT_* dicakup lewat prefix-nya — kosakata WAIT bertambah tanpa daftar ini
 *  perlu ikut (kegagalan yang sama dengan katalog saran slash bila terlupa). */
function taskInFlight(status: string): boolean {
  return (
    ["CREATED", "QUEUED", "DISPATCHED", "RUNNING"].includes(status) || status.startsWith("WAIT_")
  );
}

const LIVE_POLL_MS = 10_000;

/**
 * Live progress untuk task yang lahir dari sebuah balasan /doc.
 *
 * Mem-poll `task` + `transcript` tiap 10 detik; berhenti total saat status
 * tidak lagi in-flight (COMPLETE/FAILED/CANCELLED/BLOCKED/RESUMABLE) — poll
 * pada status diam adalah permintaan yang jawabannya tidak akan berubah.
 * Baris terakhir transkrip yang ditampilkan adalah AKTIVITAS terbaru yang
 * tercatat controller, bukan teks yang diarangkan: operator melihat apa yang
 * sedang dikerjakan agennya, bukan hanya badge status yang tidak bergerak.
 */
function DocTaskLive({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const [detail, transcript] = await Promise.all([
          semanggi.task(taskId),
          semanggi.transcript(taskId),
        ]);
        if (cancelled) return;
        setFailed(null);
        setStatus(detail.task.status);
        setTurns(transcript.turns);
        if (!taskInFlight(detail.task.status)) return; // selesai: jangan jadwalkan lagi
      } catch (err) {
        if (cancelled) return;
        // Poll gagal (mis. jaringan sesaat) bukan alasan menghentikan pelacakan
        // — tasknya mungkin masih berjalan. Tampil sebagai catatan, coba lagi.
        setFailed(err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) timer = setTimeout(poll, LIVE_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  const inFlight = status === null || taskInFlight(status);
  const recent = turns.slice(-3).reverse();

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-2">
        {inFlight ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : (
          <span
            className={`h-2 w-2 rounded-full ${
              status === "COMPLETE" ? "bg-emerald-400" : status === "BLOCKED" || status === "FAILED" ? "bg-amber-400" : "bg-muted-foreground/50"
            }`}
          />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {inFlight ? (status ?? "loading") : status}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {inFlight ? `· refreshing every ${LIVE_POLL_MS / 1000}s` : "· stopped"}
        </span>
      </div>
      {failed ? <div className="text-[10px] text-amber-600 dark:text-amber-300">{failed}</div> : null}
      {recent.length > 0 ? (
        <div className="space-y-0.5">
          {recent.map((turn, i) => (
            <div key={`${turn.executionId ?? ""}-${turn.seq ?? turn.at}-${i}`} className="flex gap-2 text-[10px] leading-relaxed">
              <span className="shrink-0 font-mono text-muted-foreground">
                {new Date(turn.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className="shrink-0 font-semibold text-muted-foreground">{turn.role}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {turn.text.replace(/\s+/g, " ").trim() || "(no text)"}
              </span>
            </div>
          ))}
        </div>
      ) : status !== null && turns.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">No transcript yet.</div>
      ) : null}
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
                    {/* The failover chain behind the first brain (D68) —
                        collapsed to "+N" with the full order in the tooltip:
                        the chain matters when the first brain goes down, not
                        on every read. */}
                    {step.brainList && step.brainList.length > 1 ? (
                      <span
                        className="ml-1 text-[10px] text-muted-foreground"
                        title={`Failover order: ${step.brainList.join(" → ")}`}
                      >
                        +{step.brainList.length - 1}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-red-600 dark:text-red-300">none yet</span>
                )}
                {step.brainNote ? <div className="text-[10px] text-amber-600 dark:text-amber-300">{step.brainNote}</div> : null}
              </td>
              <td className="px-2 py-1 text-muted-foreground">{step.workspaceMode}</td>
              {created ? (
                <td className="px-2 py-1">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <code className="text-[10px]">{step.taskId}</code>
                    {step.taskId ? (
                      <CopyButton text={step.taskId} label={`Copy task ID ${step.taskId}`} className="-translate-y-[0.12em] text-[10px]" />
                    ) : null}
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
