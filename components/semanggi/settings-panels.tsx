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
import { MessageSquare } from "lucide-react";
import {
  semanggi,
  type Brain,
  type BrainMap,
  type BrainTestResult,
  type CatalogModel,
  type GatewayModel,
  type Level,
  type Profile,
  type ThinkingLevelEntry,
  type ThinkingProbeSample,
  type ThinkingProbeStatus,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Combobox, Empty, Field, LoadError, Modal, Notice, Select } from "./ui";

const LEVELS: Level[] = ["low", "normal", "critical"];
const PROFILES: Profile[] = ["fast", "balanced", "quality"];

// Mirrors CANDIDATE_LEVELS in thinking-probe.mjs — used only to show
// progress ("3/7 levels probed"), never to decide what gets sent.
const PROBE_CANDIDATE_LEVELS = ["off", "minimal", "low", "medium", "high", "max", "adaptive"];

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

/**
 * "Register to Semanggi" — the other direction of task #4's discovery work
 * (still open): until AgentOS's own workspaces sync into Semanggi
 * automatically, this is the manual bridge for one workspace at a time.
 * Registering just calls the existing POST /api/work/projects with the
 * workspace's own name and path — the same endpoint the Project row already
 * reads from — so a freshly registered workspace immediately turns into an
 * ordinary `ProjectRow` in the same list, with defaulted template/profile.
 *
 * Rendered as a row of the SAME "Project" list as registered projects
 * (not a separate card): a project the operator hasn't registered yet is
 * still an entry in "what projects could this be", not a different kind of
 * information that deserves its own section.
 */
function UnregisteredProjectRow({
  workspace,
  busy,
  onRegister,
}: {
  workspace: AgentOsWorkspaceRef;
  busy: boolean;
  onRegister: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{workspace.name}</span>
          <Badge tone="neutral">not registered</Badge>
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{workspace.path}</div>
      </div>
      <Button size="sm" disabled={busy} onClick={onRegister}>
        {busy ? "Registering…" : "Register to Semanggi"}
      </Button>
    </div>
  );
}

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
 *
 * `activeWorkspacePath` scopes the list to the workspace AgentOS currently
 * has selected, exactly like the Summary page's "Active Project"/"All
 * projects" toggle — same prop, same match-by-path-prefix, same default. A
 * settings page listing every project across every workspace by default
 * reads as "here is all of Semanggi", but a Brain/Role-Map/Brain-Map panel
 * right next to it is already scoped that way implicitly (there's only ever
 * one of each); Project is the one panel with a naturally per-workspace list,
 * so it gets the explicit toggle the other three don't need.
 */
export type AgentOsWorkspaceRef = { id: string; name: string; path: string };

