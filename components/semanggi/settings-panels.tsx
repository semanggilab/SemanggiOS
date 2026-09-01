"use client";

// Tiga panel settings Semanggi: Brain, Role Map, Brain Map.
//
// Ketiganya menjawab pertanyaan yang berbeda dan berurutan:
//
//   Brain      "kombinasi model + effort apa saja yang kita punya?"
//   Role Map   "seberapa mahal tiap role boleh berpikir?"
//   Brain Map  "di level itu, Brain yang mana untuk role ini?"
//
// Urutannya bukan selera: Brain Map tidak bisa diisi sebelum ada Brain, dan
// levelnya tidak bermakna sebelum Role Map disetel.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  semanggi,
  type Brain,
  type BrainMap,
  type CatalogModel,
  type Level,
  type RoleLevels,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Empty, Field, LoadError, Notice, Select } from "./ui";

const LEVELS: Level[] = ["low", "normal", "critical"];

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setData(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, error, loading, reload: run };
}

// --- Brain -------------------------------------------------------------------

export function SemanggiBrainsPanel() {
  const { data, error, reload } = useAsync(() => semanggi.brains(), []);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    provider: "",
    model: "",
    thinking: "",
    effortMode: "guaranteed" as Brain["effortMode"],
    effortEvidence: "",
    level: "normal" as Level,
    category: "",
    description: "",
  });

  useEffect(() => {
    semanggi.models().then((m) => setModels(m.models)).catch(() => setModels([]));
  }, []);

  const create = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await semanggi.createBrain({
        ...draft,
        thinking: draft.thinking || null,
        category: draft.category || null,
        effortEvidence: draft.effortEvidence || null,
      });
      setDraft({ ...draft, name: "", description: "" });
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (brain: Brain) => {
    setBusy(true);
    try {
      await semanggi.updateBrain(brain.id, { enabled: !brain.enabled });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}

      <Card title="Brain" subtitle="Kombinasi (provider, model, thinking, effort) yang diberi nama dan bisa dipetakan ke role.">
        {!data || data.brains.length === 0 ? (
          <Empty>Belum ada Brain.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Nama", "Model", "Effort", "Level", "Kategori", "Ketersediaan", ""].map((h) => (
                    <th key={h} className="px-2 py-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.brains.map((brain) => (
                  <tr key={brain.id} className={`border-t border-border ${brain.enabled ? "" : "opacity-50"}`}>
                    <td className="px-2 py-1">
                      <div className="font-medium">{brain.name}</div>
                      {brain.description ? <div className="text-[10px] text-muted-foreground">{brain.description}</div> : null}
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {brain.provider}/{brain.model}
                    </td>
                    <td className="px-2 py-1">
                      {brain.thinking ? (
                        <span className="flex items-center gap-1">
                          {brain.thinking}
                          {/* Klaim effort yang tidak diterapkan provider adalah
                              kebohongan yang dibayar dua kali (D31): sekali di
                              keputusan routing, sekali saat hasilnya tidak
                              sesuai harga. Jadi ia ditandai, bukan disamarkan. */}
                          {brain.effortMode === "preference" ? (
                            <Badge tone="warning">tidak aktif</Badge>
                          ) : (
                            <Badge tone="success">aktif</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {brain.effortEvidence ? (
                        <div className="max-w-[18rem] truncate text-[10px] text-muted-foreground" title={brain.effortEvidence}>
                          {brain.effortEvidence}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1">
                      <Badge tone={brain.level === "critical" ? "warning" : "neutral"}>{brain.level}</Badge>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{brain.category ?? "—"}</td>
                    <td className="px-2 py-1">
                      <Badge tone={brain.availability === "AVAILABLE" ? "success" : "neutral"}>{brain.availability ?? "UNKNOWN"}</Badge>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(brain)}>
                        {brain.enabled ? "Matikan" : "Aktifkan"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Tambah Brain" subtitle="provider dan model tidak bisa diubah setelah dibuat — agen di-provision atas namanya.">
        <div className="space-y-3">
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nama">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="glm-5.2-max"
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
            <Field label="Salin dari katalog" hint="Mengisi provider, model dan effort sekaligus.">
              <Select
                value=""
                onChange={(name) => {
                  const m = models.find((x) => x.name === name);
                  if (!m) return;
                  setDraft({
                    ...draft,
                    name: draft.name || m.name,
                    provider: m.provider,
                    model: m.model,
                    thinking: m.effort ?? "",
                    effortMode: m.effortMode,
                    effortEvidence: m.effortEvidence ?? "",
                  });
                }}
              >
                <option value="">(pilih)</option>
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Level">
              <Select value={draft.level} onChange={(v) => setDraft({ ...draft, level: v as Level })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Provider">
              <input
                value={draft.provider}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
            <Field label="Model">
              <input
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
            <Field label="Thinking">
              <input
                value={draft.thinking}
                onChange={(e) => setDraft({ ...draft, thinking: e.target.value })}
                placeholder="off / low / high / max"
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
            <Field label="Mode effort">
              <Select value={draft.effortMode} onChange={(v) => setDraft({ ...draft, effortMode: v as Brain["effortMode"] })}>
                <option value="guaranteed">guaranteed — terukur mengubah perilaku</option>
                <option value="preference">preference — diterima lalu diabaikan</option>
              </Select>
            </Field>
            <Field
              label="Bukti effort"
              hint={draft.effortMode === "preference" ? "Wajib untuk preference: klaim tanpa alasan tidak bisa ditinjau ulang." : undefined}
            >
              <input
                value={draft.effortEvidence}
                onChange={(e) => setDraft({ ...draft, effortEvidence: e.target.value })}
                placeholder="n=3: off 533 vs high 316 token"
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
            <Field label="Kategori" hint="Kosongkan agar bisa dipakai semua kategori.">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder="coding / analysis / review"
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button disabled={busy || !draft.name || !draft.provider || !draft.model} onClick={create}>
              Tambah Brain
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// --- Role Map ----------------------------------------------------------------

export function SemanggiRoleMapPanel() {
  const { data, error, reload } = useAsync(() => semanggi.roleLevels(), []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const overrides = useMemo(() => {
    const map = new Map<string, Level>();
    for (const o of data?.overrides ?? []) map.set(`${o.template}/${o.role}`, o.level);
    return map;
  }, [data]);

  const set = async (template: string, role: string, level: Level) => {
    setBusy(true);
    setSaveError(null);
    try {
      await semanggi.setRoleLevel(template, role, level);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}

      <Notice tone="info">
        Profil project memetakan ke level:{" "}
        {Object.entries(data?.profileMapping ?? {})
          .map(([p, l]) => `${p} → ${l}`)
          .join(" · ")}
        . Baris di bawah menimpanya untuk role tertentu — Learner dan Reviewer lazim naik satu tingkat, karena pekerjaan
        mereka menilai dan memadatkan.
      </Notice>

      {Object.entries(data?.defaults ?? {}).map(([template, roles]) => (
        <Card key={template} title={template} subtitle={`${Object.keys(roles).length} role`}>
          <div className="space-y-1">
            {Object.entries(roles).map(([role, templateDefault]) => {
              const override = overrides.get(`${template}/${role}`);
              const effective = override ?? templateDefault ?? null;
              return (
                <div key={role} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{role}</span>
                    {templateDefault ? (
                      <Badge tone="neutral">bawaan {templateDefault}</Badge>
                    ) : (
                      <Badge tone="neutral">ikut profil project</Badge>
                    )}
                    {override ? <Badge tone="info">disetel admin</Badge> : null}
                  </div>
                  <Select value={effective ?? ""} onChange={(v) => v && set(template, role, v as Level)} disabled={busy}>
                    <option value="">(ikut profil project)</option>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

// --- Brain Map ---------------------------------------------------------------

export function SemanggiBrainMapPanel() {
  const { data, error, reload } = useAsync(() => semanggi.brainMap(), []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pinned = useMemo(() => {
    const map = new Map<string, BrainMap["mappings"][number]>();
    for (const m of data?.mappings ?? []) map.set(`${m.template}/${m.role}`, m);
    return map;
  }, [data]);

  const set = async (template: string, role: string, brainId: string | null) => {
    setBusy(true);
    setSaveError(null);
    try {
      await semanggi.setBrainMapping(template, role, brainId);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stale = (data?.mappings ?? []).filter((m) => m.stale);

  return (
    <div className="space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}

      <Notice tone="info">
        Memaku Brain tidak menimpa level. Brain yang levelnya di bawah kebutuhan role akan diabaikan saat dispatch —
        memakainya diam-diam adalah penurunan kualitas yang tidak diminta siapa pun.
      </Notice>

      {stale.length > 0 ? (
        <Notice tone="danger">
          {stale.length} pemetaan tidak akan pernah dipakai: {stale.map((m) => `${m.template}/${m.role}`).join(", ")}.
          Brain-nya hilang, dimatikan, atau levelnya di bawah kebutuhan role.
        </Notice>
      ) : null}

      {Object.entries(data?.roles ?? {}).map(([template, roles]) => (
        <Card key={template} title={template}>
          <div className="space-y-1">
            {roles.map((role) => {
              const mapping = pinned.get(`${template}/${role}`);
              const notInAgentOs = (data?.rolesNotInAgentOs ?? []).includes(role);
              return (
                <div key={role} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{role}</span>
                    {/* Role yang tidak disediakan template AgentOS mana pun
                        harus ditambahkan tangan sebelum pemetaannya berguna. */}
                    {notInAgentOs ? <Badge tone="warning">tidak ada di AgentOS — tambahkan manual</Badge> : null}
                    {mapping?.roleLevel ? <Badge tone="neutral">butuh {mapping.roleLevel}</Badge> : null}
                    {mapping?.stale ? <Badge tone="danger">tidak terpakai</Badge> : null}
                  </div>
                  <Select
                    value={mapping?.brainId ?? ""}
                    disabled={busy}
                    onChange={(v) => set(template, role, v || null)}
                    className="min-w-[16rem]"
                  >
                    <option value="">(pilih dari kandidat level)</option>
                    {(data?.brains ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} — {b.level}
                        {b.category ? ` · ${b.category}` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
