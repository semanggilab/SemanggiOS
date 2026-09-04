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
  type ProjectRoleLevel,
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
        {busy ? "Registering…" : `Register ${workspace.name} to Semanggi`}
      </Button>
    </div>
  );
}

function ProjectRow({
  project,
  onEdit,
}: {
  project: { id: string; name: string; workspacePath: string | null; template: string; profile: Profile };
  onEdit: (project: { id: string; name: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{project.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{project.id}</code>
          <Badge tone="neutral">{project.template}</Badge>
          <Badge tone="neutral">{project.profile}</Badge>
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{project.workspacePath ?? "—"}</div>
      </div>
      <Button size="sm" onClick={() => onEdit(project)}>
        Edit
      </Button>
    </div>
  );
}

/**
 * "Project Role Level" — the modal both "Register …" and "Edit" open.
 *
 * Saving snapshots the full role→level mapping as the project's OWN config
 * (it wins over the global Role Level Map from then on) and sets the
 * project's profile in the same stroke, so the decomposition a WORK request
 * performs is decided entirely here — no second save somewhere else.
 *
 * The role list is what the project actually registered (template roles plus
 * any worker roles beyond the template), and each row shows the brain the
 * effective level maps to, so the consequence of a level change is visible
 * before saving, not after dispatch.
 */
function ProjectRoleLevelModal({
  projectId,
  projectName,
  onClose,
  onSaved,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const currentProfile = profile ?? "balanced";
  const { data, error, reload } = useAsync(() => semanggi.projectRoleLevels(projectId, currentProfile), [currentProfile]);
  // The Brain Map powers the live brain column: when the operator changes a
  // level dropdown, the brain for the NEW level must be visible immediately —
  // showing "none"/blank until save reads as "this level has no brain", which
  // is exactly the confusion that produced the 2026-09-04 gap report. The
  // resolution order below mirrors brainMap.resolve(): pin > grid default >
  // first candidate of the level.
  const { data: brainMapData } = useAsync(() => semanggi.brainMap(), []);
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resolveBrain = (template: string, role: string, level: Level) => {
    if (!brainMapData) return null;
    const pin = brainMapData.mappings.find((m) => m.template === template && m.role === role && m.level === level);
    if (pin?.brainName) return pin.brainName;
    const defaultName = brainMapData.defaults?.[template]?.[role]?.[level] ?? null;
    if (defaultName && brainMapData.brains.some((b) => b.name === defaultName)) return defaultName;
    return brainMapData.brains
      .filter((b) => b.level === level)
      .sort((a, b) => a.name.localeCompare(b.name))[0]?.name ?? null;
  };

  const effectiveLevel = (row: ProjectRoleLevel): Level => draft[row.role] ?? row.level;
  const dirty = Object.keys(draft).length > 0 || (data && profile !== null && profile !== data.profile);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const rows = data.roles.map((r) => ({ role: r.role, level: effectiveLevel(r) }));
      await semanggi.putProjectRoleLevels(projectId, { profile: currentProfile, roleLevels: rows });
      setDraft({});
      await onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Project Role Level — ${projectName}`} onClose={onClose}>
      {error ? <LoadError error={error} onRetry={reload} /> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      {!data ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Field label="Profile">
              <Select
                value={currentProfile}
                onChange={(v) => {
                  setProfile(v as Profile);
                  setDraft({});
                }}
              >
                {(data.profiles ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            {data.hasOwnMapping ? (
              <Badge tone="info">own mapping — wins over the global Role Map</Badge>
            ) : (
              <Badge tone="neutral">follows the global Role Map until saved</Badge>
            )}
          </div>

          <Notice tone="info">
            Levels default from the Role Level Map for ({data.template}, {currentProfile}); saving stores them as this
            project&apos;s own configuration. The brain column is what each level maps to via the Brain Map.
          </Notice>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Role</th>
                  <th className="px-2 py-1 font-medium">Level</th>
                  <th className="px-2 py-1 font-medium">Brain</th>
                </tr>
              </thead>
              <tbody>
                {data.roles.map((row) => {
                  const level = effectiveLevel(row);
                  const changed = level !== row.level;
                  const brainName = changed ? resolveBrain(data.template, row.role, level) : row.brain?.name ?? null;
                  return (
                    <tr key={row.role} className="border-b border-border/50">
                      <td className="px-2 py-1">
                        {row.role}
                        {row.projectOverride && !changed ? <Badge tone="info">override</Badge> : null}
                        {changed ? <Badge tone="warning">edited</Badge> : null}
                      </td>
                      <td className="px-2 py-1">
                        <Select value={level} onChange={(v) => setDraft((d) => ({ ...d, [row.role]: v as Level }))}>
                          {LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {brainName ?? <span title="No brain resolves at this level — pin one in the Brain Map">none</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="link" className="text-primary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={saving || !dirty} onClick={save}>
              {saving ? "Saving…" : "Save project configuration"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
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
  const [modal, setModal] = useState<{ projectId: string; projectName: string } | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("workspace");

  // Registering and editing open the SAME modal: a project that was just
  // registered has the same right to its own role levels as one that existed
  // for months, and the register button would otherwise promise a second
  // configuration step that never comes.
  const register = async (workspace: AgentOsWorkspaceRef) => {
    setRegisteringId(workspace.id);
    setRegisterError(null);
    try {
      const res = await semanggi.createProject({ name: workspace.name, workspacePath: workspace.path });
      await reload();
      setModal({ projectId: res.project.id, projectName: res.project.name });
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
      {registerError ? <Notice tone="danger">{registerError}</Notice> : null}

      <Notice tone="info">
        Each project carries its own role levels: the profile and per-role dropdowns in the modal decide how every WORK
        request decomposes for that project alone, overriding the global Role Level Map once saved.{" "}
        {PROFILES.map((p) => `${p}: ${PROFILE_HINT[p]}`).join(" ")}
      </Notice>

      <Card
        title="Project"
        subtitle="Per-project role levels override the global map. AgentOS workspaces without a matching project yet appear here too, ready to register."
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
              <ProjectRow
                key={project.id}
                project={project}
                onEdit={({ id, name }) => setModal({ projectId: id, projectName: name })}
              />
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

      {modal ? (
        <ProjectRoleLevelModal
          projectId={modal.projectId}
          projectName={modal.projectName}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      ) : null}
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
  mode: string;
  acpAgent: string;
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
  mode: "interactive",
  acpAgent: "",
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
                    mode: m.mode ?? "interactive",
                    acpAgent: m.acpAgent ?? "",
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

          {draft.provider === "claude-code" ? (
            <>
              <Field
                label="Mode"
                hint="How the harness runs: interactive (live session), acp (ACP session), or batch (one-shot)."
              >
                <Select value={draft.mode} onChange={(v) => setDraft({ ...draft, mode: v })}>
                  <option value="interactive">interactive</option>
                  <option value="acp">acp</option>
                  <option value="batch">batch</option>
                </Select>
              </Field>

              <Field
                label="ACP Agent"
                hint="The acpx agent name that pins the harness model (routing.json). Required for claude-code brains to reach the right harness."
              >
                <input
                  value={draft.acpAgent}
                  onChange={(e) => setDraft({ ...draft, acpAgent: e.target.value })}
                  placeholder="claude-opus"
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
            </>
          ) : null}

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
          mode: brain.mode ?? "interactive",
          acpAgent: brain.acpAgent ?? "",
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
      mode: draft.mode,
      acpAgent: draft.acpAgent || null,
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
      mode: draft.mode,
      acpAgent: draft.acpAgent || null,
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

  const profiles: Profile[] = data?.profiles ?? PROFILES;

  // Keyed by (template, profile, role) — the grid's cells.
  const overrides = useMemo(() => {
    const map = new Map<string, Level>();
    for (const o of data?.overrides ?? []) map.set(`${o.template}/${o.profile}/${o.role}`, o.level);
    return map;
  }, [data]);

  const set = async (template: string, profile: Profile, role: string, level: Level | null) => {
    setBusy(true);
    setSaveError(null);
    try {
      await semanggi.setRoleLevel(template, profile, role, level);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Roles per template, unioned across profiles — the row set of the grid.
  const templateRows = useMemo(() => {
    const out: Array<[string, string[]]> = [];
    for (const [template, byProfile] of Object.entries(data?.defaults ?? {})) {
      const roles = new Set<string>();
      for (const mapping of Object.values(byProfile ?? {})) for (const role of Object.keys(mapping ?? {})) roles.add(role);
      out.push([template, [...roles]]);
    }
    return out;
  }, [data]);

  return (
    <div className="w-full space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}

      <Notice tone="info">
        Defaults are per (template, profile, role): a (software, fast) project and a (software, quality) project are
        different needs, so the same role may think at a different tier in each. Each cell below is a dropdown; a cell
        you have overridden shows a reset link. Projects can still win over this map — see Project.
      </Notice>

      {templateRows.map(([template, roles]) => (
        <Card key={template} title={template} subtitle={`${roles.length} roles × ${profiles.length} profiles`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Role</th>
                  {profiles.map((p) => (
                    <th key={p} className="px-2 py-1 font-medium">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role} className="border-b border-border/50">
                    <td className="px-2 py-1">{role}</td>
                    {profiles.map((profile) => {
                      const key = `${template}/${profile}/${role}`;
                      const override = overrides.get(key) ?? null;
                      const fallback = (data?.defaults?.[template]?.[profile]?.[role] as Level | undefined) ?? null;
                      const effective = override ?? fallback;
                      return (
                        <td key={profile} className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <Select
                              value={effective ?? ""}
                              disabled={busy}
                              onChange={(v) => v && set(template, profile, role, v as Level)}
                            >
                              {LEVELS.map((l) => (
                                <option key={l} value={l}>
                                  {l}
                                </option>
                              ))}
                            </Select>
                            {override ? (
                              <Button
                                size="sm"
                                variant="link"
                                className="text-primary"
                                disabled={busy}
                                title={`Reset to default (${fallback ?? "profile"})`}
                                onClick={() => set(template, profile, role, null)}
                              >
                                ×
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
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

  const levels: Level[] = data?.levels ?? LEVELS;

  // Pinned cells, keyed by (template, role, level) — one pin per grid cell.
  const pinned = useMemo(() => {
    const map = new Map<string, BrainMap["mappings"][number]>();
    for (const m of data?.mappings ?? []) map.set(`${m.template}/${m.role}/${m.level}`, m);
    return map;
  }, [data]);

  const brainByName = useMemo(() => new Map((data?.brains ?? []).map((b) => [b.name, b])), [data]);

  const set = async (template: string, role: string, level: Level, brainId: string | null) => {
    setBusy(true);
    setSaveError(null);
    try {
      await semanggi.setBrainMapping(template, role, level, brainId);
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
        The grid pins which Brain each (role, level) cell uses. Unpinned cells follow the grid defaults, then the level
        candidates. A brain whose own class is below the cell&apos;s level is used but marked{" "}
        <span className="font-medium">below level</span> — an explicit operator choice, never a silent downgrade.
      </Notice>

      {stale.length > 0 ? (
        <Notice tone="danger">
          {stale.length} pin(s) point at a brain that no longer exists and will never run:{" "}
          {stale.map((m) => `${m.template}/${m.role}/${m.level}`).join(", ")}. Clear them or pick a live brain.
        </Notice>
      ) : null}

      {Object.entries(data?.roles ?? {}).map(([template, roles]) => (
        <Card key={template} title={template} subtitle={`${roles.length} roles × ${levels.length} levels`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Role</th>
                  {levels.map((l) => (
                    <th key={l} className="px-2 py-1 font-medium">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role} className="border-b border-border/50">
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        {role}
                        {(data?.rolesNotInAgentOs ?? []).includes(role) ? (
                          <Badge tone="warning">not in AgentOS</Badge>
                        ) : null}
                      </div>
                    </td>
                    {levels.map((level) => {
                      const pin = pinned.get(`${template}/${role}/${level}`);
                      const defaultName = data?.defaults?.[template]?.[role]?.[level] ?? null;
                      const defaultBrain = defaultName ? brainByName.get(defaultName) : undefined;
                      // The value the cell resolves to right now: a live pin,
                      // else the grid default (when its brain exists here),
                      // else the level candidates — shown as "(auto)".
                      const value = pin?.brainId ?? defaultBrain?.id ?? "";
                      return (
                        <td key={level} className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <Select
                              value={value}
                              disabled={busy}
                              onChange={(v) => set(template, role, level, v || null)}
                              className="min-w-[10rem]"
                            >
                              <option value="">
                                {defaultBrain ? `default: ${defaultName}` : "(auto from level)"}
                              </option>
                              {(data?.brains ?? []).map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name} — {b.level}
                                </option>
                              ))}
                            </Select>
                            {pin?.belowLevel ? <Badge tone="warning">below level</Badge> : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
