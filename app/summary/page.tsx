// Halaman Summary Semanggi.
//
// `workspace` diambil dari query string, bukan dari state sidebar AgentOS.
// Alasannya jujur: pengait workspace aktif milik AgentOS ada di dalam
// MissionControlShell, dan menebak bentuknya adalah persis kesalahan yang
// dicatat di D34 — menyimpulkan permukaan hulu dari pembacaan, bukan dari
// pengukuran. Item nav Semanggi menambahkan `?workspace=<path>` saat sebuah
// workspace sedang aktif, sehingga filter tetap bekerja hari ini, dan
// menggantinya dengan pengait asli nanti hanya menyentuh satu baris.

import { SummaryPage } from "@/components/semanggi/summary-page";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { workspace } = await searchParams;
  return <SummaryPage activeWorkspacePath={workspace ?? null} />;
}
