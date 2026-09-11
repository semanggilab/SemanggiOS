"use client";

// POC-10 brain picker (spec §7.4) — dua tingkat, gratis dulu.
//
// TINGKAT PERTAMA adalah MODEL (provider+model), tingkat kedua adalah daftar
// Brain yang memakai model itu. Grup TIER-GRATIS (quotaTier dari driver kuota
// D63 — "free"/"free-trial") tampil dan direkomendasikan duluan, berbayar
// tetap terjangkau di bawahnya: percakapan adalah pemakaian kuota yang
// paling "boros tanpa hasil", jadi kalau ada anggota armada gratis yang
// sehat, dia yang seharusnya kehilangan token — bukan langganan berbayar.
//
// Komponen ini TIDAK MEMUTUSKAN apa pun: ia hanya memilih brainId (atau null
// = resolusi default role chat). Konsekuensi pilihan — reset konteks saat
// ganti brain sesi aktif (§10.2) — milik pemanggil, karena hanya pemanggil
// yang tahu apakah pilihan ini untuk sesi BARU (tanpa konsekuensi) atau sesi
// TERBUKA (konfirmasi reset).

import { Check } from "lucide-react";
import type { Brain } from "@/lib/semanggi/client";
import { Badge, Modal } from "./ui";

/** Tier kuota mana yang dianggap "gratis" (direkomendasikan duluan). Label
 *  tier adalah fakta driver (D63), bukan penilaian UI — daftar ini hanya
 *  memutuskan URUTAN, bukan bisa-tidaknya memilih. */
function isFreeTier(tier: string | null | undefined): boolean {
  return typeof tier === "string" && tier.toLowerCase().startsWith("free");
}

type BrainGroup = {
  key: string;
  provider: string;
  model: string;
  tier: string | null;
  free: boolean;
  brains: Brain[];
};

export function groupChatBrains(brains: Brain[]): BrainGroup[] {
  const groups = new Map<string, BrainGroup>();
  for (const brain of brains) {
    // Hanya brain yang hidup: memilih brain mati untuk sesi baru hanya
    // menunda kegagalan ke pesan pertama.
    if (brain.enabled === false) continue;
    const key = `${brain.provider}/${brain.model}`;
    const group = groups.get(key) ?? {
      key,
      provider: brain.provider,
      model: brain.model,
      tier: brain.quotaTier ?? null,
      free: isFreeTier(brain.quotaTier),
      brains: [],
    };
    group.brains.push(brain);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    return `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`);
  });
}

export function BrainPickerModal({
  brains,
  currentBrainId,
  allowDefault,
  onSelect,
  onClose,
}: {
  brains: Brain[];
  /** Sesi terbuka: brain yang sedang dipakai — ditandai, dan memilihnya
   *  lagi adalah no-op (bukan konfirmasi reset untuk brain yang sama). */
  currentBrainId?: string | null;
  /** Sesi baru: tawarkan resolusi default role chat (null) di paling atas. */
  allowDefault?: boolean;
  onSelect: (brainId: string | null) => void;
  onClose: () => void;
}) {
  const groups = groupChatBrains(brains);
  const current = currentBrainId ?? null;

  return (
    <Modal
      title="Pick a Brain"
      subtitle="Free-tier models are listed first — conversation burns quota without producing deliverables."
      onClose={onClose}
      width="max-w-xl"
    >
      <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
        {allowDefault ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Default</span>
              <span className="block text-xs text-muted-foreground">
                Resolved from Role Brain Map (role: chat) when the session starts
              </span>
            </span>
            <Badge tone="info">recommended</Badge>
          </button>
        ) : null}

        {groups.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No enabled Brains — enable one on the Brain settings page first.
          </p>
        ) : null}

        {groups.map((group) => (
          <div key={group.key} className="space-y-1">
            <div className="flex items-center gap-2 px-0.5">
              <span className="font-mono text-xs font-semibold">{group.model}</span>
              <span className="text-[10px] text-muted-foreground">{group.provider}</span>
              {group.free ? (
                <Badge tone="success" title="Quota driver classifies this model's tier as free">
                  free tier
                </Badge>
              ) : group.tier ? (
                <Badge tone="neutral">{group.tier}</Badge>
              ) : null}
            </div>
            {group.brains.map((brain) => {
              const isCurrent = brain.id === current;
              return (
                <button
                  key={brain.id}
                  type="button"
                  onClick={() => onSelect(brain.id)}
                  title={brain.description || brain.name}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isCurrent
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{brain.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      level {brain.level}
                      {brain.thinking ? ` · thinking ${brain.thinking}` : ""}
                    </span>
                  </span>
                  {isCurrent ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
