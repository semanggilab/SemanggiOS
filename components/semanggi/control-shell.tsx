"use client";

// Client-side wrapper around `OperationsShell` for the Control page.
//
// Same reason as `summary-shell.tsx`: `OperationsShell`'s `children` render
// function has to be defined inside a Client Component. `app/control/page.tsx`
// is a Server Component (it awaits the server-only snapshot loader), so it
// can only hand this component a plain, serializable `initialSnapshot` — the
// render-prop closure lives here instead.
//
// D73 — DI SINILAH PANEL VIEWER DIPASANG, DAN KENAPA DI SINI
//
// Panel viewer tidak berada di dalam `<main>`: ia sebuah `<div>` sibling,
// dipasang lewat prop `aside` milik `OperationsShell` (tambalan hulu, lihat
// apply.sh). Yang MEMBUKA berkas adalah `ControlPage`, yang hidup di dalam
// `<main>` sebagai anak render-prop. Dua cabang pohon yang berbeda, jadi
// keadaannya dipegang oleh induk bersama mereka — komponen ini — dan
// dibagikan lewat ViewerProvider.
//
// Lebar disimpan sebagai PERSEN, bukan piksel: operator yang menyeret panel
// ke 40% pada layar lebar mengharapkan proporsi yang sama saat jendela
// mengecil, bukan panel yang tiba-tiba memakan seluruh layar.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { OperationsShell } from "@/components/operations/operations-shell";
import { ControlPage } from "./control-page";
import { FileViewerPanel } from "./file-viewer";
import { ViewerProvider } from "./viewer-context";

/** Batas seret. Di bawah 20% panel tidak muat judul berkasnya; di atas 70%
 *  percakapan yang jadi alasan halaman ini ada tinggal satu lajur sempit. */
const MIN_PCT = 20;
const MAX_PCT = 70;
const DEFAULT_PCT = 40;

export function SemanggiControlShell({ initialSnapshot }: { initialSnapshot: MissionControlSnapshot }) {
  const [path, setPath] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [widthPct, setWidthPct] = useState(DEFAULT_PCT);
  const dragging = useRef(false);

  const open = useCallback((next: string) => setPath(next), []);
  const close = useCallback(() => setPath(null), []);

  // Seret dipasang di window, bukan di splitter: sekali pointer bergerak lebih
  // cepat dari render, ia keluar dari batang 9px dan setiap event berikutnya
  // hilang — panel berhenti mengikuti kursor di tengah seretan.
  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    // Kursor dan pilihan teks dikunci selama seret: tanpa ini, menyeret
    // melewati percakapan menyorot seluruh isinya.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      const pct = ((window.innerWidth - event.clientX) / window.innerWidth) * 100;
      setWidthPct(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)));
    };
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      end();
    };
  }, []);

  return (
    <ViewerProvider value={{ path, widthPct, open, close }}>
      <OperationsShell
        initialSnapshot={initialSnapshot}
        asideWidth={path ? `${widthPct}%` : undefined}
        aside={
          path ? (
            <FileViewerPanel projectId={projectId} path={path} onClose={close} onStartResize={startResize} />
          ) : null
        }
      >
        {(context) => (
          <ControlPage
            activeWorkspacePath={context.activeWorkspace?.path ?? null}
            // Panel hidup di luar `<main>` dan karena itu di luar jangkauan
            // dropdown "Active Project" halaman — ia harus diberi tahu project
            // mana yang sedang dipilih, atau ia akan membaca berkas dari
            // workspace project lain.
            onProjectChange={setProjectId}
          />
        )}
      </OperationsShell>
    </ViewerProvider>
  );
}
