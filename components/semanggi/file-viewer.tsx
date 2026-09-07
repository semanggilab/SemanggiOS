"use client";

// Panel viewer berkas — kolom kanan Command Center (D73).
//
// BENTUKNYA: DUA MODE, BUKAN DUA PANEL
//
// "markdown" merender, "code" menyunting sumbernya. Keduanya menampilkan
// berkas yang SAMA dari state draf yang sama, jadi apa yang tersimpan saat
// Save persis apa yang barusan terlihat — bukan versi lain yang kebetulan
// masih ada di memori. Save dan Cancel hanya ada di mode code: sebuah tombol
// simpan yang muncul saat tidak ada yang bisa disunting adalah tawaran yang
// tidak berarti apa-apa.
//
// KENAPA BERKAS NON-MARKDOWN TETAP BISA DIBUKA
//
// Balasan agen menyebut berkas apa pun yang ia sentuh, dan sebuah nama berkas
// yang tidak bisa diklik memaksa operator mencarinya di tempat lain. Yang
// dibatasi adalah MENULIS — server yang memutuskan (`editable`), bukan panel
// ini; menyalin aturannya ke sini berarti dua salinan yang akan menyimpang.
// Berkas biner mengaku biner alih-alih dirender sebagai teks rusak.

import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, FileText, LoaderCircle, X } from "lucide-react";
import { semanggi, type WorkspaceFileContent } from "@/lib/semanggi/client";
import { Button, CopyButton, LoadError } from "./ui";
import { MarkdownView } from "./markdown";

type Mode = "markdown" | "code";

export function FileViewerPanel({
  projectId,
  path,
  onClose,
  onStartResize,
}: {
  projectId: string | null;
  path: string;
  onClose: () => void;
  /** Dipasang ke splitter; shell yang memiliki geometri, panel yang memicunya. */
  onStartResize: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const [file, setFile] = useState<WorkspaceFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("markdown");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Draf yang belum disimpan tidak boleh hilang diam-diam saat operator
  // menekan Cancel karena refleks; `dirty` yang membuat konfirmasi hanya
  // muncul ketika memang ada yang bisa hilang.
  const dirty = file !== null && mode === "code" && draft !== (file.content ?? "");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setFile(null);
    setError(null);
    setSaveError(null);
    // Kembali ke mode baca setiap kali berkas berganti: mode code yang
    // menetap akan menampilkan berkas BARU dalam editor yang draf-nya masih
    // milik berkas lama, dan Save berikutnya menulisnya ke alamat yang salah.
    setMode("markdown");
    semanggi
      .workspaceFile(projectId, path)
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        setDraft(f.content ?? "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  const save = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await semanggi.saveWorkspaceFile(projectId, path, draft);
      setFile((prev) => (prev ? { ...prev, content: draft, exists: true, size: draft.length } : prev));
      setMode("markdown");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [projectId, path, draft]);

  const cancel = () => {
    if (dirty && !window.confirm("Buang perubahan yang belum disimpan?")) return;
    setDraft(file?.content ?? "");
    setSaveError(null);
    setMode("markdown");
  };

  // Ctrl/Cmd+S menyimpan tanpa meninggalkan editor. Ditangkap di panel, bukan
  // di window: pintasan simpan peramban tidak boleh dibajak sebuah halaman
  // yang kebetulan terbuka di tab lain dari aplikasi yang sama.
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && mode === "code" && file?.editable) {
      event.preventDefault();
      void save();
    }
  };

  const editable = file?.editable === true && file.binary !== true;

  return (
    <div ref={panelRef} onKeyDown={onKeyDown} className="flex h-full min-w-0 flex-col border-l border-border bg-background">
      {/* Splitter: batang tipis di tepi KIRI panel, tempat mata sudah mencari
          batas antara dua kolom. Lebarnya 4px dengan area sentuh 9px — cukup
          untuk mouse tanpa memakan lebar yang terlihat. */}
      <div
        onPointerDown={onStartResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ubah lebar panel"
        className="absolute left-0 top-0 z-10 h-full w-[9px] -translate-x-1/2 cursor-col-resize"
      >
        <div className="mx-auto h-full w-[3px] rounded-full bg-transparent transition-colors hover:bg-primary/40" />
      </div>

      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        {/* Grup tombol mode — satu kontrol, dua keadaan, bukan dua tombol
            yang bisa sama-sama menyala. Mode code dimatikan untuk berkas yang
            tidak boleh ditulis: menawarkan editor lalu menolak simpannya
            adalah janji yang dibatalkan setelah pekerjaan selesai. */}
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          <ModeButton active={mode === "markdown"} onClick={() => setMode("markdown")} label="Markdown">
            <FileText className="h-3.5 w-3.5" />
          </ModeButton>
          <ModeButton
            active={mode === "code"}
            disabled={!editable}
            onClick={() => setMode("code")}
            label={editable ? "Code" : "Berkas ini tidak bisa disunting"}
          >
            <Code2 className="h-3.5 w-3.5" />
          </ModeButton>
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={path}>
          {path}
        </span>
        {mode === "code" && editable ? (
          <span className="flex shrink-0 gap-1.5">
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={cancel}>
              Cancel
            </Button>
          </span>
        ) : null}
        <button
          type="button"
          aria-label="Tutup panel"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {error ? <LoadError error={error} /> : null}
        {saveError ? (
          <div className="mb-2">
            <LoadError error={saveError} />
          </div>
        ) : null}
        {!error && file === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Memuat…
          </div>
        ) : null}
        {file && file.exists === false ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {`“${path}” belum ada di workspace project ini.`}
          </p>
        ) : null}
        {file && file.binary ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Berkas biner ({file.size.toLocaleString()} byte) — tidak ditampilkan sebagai teks.
          </p>
        ) : null}
        {file && file.exists && !file.binary ? (
          mode === "code" ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={!editable}
              spellCheck={false}
              className="h-full w-full resize-none rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <div className="relative h-full">
              <div className="h-full overflow-y-auto pr-1">
                {/* Merender draf, bukan isi tersimpan: kembali ke mode
                    markdown setelah menyunting harus memperlihatkan yang
                    baru saja diketik, bukan versi sebelum suntingan. */}
                <MarkdownView content={draft} />
              </div>
              <CopyButton
                text={draft}
                label="Copy file source"
                className="absolute right-1.5 top-1.5 z-10 bg-background/85 p-1 backdrop-blur-sm"
              />
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-8 items-center justify-center transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
