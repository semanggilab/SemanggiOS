"use client";

// Keadaan panel viewer berkas — dibagi antara halaman dan shell (D73).
//
// KENAPA CONTEXT, BUKAN PROP
//
// Permintaan strukturalnya mengikat: panel viewer TIDAK berada di dalam
// `<main>`, ia sebuah `<div>` sibling di luarnya. Yang membuka berkas adalah
// `ControlPage`, dan `ControlPage` dirender DI DALAM `<main>` (ia anak dari
// render-prop `OperationsShell`). Jadi yang membuka dan yang menampilkan
// hidup di dua cabang pohon yang berbeda, dan tidak ada prop yang bisa
// menyeberang dari satu ke yang lain tanpa melewati induk bersama mereka.
// Induk bersama itu adalah `SemanggiControlShell`; context inilah caranya
// menyediakan satu keadaan untuk keduanya.
//
// Lebar panel ikut di sini karena bukan hanya panel yang perlu tahu: composer
// Command Center ber-`position: fixed` terhadap jendela, jadi tanpa mengetahui
// lebar panel ia akan terus melebar sampai ke bawahnya — kotak ketik yang
// separuhnya tertutup.

import { createContext, useContext } from "react";

export type ViewerState = {
  /** Berkas yang sedang dibuka, relatif terhadap workspace project. */
  path: string | null;
  /** Lebar panel dalam PERSEN dari lebar jendela. Default 40 (main 60). */
  widthPct: number;
  open: (path: string) => void;
  close: () => void;
};

const ViewerContext = createContext<ViewerState>({
  path: null,
  widthPct: 40,
  // Default no-op, bukan throw: sebuah halaman yang dirender tanpa shell
  // (Storybook, tes, atau rute baru yang lupa memasang provider) harus tetap
  // tampil — kehilangan panel viewer, bukan kehilangan seluruh Command Center.
  open: () => {},
  close: () => {},
});

export const ViewerProvider = ViewerContext.Provider;

export function useViewer(): ViewerState {
  return useContext(ViewerContext);
}

/** Panel tertutup memakai 0% — satu tempat yang menghitungnya, bukan tiga. */
export function viewerWidthPct(state: ViewerState): number {
  return state.path ? state.widthPct : 0;
}
