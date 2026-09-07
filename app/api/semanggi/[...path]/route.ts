// Proxy AgentOS → work-controller Semanggi.
//
// KENAPA LEWAT SERVER, BUKAN LANGSUNG DARI PERAMBAN
//
// Tiga alasan, dan yang ketiga yang paling menentukan:
//
//   1. Token controller tidak pernah sampai ke peramban. Ia dibaca dari secret
//      di sisi server dan tidak pernah muncul di bundel, di devtools, atau di
//      riwayat permintaan.
//   2. Controller tidak perlu dipublikasikan. Ia tetap hanya terjangkau dari
//      jaringan overlay, seperti sekarang.
//   3. AgentOS memblokir mutasi yang tidak terbukti lokal (`instance-protection`).
//      Panggilan dari halaman ke origin-nya sendiri lolos; panggilan langsung
//      dari peramban ke host lain tidak akan pernah membawa sesi AgentOS.
//
// BATAS YANG DIKETAHUI (§8.4)
//
// Satu token bersama berarti setiap aksi dari halaman ini tercatat atas satu
// identitas. `x-semanggi-actor` membawa nama pengguna AgentOS agar linimasa
// tetap menyebut seseorang, tetapi nama itu berasal dari sesi peramban, bukan
// dari kredensial — jadi ia adalah label, bukan bukti. Siapa pun yang bisa
// membuka halaman ini bisa bertindak sebagai siapa pun. Itu keputusan yang
// diambil sadar, bukan kelalaian.

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

import {
  getInstanceProtectionStatus,
  readInstanceSessionCookie,
} from "@/lib/security/instance-protection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTROLLER_URL = process.env.SEMANGGI_CONTROLLER_URL ?? "http://semanggi-controller:8080";
const TOKEN_FILE = process.env.SEMANGGI_CONTROLLER_TOKEN_FILE ?? null;
const TOKEN_INLINE = process.env.SEMANGGI_CONTROLLER_TOKEN ?? null;

/**
 * Hanya jalur yang benar-benar dipakai halaman Semanggi.
 *
 * Daftar putih, bukan daftar hitam: proxy yang meneruskan apa saja akan
 * memberi setiap pengunjung AgentOS seluruh permukaan admin controller —
 * termasuk pembuatan operator, yang justru merusak jejak audit yang sedang
 * kita jaga.
 */
const ALLOWED: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^work\/(projects|projects\/summary|workers|models|brains|role-levels|role-levels\/resolve|brain-map|agents|queue|stats|resources|leases|events|tasks)$/ },
  { method: "GET", pattern: /^work\/tasks\/[A-Za-z0-9_-]+$/ },
  { method: "GET", pattern: /^work\/tasks\/[A-Za-z0-9_-]+\/transcript$/ },
  { method: "POST", pattern: /^work\/tasks$/ },
  { method: "POST", pattern: /^work\/tasks\/[A-Za-z0-9_-]+\/(start|stop|cancel|expedite|comments|revisions)$/ },
  { method: "PATCH", pattern: /^work\/tasks\/[A-Za-z0-9_-]+$/ },
  { method: "POST", pattern: /^work\/approvals\/[A-Za-z0-9_-]+\/(decide|comment)$/ },
  { method: "POST", pattern: /^work\/(projects|brains|control\/message|routing\/preview)$/ },
  { method: "PATCH", pattern: /^work\/brains\/[A-Za-z0-9_-]+$/ },
  { method: "POST", pattern: /^work\/brains\/[A-Za-z0-9_-]+\/test$/ },
  { method: "POST", pattern: /^work\/brains\/test$/ },
  { method: "PUT", pattern: /^work\/(role-levels|brain-map)$/ },
  { method: "PATCH", pattern: /^work\/projects\/[A-Za-z0-9_-]+$/ },
  { method: "DELETE", pattern: /^work\/projects\/[A-Za-z0-9_-]+$/ },
  { method: "GET", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/role-levels$/ },
  { method: "PUT", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/role-levels$/ },
  { method: "GET", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/docs$/ },
  { method: "GET", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/docs\/[a-z-]+$/ },
  // Edit/Save modal Command Center (D55): route PUT controller sudah ada sejak
  // 2026-09-06, tapi tanpa entri ini setiap simpan gagal 404 "does not expose
  // PUT" — kegagalan kedua dari jenis yang sama setelah role-levels
  // (readiness.md). Route controller baru belum nyata bagi halaman sampai ia
  // terdaftar di sini.
  { method: "PUT", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/docs\/[a-z-]+$/ },
  // D73 — berkas workspace untuk pencarian "@" dan panel viewer. Path berkas
  // dikirim sebagai QUERY PARAM, bukan segmen: sebuah path berisi "/" tidak
  // selamat melewati catch-all ini (alasan yang sama dengan Model Map). Yang
  // menjaga path tetap di dalam workspace adalah controller, bukan pola di
  // sini — mengulang aturan itu di dua tempat berarti keduanya akan menyimpang.
  { method: "GET", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/files$/ },
  { method: "GET", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/file$/ },
  { method: "PUT", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/file$/ },
  // D76 — lampiran operator. Body BYTES MENTAH (lihat forwardBinary); nama
  // berkas dikirim sebagai query param, alasan yang sama dengan file?path=.
  { method: "POST", pattern: /^work\/projects\/[A-Za-z0-9_-]+\/uploads$/ },
  { method: "GET", pattern: /^work\/gateway\/(models|thinking-levels)$/ },
  { method: "GET", pattern: /^work\/quota-drivers$/ },
  // Model Map (D66): the join read plus its two write paths. PATCH identifies
  // its row by query params — groq model ids contain "/" and a slash cannot
  // survive this catch-all as a path segment.
  { method: "GET", pattern: /^work\/model-map$/ },
  { method: "POST", pattern: /^work\/resources$/ },
  { method: "PATCH", pattern: /^work\/resources$/ },
  { method: "PUT", pattern: /^work\/thinking-levels$/ },
  // D67: row deletion from the Model Map + Brain forms. Same query-param
  // identity rule as PATCH above; the brains delete has existed on the
  // controller since the brain_map-clearing rework but was never exposed
  // here, so the form had no way to reach it.
  { method: "DELETE", pattern: /^work\/model-map$/ },
  { method: "DELETE", pattern: /^work\/brains\/[A-Za-z0-9_-]+$/ },
  { method: "POST", pattern: /^work\/gateway\/models\/refresh$/ },
  { method: "POST", pattern: /^work\/gateway\/thinking-levels\/refresh$/ },
  { method: "POST", pattern: /^work\/gateway\/thinking-levels\/probe$/ },
  { method: "GET", pattern: /^work\/gateway\/thinking-levels\/probe\/status$/ },
];

