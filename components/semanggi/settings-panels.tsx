"use client";

// Four Semanggi settings panels: Project, Role Map, Brains, Brain Map.
//
// Each answers a different question, in order:
//
//   Project    "what template and profile does this project decompose with?"
//   Role Map   "how expensive is each role allowed to think?"
//   Brains     "which (model + effort) combinations do we have?"
//   Brain Map  "at that level, which Brain for this role?"
//
// Project comes first because the other three only matter once a project
// exists to apply them to. Brain Map can't be filled in before Brains exist,
// and its level has no meaning before Role Map is set — so those two keep
// their original relative order.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  semanggi,
  type Brain,
  type BrainMap,
  type CatalogModel,
  type GatewayModel,
  type Level,
  type Profile,
  type ThinkingLevelEntry,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Combobox, Empty, Field, LoadError, Modal, Notice, Select } from "./ui";

const LEVELS: Level[] = ["low", "normal", "critical"];
const PROFILES: Profile[] = ["fast", "balanced", "quality"];

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

// --- Project -------------------------------------------------------------------

const PROFILE_HINT: Record<Profile, string> = {
  fast: "Cheaper, quicker phases — use for small or low-stakes work.",
  balanced: "The default: normal-level phases unless a role's template default says otherwise.",
  quality: "Every phase without a template default runs at the critical level.",
};

