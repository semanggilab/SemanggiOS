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
  { method: "POST", pattern: /^work\/(brains|control\/message|routing\/preview)$/ },
  { method: "PATCH", pattern: /^work\/brains\/[A-Za-z0-9_-]+$/ },
  { method: "POST", pattern: /^work\/brains\/[A-Za-z0-9_-]+\/test$/ },
  { method: "PUT", pattern: /^work\/(role-levels|brain-map)$/ },
  { method: "PATCH", pattern: /^work\/projects\/[A-Za-z0-9_-]+$/ },
  { method: "GET", pattern: /^work\/gateway\/(models|thinking-levels)$/ },
  { method: "POST", pattern: /^work\/gateway\/thinking-levels\/refresh$/ },
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
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        // Label, bukan bukti — lihat catatan di kepala berkas.
        "x-semanggi-actor": actor,
      },
      body: body && body.length > 0 ? body : undefined,
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