export function SemanggiProjectsPanel({
  activeWorkspacePath,
  agentosWorkspaces,
}: {
  activeWorkspacePath?: string | null;
  agentosWorkspaces?: AgentOsWorkspaceRef[];
}) {
  const { data, error, reload } = useAsync(() => semanggi.projects(), []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("workspace");

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

  const register = async (workspace: AgentOsWorkspaceRef) => {
    setRegisteringId(workspace.id);
    setRegisterError(null);
    try {
      await semanggi.createProject({ name: workspace.name, workspacePath: workspace.path });
      await reload();
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegisteringId(null);
    }
  };

  const inScope = useCallback(
    (path: string | null) => {
      if (scope === "all" || !activeWorkspacePath) return true;
      return Boolean(path && (path === activeWorkspacePath || path.startsWith(`${activeWorkspacePath}/`)));
    },
    [scope, activeWorkspacePath],
  );

  const visibleProjects = useMemo(() => (data?.projects ?? []).filter((p) => inScope(p.workspacePath)), [data, inScope]);

  // An AgentOS workspace "is" a Semanggi project once some project's own
  // workspacePath matches it exactly — the same relationship Summary/Control
  // already read the other way round (matching a project to the active
  // workspace by path). Not registered yet is the common case for any
  // workspace nobody has run Semanggi work in — it isn't an error, just the
  // reason the register button below exists. Scoped by the same Active
  // Workspace/All Workspaces toggle as registered projects, since both now
  // live in the same "Project" list.
  const unregisteredWorkspaces = useMemo(() => {
    const registeredPaths = new Set((data?.projects ?? []).map((p) => p.workspacePath).filter((p): p is string => Boolean(p)));
    return (agentosWorkspaces ?? []).filter((w) => w.path && !registeredPaths.has(w.path) && inScope(w.path));
  }, [data, agentosWorkspaces, inScope]);

  const hasAnyRows = visibleProjects.length > 0 || unregisteredWorkspaces.length > 0;

  return (
    <div className="w-full space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      {registerError ? <Notice tone="danger">{registerError}</Notice> : null}

      <Notice tone="info">
        Profile sets the default thinking level for every phase a WORK request creates in that project, unless a role
        has its own template default (see Role Map) or an operator overrides it per task.
        {" "}
        {PROFILES.map((p) => `${p}: ${PROFILE_HINT[p]}`).join(" ")}
      </Notice>

      <Card
        title="Project"
        subtitle="Sets the default decomposition profile for every WORK request in this project. AgentOS workspaces without a matching project yet appear here too, ready to register."
        actions={
          activeWorkspacePath ? (
            <Select value={scope} onChange={setScope}>
              <option value="workspace">Active Workspace</option>
              <option value="all">All Workspaces</option>
            </Select>
          ) : null
        }
      >
        {!hasAnyRows ? (
          <Empty>
            {scope === "workspace" && activeWorkspacePath
              ? "Nothing for this workspace. Choose “All Workspaces” to see the rest."
              : "No projects yet."}
          </Empty>
        ) : (
          <div>
            {visibleProjects.map((project) => (
              <ProjectRow key={project.id} project={project} busy={busy} onSave={save} />
            ))}
            {unregisteredWorkspaces.map((workspace) => (
              <UnregisteredProjectRow
                key={workspace.id}
                workspace={workspace}
                busy={registeringId === workspace.id}
                onRegister={() => register(workspace)}
              />
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

/**
 * Runs a Brain connection test and reports the result — used both as the
 * per-row action in the Brains table (against a saved Brain) and inside the
 * Add/Edit Brain form (against a draft that may not be saved yet). The two
 * differ only in which endpoint they call, so that difference is the only
 * parameter this hook takes.
 */
function useConnectionTest(run: () => Promise<BrainTestResult>) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const trigger = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await run();
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

  return { busy, result, trigger };
}

/**
 * Row action in the Brains table. The result used to print as a truncated
 * line of text under the button, which made every row a different height
 * and still cut off the interesting part of a real error. Now the button
 * only ever says "Test"/"Testing…"; the outcome lives in the message icon
 * next to it — colored to read at a glance (muted until run, green for a
 * pass, amber for a fail) — and the full text is one hover away via the
 * icon's tooltip, exactly where an operator scanning the column would look
 * for "what happened" without it competing for row height.
 */
function TestConnectionButton({ brainId }: { brainId: string }) {
  const { busy, result, trigger } = useConnectionTest(() => semanggi.testBrain(brainId));

  const resultColor = !result
    ? "text-muted-foreground/60"
    : result.ok
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";

  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="link" className="text-primary" disabled={busy} onClick={trigger}>
        {busy ? "Testing…" : "Test"}
      </Button>
      <span className={resultColor} title={result ? result.message : "Run Test to see the result here"}>
        <MessageSquare className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

/**
 * "Test Connection" inside Add/Edit Brain — verifies a (provider, model)
 * combination has a live agent bound to it BEFORE the operator commits to
 * saving it, using the same route + matching logic as the table's per-row
 * Test (POST work/brains/test, no id required yet). Here the result stays as
 * visible text rather than an icon: the form has the room, and a full
 * explanation ("no agent provisioned for zai/glm-9.9" or "no ACP agent
 * pinned") is exactly what someone about to save this Brain needs to read,
 * not hover for.
 */
function TestDraftConnectionButton({
  provider,
  model,
  thinking,
  effortMode,
}: {
  provider: string;
  model: string;
  thinking: string;
  effortMode: Brain["effortMode"];
}) {
  const { busy, result, trigger } = useConnectionTest(() =>
    semanggi.testBrainDraft({ provider, model, thinking: thinking || null, effortMode }),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !provider || !model}
        onClick={trigger}
        title="Send one throwaway prompt to a live agent already bound to this model"
        className="shrink-0 whitespace-nowrap"
      >
        {busy ? "Testing…" : "Test Connection"}
      </Button>
      {result ? (
        <span
          className={`text-[11px] ${result.ok ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}
        >
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
  onReloadLevels,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: BrainDraft;
  models: CatalogModel[];
  gatewayModels: GatewayModel[];
  onRefreshModels: () => void;
  thinkingLevels: ThinkingLevelEntry[];
  onReloadLevels: () => Promise<void>;
  onClose: () => void;
  onSubmit: (draft: BrainDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BrainDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [refreshingLevels, setRefreshingLevels] = useState(false);
  const [probeSamples, setProbeSamples] = useState<ThinkingProbeSample[] | null>(null);

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

  // Probes ONLY the (provider, model) currently in this form — never the
  // whole fleet (2026-09-01 operator decision). The server call returns
  // immediately with a background probe running; this polls its status
  // because a real probe (up to 7 real dispatches, one per candidate level)
  // can run for minutes, well past what a single HTTP request should block
  // on through the AgentOS proxy chain.
  const refreshLevels = async () => {
    if (!draft.provider || !draft.model) return;
    setRefreshingLevels(true);
    setProbeSamples(null);
    setError(null);
    try {
      const start = await semanggi.probeThinkingLevels(draft.provider, draft.model);
      if (!start.started && start.reason === "no-agent") {
        setError(
          start.status.message ??
            `No agent is currently provisioned for ${draft.provider}/${draft.model} — a probe needs a live agent bound to this model.`,
        );
        return;
      }
      let status: ThinkingProbeStatus = start.status;
      setProbeSamples(status.samples ?? []);
      // Bounded polling, not indefinite: 7 candidate levels at up to ~65s
      // each is already several minutes in the honest case, and one of the
      // documented candidates (groq/qwen3.6-27b) is known to hang on some
      // levels until the gateway's own watchdog reclaims it. This cap just
      // stops the FORM from waiting forever — the probe itself is already
      // bounded per-level on the server, and keeps running there either way.
      const deadline = Date.now() + 10 * 60 * 1000;
      while (status.running && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        status = await semanggi.thinkingProbeStatus(draft.provider, draft.model);
        setProbeSamples(status.samples ?? []);
      }
      if (status.running) {
        setError("Still probing in the background — reopen this model to see the finished result.");
      } else if (status.error) {
        setError(`Probe failed: ${status.error}`);
      }
      await onReloadLevels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      width="max-w-3xl"
    >
      <div className="space-y-3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2">
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

          <Field label="Model" className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  value={draft.model}
                  disabled={immutable}
                  onChange={(v) => setDraft({ ...draft, model: v })}
                  options={modelOptions}
                  placeholder="glm-5.2"
                />
              </div>
              {!immutable ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={refreshingModels}
                  onClick={refreshModels}
                  title="Refresh models from the gateway"
                  className="shrink-0 whitespace-nowrap"
                >
                  {refreshingModels ? "Refreshing…" : "Refresh Models"}
                </Button>
              ) : null}
            </div>
          </Field>

          <Field
            label="Thinking"
            className="sm:col-span-2"
            hint={
              levelEvidence?.evidence
                ? levelEvidence.evidence
                : levelOptions.length === 0
                  ? "No measured levels yet for this model — type one manually or run Refresh Levels."
                  : undefined
            }
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  value={draft.thinking}
                  onChange={(v) => setDraft({ ...draft, thinking: v })}
                  options={levelOptions}
                  placeholder="off / low / high / max"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={refreshingLevels || !draft.provider || !draft.model}
                onClick={refreshLevels}
                title="Dispatch real probes against this exact model on the live gateway — can take several minutes"
                className="shrink-0 whitespace-nowrap"
              >
                {refreshingLevels ? "Probing…" : "Refresh Levels"}
              </Button>
            </div>
            {refreshingLevels || probeSamples ? (
              <ProbeProgress samples={probeSamples} running={refreshingLevels} />
            ) : null}
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

        <Field label="Connection" hint="Checks that a live agent is already bound to this exact model before you save.">
          <TestDraftConnectionButton
            provider={draft.provider}
            model={draft.model}
            thinking={draft.thinking}
            effortMode={draft.effortMode}
          />
        </Field>

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

/**
 * Compact per-level readout for a probe in flight or just finished — the
 * whole point is that a probe takes real minutes (up to 7 real dispatches),
 * so the operator watching the button needs to see it's making progress,
 * not just a spinner with no information for several minutes straight.
 */
function ProbeProgress({ samples, running }: { samples: ThinkingProbeSample[] | null; running: boolean }) {
  const done = new Map((samples ?? []).map((s) => [s.level, s]));
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      {PROBE_CANDIDATE_LEVELS.map((level) => {
        const sample = done.get(level);
        const tone = !sample
          ? "neutral"
          : sample.included
            ? "success"
            : "warning";
        const label = !sample ? level : sample.included ? `${level} ✓` : `${level} ✗`;
        return (
          <Badge key={level} tone={tone as "neutral" | "success" | "warning"} title={sample?.reason ?? undefined}>
            {label}
          </Badge>
        );
      })}
      {running ? <span className="text-muted-foreground">probing…</span> : null}
    </div>
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

  // "Refresh Models" (the button): actually asks the gateway, and its answer
  // is persisted server-side so the next page load / next form open doesn't
  // have to ask again — see gateway-models.mjs.
  const refreshGatewayModels = useCallback(async () => {
    const m = await semanggi.refreshGatewayModels().catch(() => ({ models: [] }));
    setGatewayModels(m.models);
  }, []);

  // Pure reload — no probing here. The actual measurement (real dispatches
  // against the gateway, scoped to one model at a time) happens inside
  // BrainFormModal itself via semanggi.probeThinkingLevels, which knows
  // which (provider, model) the form is currently on; this just re-reads
  // whatever the DB has afterward so the dropdown picks up the new entry.
  const reloadThinkingLevels = useCallback(async () => {
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
    <div className="w-full space-y-4">
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
                        <Button size="sm" variant="link" className="text-primary" disabled={busy} onClick={() => setModal({ mode: "edit", brain })}>
                          Edit
                        </Button>
                        <Button size="sm" variant="link" className="text-primary" disabled={busy} onClick={() => toggle(brain)}>
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
          onReloadLevels={reloadThinkingLevels}
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
    <div className="w-full space-y-4">
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
    <div className="w-full space-y-4">
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