function ProjectRow({
  project,
  busy,
  onSave,
}: {
  project: { id: string; name: string; workspacePath: string | null; template: string; profile: Profile };
  busy: boolean;
  onSave: (id: string, profile: Profile) => Promise<void>;
}) {
  const [profile, setProfile] = useState<Profile>(project.profile);
  const [saving, setSaving] = useState(false);
  const dirty = profile !== project.profile;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(project.id, profile);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{project.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{project.id}</code>
          <Badge tone="neutral">{project.template}</Badge>
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{project.workspacePath ?? "—"}</div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={profile} onChange={(v) => setProfile(v as Profile)} disabled={busy || saving}>
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={busy || saving || !dirty} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Project settings: template and profile move here from the Control page
 * (D37). Any team member can change a project's profile — the shared-token
 * attribution (§8.4) means every action from this UI is already one identity,
 * so there is no separate operator/admin gate to enforce here.
 *
 * Template is shown but not editable from this panel: it isn't synced from
 * AgentOS's own project template yet (that discovery task is still open), so
 * changing it here would be editing a value this UI doesn't actually own.
 */
export function SemanggiProjectsPanel() {
  const { data, error, reload } = useAsync(() => semanggi.projects(), []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (id: string, profile: Profile) => {
    setBusy(true);
    setSaveError(null);
    try {
      await semanggi.updateProjectSettings(id, { profile });
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
        Profile sets the default thinking level for every phase a WORK request creates in that project, unless a role
        has its own template default (see Role Map) or an operator overrides it per task.
        {" "}
        {PROFILES.map((p) => `${p}: ${PROFILE_HINT[p]}`).join(" ")}
      </Notice>

      <Card title="Project" subtitle="Sets the default decomposition profile for every WORK request in this project.">
        {!data || data.projects.length === 0 ? (
          <Empty>No projects yet.</Empty>
        ) : (
          <div>
            {data.projects.map((project) => (
              <ProjectRow key={project.id} project={project} busy={busy} onSave={save} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Brain -------------------------------------------------------------------

type BrainDraft = {
  name: string;
  provider: string;
  model: string;
  thinking: string;
  effortMode: Brain["effortMode"];
  effortEvidence: string;
  level: Level;
  category: string;
  description: string;
  enabled: boolean;
};

const EMPTY_DRAFT: BrainDraft = {
  name: "",
  provider: "",
  model: "",
  thinking: "",
  effortMode: "guaranteed",
  effortEvidence: "",
  level: "normal",
  category: "",
  description: "",
  enabled: true,
};

function TestConnectionButton({ brainId }: { brainId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await semanggi.testBrain(brainId);
      if (res.ok) {
        setResult({ ok: true, message: `OK${res.latencyMs ? ` · ${res.latencyMs}ms` : ""}` });
      } else {
        setResult({ ok: false, message: res.message ?? res.error ?? res.reason ?? "Test failed" });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={run}>
        {busy ? "Testing…" : "Test connection"}
      </Button>
      {result ? (
        <span className={`max-w-[14rem] truncate text-[10px] ${result.ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`} title={result.message}>
          {result.message}
        </span>
      ) : null}
    </div>
  );
}

function BrainFormModal({
  mode,
  initial,
  models,
  gatewayModels,
  onRefreshModels,
  thinkingLevels,
  onRefreshLevels,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: BrainDraft;
  models: CatalogModel[];
  gatewayModels: GatewayModel[];
  onRefreshModels: () => void;
  thinkingLevels: ThinkingLevelEntry[];
  onRefreshLevels: () => void;
  onClose: () => void;
  onSubmit: (draft: BrainDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BrainDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [refreshingLevels, setRefreshingLevels] = useState(false);

  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of gatewayModels) if (m.provider) set.add(m.provider);
    for (const m of models) if (m.provider) set.add(m.provider);
    return Array.from(set).sort();
  }, [gatewayModels, models]);

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of gatewayModels) {
      if (!draft.provider || m.provider === draft.provider) set.add(m.id);
    }
    for (const m of models) {
      if (!draft.provider || m.provider === draft.provider) set.add(m.model);
    }
    return Array.from(set).sort();
  }, [gatewayModels, models, draft.provider]);

  const levelOptions = useMemo(() => {
    const entry = thinkingLevels.find((t) => t.provider === draft.provider && t.model === draft.model);
    return entry?.levels ?? [];
  }, [thinkingLevels, draft.provider, draft.model]);

  const levelEvidence = thinkingLevels.find((t) => t.provider === draft.provider && t.model === draft.model);

  const refreshModels = async () => {
    setRefreshingModels(true);
    try {
      await onRefreshModels();
    } finally {
      setRefreshingModels(false);
    }
  };

  const refreshLevels = async () => {
    setRefreshingLevels(true);
    try {
      await onRefreshLevels();
    } finally {
      setRefreshingLevels(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const immutable = mode === "edit";

  return (
    <Modal
      title={mode === "create" ? "Add Brain" : `Edit Brain — ${initial.name}`}
      subtitle={immutable ? "Provider and model can't be changed after creation — agents are provisioned against them." : undefined}
      onClose={onClose}
    >
      <div className="space-y-3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name">
            <input
              value={draft.name}
              disabled={immutable}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="glm-5.2-max"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          </Field>

          {mode === "create" ? (
            <Field label="Copy from catalog" hint="Fills provider, model and effort at once.">
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
                <option value="">(choose)</option>
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

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
            <div className="flex items-center gap-2">
              <Combobox
                value={draft.provider}
                disabled={immutable}
                onChange={(v) => setDraft({ ...draft, provider: v, model: "" })}
                options={providerOptions}
                placeholder="zai / google / groq"
              />
            </div>
          </Field>

          <Field label="Model">
            <div className="flex items-center gap-2">
              <Combobox
                value={draft.model}
                disabled={immutable}
                onChange={(v) => setDraft({ ...draft, model: v })}
                options={modelOptions}
                placeholder="glm-5.2"
              />
              {!immutable ? (
                <Button size="sm" variant="outline" disabled={refreshingModels} onClick={refreshModels} title="Refresh models from the gateway">
                  {refreshingModels ? "…" : "Refresh Models"}
                </Button>
              ) : null}
            </div>
          </Field>

          <Field
            label="Thinking"
            hint={
              levelEvidence?.evidence
                ? levelEvidence.evidence
                : levelOptions.length === 0
                  ? "No measured levels yet for this model — type one manually or run Refresh Levels."
                  : undefined
            }
          >
            <div className="flex items-center gap-2">
              <Combobox
                value={draft.thinking}
                onChange={(v) => setDraft({ ...draft, thinking: v })}
                options={levelOptions}
                placeholder="off / low / high / max"
              />
              <Button size="sm" variant="outline" disabled={refreshingLevels} onClick={refreshLevels} title="Refresh the measured thinking-level catalog">
                {refreshingLevels ? "…" : "Refresh Levels"}
              </Button>
            </div>
          </Field>

          <Field label="Effort mode">
            <Select value={draft.effortMode} onChange={(v) => setDraft({ ...draft, effortMode: v as Brain["effortMode"] })}>
              <option value="guaranteed">guaranteed — measurably changes behavior</option>
              <option value="preference">preference — accepted, then ignored</option>
            </Select>
          </Field>

          <Field
            label="Effort evidence"
            hint={draft.effortMode === "preference" ? "Required for preference: an unsupported claim can't be reviewed later." : undefined}
          >
            <input
              value={draft.effortEvidence}
              onChange={(e) => setDraft({ ...draft, effortEvidence: e.target.value })}
              placeholder="n=3: off 533 vs high 316 tokens"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="Category" hint="Leave blank to allow every category.">
            <input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="coding / analysis / review"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="Description">
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          {mode === "edit" ? (
            <Field label="Enabled">
              <Select value={draft.enabled ? "true" : "false"} onChange={(v) => setDraft({ ...draft, enabled: v === "true" })}>
                <option value="true">enabled</option>
                <option value="false">disabled</option>
              </Select>
            </Field>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !draft.name || !draft.provider || !draft.model} onClick={submit}>
            {mode === "create" ? "Add Brain" : "Save changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SemanggiBrainsPanel() {
  const { data, error, reload } = useAsync(() => semanggi.brains(), []);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [gatewayModels, setGatewayModels] = useState<GatewayModel[]>([]);
  const [thinkingLevels, setThinkingLevels] = useState<ThinkingLevelEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; brain: Brain | null } | null>(null);

  useEffect(() => {
    semanggi.models().then((m) => setModels(m.models)).catch(() => setModels([]));
    semanggi.gatewayModels().then((m) => setGatewayModels(m.models)).catch(() => setGatewayModels([]));
    semanggi.thinkingLevels().then((r) => setThinkingLevels(r.levels)).catch(() => setThinkingLevels([]));
  }, []);

  const refreshGatewayModels = useCallback(async () => {
    const m = await semanggi.gatewayModels().catch(() => ({ models: [] }));
    setGatewayModels(m.models);
  }, []);

  const refreshThinkingLevelsList = useCallback(async () => {
    await semanggi.refreshThinkingLevels().catch(() => null);
    const r = await semanggi.thinkingLevels().catch(() => ({ levels: [] }));
    setThinkingLevels(r.levels);
  }, []);

  const toggle = async (brain: Brain) => {
    setBusy(true);
    try {
      await semanggi.updateBrain(brain.id, { enabled: !brain.enabled });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const draftFor = (brain: Brain | null): BrainDraft =>
    brain
      ? {
          name: brain.name,
          provider: brain.provider,
          model: brain.model,
          thinking: brain.thinking ?? "",
          effortMode: brain.effortMode,
          effortEvidence: brain.effortEvidence ?? "",
          level: brain.level,
          category: brain.category ?? "",
          description: brain.description ?? "",
          enabled: brain.enabled,
        }
      : EMPTY_DRAFT;

  const submitCreate = async (draft: BrainDraft) => {
    await semanggi.createBrain({
      ...draft,
      thinking: draft.thinking || null,
      category: draft.category || null,
      effortEvidence: draft.effortEvidence || null,
    });
    await reload();
  };

  const submitEdit = async (id: string, draft: BrainDraft) => {
    await semanggi.updateBrain(id, {
      level: draft.level,
      category: draft.category || null,
      description: draft.description,
      thinking: draft.thinking || null,
      effortMode: draft.effortMode,
      effortEvidence: draft.effortEvidence || null,
      enabled: draft.enabled,
    });
    await reload();
  };

  return (
    <div className="space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}

      <Card
        title="Brain"
        subtitle="Named (provider, model, thinking, effort) combinations that can be mapped to roles."
        actions={
          <Button size="sm" onClick={() => setModal({ mode: "create", brain: null })}>
            + Add Brain
          </Button>
        }
      >
        {!data || data.brains.length === 0 ? (
          <Empty>No Brains yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Name", "Model", "Effort", "Level", "Category", "Availability", ""].map((h) => (
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
                          {/* An effort claim the provider doesn't actually apply
                              (D31) is a lie paid for twice: once in the routing
                              decision, once when the result doesn't match the
                              price. So it's flagged, not hidden. */}
                          {brain.effortMode === "preference" ? (
                            <Badge tone="warning">not enforced</Badge>
                          ) : (
                            <Badge tone="success">enforced</Badge>
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
                    <td className="px-2 py-1">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setModal({ mode: "edit", brain })}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(brain)}>
                          {brain.enabled ? "Disable" : "Enable"}
                        </Button>
                        <TestConnectionButton brainId={brain.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal ? (
        <BrainFormModal
          mode={modal.mode}
          initial={draftFor(modal.brain)}
          models={models}
          gatewayModels={gatewayModels}
          onRefreshModels={refreshGatewayModels}
          thinkingLevels={thinkingLevels}
          onRefreshLevels={refreshThinkingLevelsList}
          onClose={() => setModal(null)}
          onSubmit={(draft) => (modal.mode === "create" ? submitCreate(draft) : submitEdit(modal.brain!.id, draft))}
        />
      ) : null}
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
        Project profiles map to a level:{" "}
        {Object.entries(data?.profileMapping ?? {})
          .map(([p, l]) => `${p} → ${l}`)
          .join(" · ")}
        . The rows below override that for a specific role — Learner and Reviewer commonly go up one tier, since their
        work is to judge and condense.
      </Notice>

      {Object.entries(data?.defaults ?? {}).map(([template, roles]) => (
        <Card key={template} title={template} subtitle={`${Object.keys(roles).length} roles`}>
          <div className="space-y-1">
            {Object.entries(roles).map(([role, templateDefault]) => {
              const override = overrides.get(`${template}/${role}`);
              const effective = override ?? templateDefault ?? null;
              return (
                <div key={role} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{role}</span>
                    {templateDefault ? (
                      <Badge tone="neutral">default {templateDefault}</Badge>
                    ) : (
                      <Badge tone="neutral">follows project profile</Badge>
                    )}
                    {override ? <Badge tone="info">admin override</Badge> : null}
                  </div>
                  <Select value={effective ?? ""} onChange={(v) => v && set(template, role, v as Level)} disabled={busy}>
                    <option value="">(follow project profile)</option>
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
        Pinning a Brain never overrides the level requirement. A Brain whose level is below what the role needs is
        ignored at dispatch time — silently using it would be an unrequested quality downgrade.
      </Notice>

      {stale.length > 0 ? (
        <Notice tone="danger">
          {stale.length} mapping(s) will never be used: {stale.map((m) => `${m.template}/${m.role}`).join(", ")}. The
          Brain is missing, disabled, or its level is below what the role needs.
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
                    {/* A role not provided by any AgentOS template must be added
                        by hand before its mapping does anything. */}
                    {notInAgentOs ? <Badge tone="warning">not in AgentOS — add manually</Badge> : null}
                    {mapping?.roleLevel ? <Badge tone="neutral">needs {mapping.roleLevel}</Badge> : null}
                    {mapping?.stale ? <Badge tone="danger">unused</Badge> : null}
                  </div>
                  <Select
                    value={mapping?.brainId ?? ""}
                    disabled={busy}
                    onChange={(v) => set(template, role, v || null)}
                    className="min-w-[16rem]"
                  >
                    <option value="">(choose from level candidates)</option>
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