let cachedToken: string | null = null;

async function controllerToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (TOKEN_INLINE) return (cachedToken = TOKEN_INLINE.trim());
  if (!TOKEN_FILE) return null;
  try {
    cachedToken = (await readFile(TOKEN_FILE, "utf8")).trim();
    return cachedToken;
  } catch {
    return null;
  }
}

function isAllowed(method: string, path: string): boolean {
  return ALLOWED.some((rule) => rule.method === method && rule.pattern.test(path));
}

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  // Halaman Semanggi hanya boleh dipakai oleh sesi AgentOS yang sudah terbuka.
  // Tanpa pemeriksaan ini, proxy menjadi pintu belakang ke controller yang
  // melewati satu-satunya kunci yang dimiliki AgentOS.
  const status = await getInstanceProtectionStatus(readInstanceSessionCookie(request.headers));
  if (status.protectionEnabled && !status.authenticated) {
    return NextResponse.json({ error: "Unlock AgentOS first.", code: "instance-auth-required" }, { status: 401 });
  }

  const { path } = await context.params;
  const joined = (path ?? []).join("/");
  if (!isAllowed(request.method, joined)) {
    return NextResponse.json(
      { error: `Semanggi proxy does not expose ${request.method} /${joined}`, code: "not-exposed" },
      { status: 404 },
    );
  }

  const token = await controllerToken();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Semanggi controller token is not configured. Set SEMANGGI_CONTROLLER_TOKEN_FILE to the mounted secret.",
        code: "controller-token-missing",
      },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(`/api/${joined}`, CONTROLLER_URL);
  target.search = incoming.search;

  const actor = status.username?.trim() || "agentos";
  // Unggahan (D76): body adalah bytes mentah — request.text() akan
  // men-decode-nya sebagai UTF-8 dan merusak berkas biner sebelum sampai ke
  // controller. arrayBuffer meneruskan apa adanya; content-type octet-stream
  // dari klien dipertahankan supaya dispatcher controller tahu bentuknya.
  const isUpload = request.method === "POST" && /^work\/projects\/[A-Za-z0-9_-]+\/uploads$/.test(joined);
  const body = isUpload
    ? await request.arrayBuffer()
    : ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.text();

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": isUpload ? "application/octet-stream" : "application/json",
        // Label, bukan bukti — lihat catatan di kepala berkas.
        "x-semanggi-actor": actor,
      },
      body:
        body && (isUpload || (typeof body === "string" && body.length > 0)) ? body : undefined,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    // Controller tidak terjangkau adalah keadaan yang sering terjadi saat
    // deploy, dan halaman perlu membedakannya dari "tidak ada data" — kalau
    // disamakan, layar kosong akan terbaca sebagai antrian kosong.
    return NextResponse.json(
      {
        error: `Semanggi controller unreachable at ${CONTROLLER_URL}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        code: "controller-unreachable",
      },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
