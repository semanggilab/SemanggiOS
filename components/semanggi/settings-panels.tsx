"use client";

// Five Semanggi settings panels: Project, Role Map, Model Map, Brains, Brain Map.
//
// Each answers a different question, in order:
//
//   Project    "what template and profile does this project decompose with?"
//   Role Map   "how expensive is each role allowed to think?"
//   Model Map  "which models exist, and what is measured about them?"
//   Brains     "which (model + effort) combinations do we have?"
//   Brain Map  "at that level, which Brain for this role?"
//
// Project comes first because the other four only matter once a project
// exists to apply them to. Model Map sits before Brains because a Brain is a
// named view over a model row — the model (and its measured thinking facts)
// logically precedes the combination. Brain Map can't be filled in before
// Brains exist, and its level has no meaning before Role Map is set.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  PowerOff,
  Trash2,
} from "lucide-react";
import {
  semanggi,
  relativeTime,
  type Brain,
  type BrainMap,
  type BrainMapCell,
  type BrainSandbox,
  type BrainTestResult,
  type CatalogModel,
  type EffortMode,
  type GatewayModel,
  type Level,
  type ModelMapRow,
  type Profile,
  type ProjectRoleLevel,
  type QuotaDriverInfo,
  type ThinkingLevelEntry,
  type ThinkingProbeSample,
  type ThinkingProbeStatus,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Combobox, Empty, Field, LoadError, Modal, Notice, Select } from "./ui";

const LEVELS: Level[] = ["low", "normal", "critical"];
const PROFILES: Profile[] = ["fast", "balanced", "quality"];
// Rank for client-side belowLevel checks in the cell editor — mirrors RANK in
// the controller's brain-map.mjs.
const LEVEL_RANK: Record<Level, number> = { low: 0, normal: 1, critical: 2 };

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
    // D68: a pinned cell is an ordered list — the first member is what runs
    // while it is live; the chain behind it is named by the server's
    // brainPeers, not re-derived here.
    const cell = brainMapData.mappings.find((m) => m.template === template && m.role === role && m.level === level);
    const first = cell ? [...cell.brains].sort((a, b) => a.position - b.position)[0] : undefined;
    if (first?.brainName) return first.brainName;
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
                  // The failover chain behind the first brain (D68) — named so
                  // the column answers "and then who?", not just "who?".
                  const peers = !changed && row.brainPeers?.length ? row.brainPeers : [];
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
                        {peers.length > 0 ? (
                          <span title={`Failover order: ${peers.join(" → ")}`}> +{peers.length}</span>
                        ) : null}
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
  description: string;
  enabled: boolean;
  /** "" leaves the stored/default value alone; a numeric string stores an
   *  explicit window. Selects are string-typed because "" is the "no opinion"
   *  state and number has no such value. */
  quotaResetShortMs: string;
  quotaResetLongMs: string;
  /** Same "no opinion" convention for the D63 rate/fact columns: "" means
   *  driver default on create / keep stored on edit. */
  quotaTier: string;
  rpm: string;
  rpd: string;
  tpm: string;
  tpd: string;
  contextWindowTokens: string;
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
  description: "",
  enabled: true,
  quotaResetShortMs: "",
  quotaResetLongMs: "",
  quotaTier: "",
  rpm: "",
  rpd: "",
  tpm: "",
  tpd: "",
  contextWindowTokens: "",
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

// One tone for every test-result readout (row icon, Process Manager footer,
// draft-test line). It existed as three hand-copied ternaries once and drifted
// within a day — same result, different dark-mode shade depending on where it
// rendered — which is the whole argument for the single copy.
function testResultColor(result: { ok: boolean } | null) {
  return !result
    ? "text-muted-foreground/60"
    : result.ok
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";
}

/**
 * Row actions in the Brains table (D78): Edit collapsed to a pencil icon, and
 * everything else that used to sit beside it as a text button — Disable,
 * Test, Process Manager — lives behind one "3 dots" menu, because the row's
 * width is spoken for by the facts (quota windows, effort evidence), not by
 * three verbs. The Test outcome stays next to the menu button as the same
 * message icon the old inline button used: colored to read at a glance (muted
 * until run, green pass, amber fail), full text one hover away — never a
 * truncating line that made every row a different height.
 */
function BrainRowActions({
  brain,
  busy,
  onEdit,
  onToggle,
  onProcessManager,
}: {
  brain: Brain;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onProcessManager: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { busy: testing, result, trigger } = useConnectionTest(() => semanggi.testBrain(brain.id));

  // mousedown, not click: clicking a menu item would fire this first on the
  // button itself otherwise (it is outside the root div's button row)… it is
  // INSIDE rootRef, so the guard is really for clicks anywhere else on the
  // page — the pattern the composer's suggestion list uses for the same
  // reason: don't let the closing click also activate what it lands on.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={rootRef} className="relative flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-primary" disabled={busy} title="Edit this Brain" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        disabled={busy}
        title="More actions"
        aria-label={`More actions for ${brain.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      <span className={testResultColor(result)} title={result ? result.message : "Run Test (in the menu) to see the result here"}>
        <MessageSquare className="h-3.5 w-3.5" />
      </span>
      {open ? (
        <div className="absolute right-0 top-8 z-40 w-44 rounded-lg border border-border bg-background py-1 shadow-lg">
          <button
            type="button"
            className={itemClass}
            disabled={busy}
            title={brain.enabled ? "Stop routing new work to this Brain" : "Route work to this Brain again"}
            onClick={() => {
              setOpen(false);
              onToggle();
            }}
          >
            <PowerOff className="h-3.5 w-3.5 shrink-0" />
            {brain.enabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            className={itemClass}
            disabled={testing}
            title="Send one throwaway prompt to a live agent bound to this model"
            onClick={() => void trigger()}
          >
            {testing ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Activity className="h-3.5 w-3.5 shrink-0" />}
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            className={itemClass}
            title="List, kill, and create this Brain's gateway sandboxes"
            onClick={() => {
              setOpen(false);
              onProcessManager();
            }}
          >
            <Boxes className="h-3.5 w-3.5 shrink-0" />
            Process Manager
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Process Manager (D78): the gateway sandboxes bound to one Brain — one row
 * per live agent, kill for the idle ones, Test/Create in the footer. "Test"
 * here IS the connection test: an auto-provisioned probe agent (D65) is a new
 * sandbox, so the list reloads right after the test answers.
 */
function ProcessManagerModal({ brain, onClose }: { brain: Brain; onClose: () => void }) {
  const [rows, setRows] = useState<BrainSandbox[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const test = useConnectionTest(() => semanggi.testBrain(brain.id));

  // Reloads can overlap (Test provisions a probe, kill removes a row, the
  // footer fires another). A monotonic id keeps the LAST-STARTED reload the
  // winner: an older snapshot resolving late can't resurrect an agent that
  // was just killed or hide a probe that just appeared.
  const loadSeq = useRef(0);

  const reload = async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await semanggi.brainSandboxes(brain.id);
      if (seq !== loadSeq.current) return;
      setRows(res.sandboxes);
      setLoadFailed(false);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
      // Without this, a failed first load leaves rows === null forever and
      // the list body claims to be loading for the rest of the modal's life.
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain.id]);

  const kill = async (agentId: string) => {
    setKilling(agentId);
    setError(null);
    try {
      await semanggi.killBrainSandbox(brain.id, agentId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setKilling(null);
    }
  };

  // The point of running the test FROM here: provisioning is the test's
  // side-effect, and the list is where the new sandbox becomes visible.
  const runTest = async () => {
    await test.trigger();
    await reload();
  };

  // Fixed viewport of exactly 8 rows (8 × 36px): the modal's height does not
  // breathe with the list, so the footer buttons never walk around while an
  // operator is aiming at one, and anything past 8 scrolls.
  const GRID = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_84px_64px] gap-2";

  return (
    <Modal
      title={`Process Manager — ${brain.name}`}
      subtitle={`Gateway sandboxes (agents) bound to ${brain.provider}/${brain.model}. Kill is offered for idle sandboxes only; a running task's sandbox is stopped through its task, not here.`}
      onClose={onClose}
      width="max-w-3xl"
    >
      {error ? (
        <div className="mb-2">
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className={`${GRID} border-b border-border bg-muted/50 px-3 py-1.5 text-left text-[11px] font-medium`}>
          <span>Name</span>
          <span>Project</span>
          <span>Task</span>
          <span>Status</span>
          <span />
        </div>
        <div className="h-72 overflow-y-auto">
          {rows === null && !loadFailed ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading sandboxes…
            </div>
          ) : loadFailed && rows === null ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-muted-foreground">
              Could not load sandboxes{error ? ` — ${error}` : ""}.
              <Button size="sm" variant="outline" onClick={() => void reload()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
              No live sandbox for this Brain yet — Test Connection provisions a probe agent, Create adds an empty one.
            </div>
          ) : (
            rows.map((sandbox) => (
              <div
                key={sandbox.agentId}
                className={`${GRID} items-center border-b border-border/60 px-3 py-1.5 text-xs last:border-b-0`}
              >
                <span className="truncate font-mono" title={sandbox.workspace ? `workspace: ${sandbox.workspace}` : sandbox.agentId}>
                  {sandbox.name}
                  {sandbox.probe ? <span className="ml-1 text-[10px] text-muted-foreground">probe</span> : null}
                </span>
                <span className="truncate text-muted-foreground" title={sandbox.projectId ?? undefined}>
                  {sandbox.projectId ?? "—"}
                </span>
                <span className="truncate text-muted-foreground" title={sandbox.taskId ?? undefined}>
                  {sandbox.taskId ?? "—"}
                </span>
                <span>
                  <Badge tone={sandbox.status === "RUNNING" ? "info" : "neutral"}>{sandbox.status}</Badge>
                </span>
                <span className="flex justify-end">
                  {/* Kill hidden for RUNNING (not merely disabled): the rule
                      lives on the server (D67 pattern), and a disabled button
                      would still whisper "someday" at a sandbox that must be
                      stopped through its task. */}
                  {sandbox.status === "IDLE" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive"
                      disabled={killing !== null || test.busy}
                      title="Kill this sandbox (agents.delete at the gateway)"
                      aria-label={`Kill ${sandbox.name}`}
                      onClick={() => void kill(sandbox.agentId)}
                    >
                      {killing === sandbox.agentId ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="min-w-0 flex-1 truncate text-[11px]">
          {test.result ? (
            <span className={testResultColor(test.result)}>
              {test.result.message}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Test Connection also provisions a probe agent when none exists — the list refreshes right after.
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" disabled={test.busy || createOpen} onClick={() => void runTest()}>
            {test.busy ? "Testing…" : "Test"}
          </Button>
          <Button size="sm" disabled={test.busy || createOpen} onClick={() => setCreateOpen(true)}>
            Create
          </Button>
        </div>
      </div>
      {createOpen ? (
        <CreateSandboxModal
          brain={brain}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await reload();
          }}
        />
      ) : null}
    </Modal>
  );
}

/**
 * The small spec sheet stacked ON TOP of the Process Manager (D78): name and
 * workspace for the empty sandbox. The model is not a field — it IS the
 * Brain; letting the operator retype it here would create a sandbox this
 * Brain's own list would not match.
 */
function CreateSandboxModal({
  brain,
  onClose,
  onCreated,
}: {
  brain: Brain;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await semanggi.createBrainSandbox(brain.id, { name, workspace: workspace.trim() || undefined });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Create sandbox — ${brain.name}`}
      subtitle={`An empty gateway sandbox bound to ${brain.provider}/${brain.model}.`}
      onClose={onClose}
      width="max-w-md"
    >
      <div className="space-y-3">
        <Field
          label="Name"
          hint='Must start with "semanggi-" or "sem-" — that prefix is the measured origin discriminator; without it the sandbox escapes Semanggi\'s fleet hygiene.'
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="semanggi-box-1"
            className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
        <Field
          label="Workspace (optional)"
          hint="Absolute path — blank uses the controller's default probe root for this provider."
        >
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="/opt/…/workspaces/probe/<provider>-<name>"
            className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
        {error ? <Notice tone="warning">{error}</Notice> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
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
        <span className={`text-[11px] ${testResultColor(result)}`}>
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
  brains,
  drivers,
  onRefreshModels,
  thinkingLevels,
  onReloadLevels,
  onClose,
  onSubmit,
  deleteBlockers,
  onDelete,
}: {
  mode: "create" | "edit";
  initial: BrainDraft;
  models: CatalogModel[];
  gatewayModels: GatewayModel[];
  /** D64: live brains feed the provider/model options for labels the gateway
   *  cache does not carry (claude-code is an ACP harness, not a models.list
   *  provider) — without them those brains would become uneditable. */
  brains: Brain[];
  drivers: QuotaDriverInfo[];
  onRefreshModels: () => void;
  thinkingLevels: ThinkingLevelEntry[];
  onReloadLevels: () => Promise<void>;
  onClose: () => void;
  onSubmit: (draft: BrainDraft) => Promise<void>;
  /** D67: reasons this brain may NOT be deleted (edit mode only) — Brain Map
   *  pins and grid defaults computed by the panel; empty = deletable. The
   *  server would still accept the call (it clears dangling pins), so this
   *  gate exists to make "in use" visible BEFORE the destructive click. */
  deleteBlockers?: string[];
  onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<BrainDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [refreshingLevels, setRefreshingLevels] = useState(false);
  const [probeSamples, setProbeSamples] = useState<ThinkingProbeSample[] | null>(null);

  // D64 rev.3 (operator rule): the provider dropdown is the INTERSECTION of
  // two sets — the potential set (providers of existing brains ∪ every
  // providerKey the quota drivers answer to) and the LIVE gateway models
  // list. Delete a provider's models from AgentOS and it disappears from
  // the form, driver or not; that is the point. The persisted
  // gateway_models cache is only the instant first paint: the panel asks
  // the gateway for real on every open (relaxing D38's "don't ask every
  // time" by operator instruction — a stale cache had mistral invisible
  // after registration, and phantom after deletion). The one carve-out is
  // the ACP harness label: claude-code is dispatchable but never appears
  // in models.list, so the gate would hide a working provider.
  const ACP_HARNESS_PROVIDERS = new Set(["claude-code"]);

  const providerOptions = useMemo(() => {
    const live = new Set(gatewayModels.map((m) => m.provider).filter(Boolean));
    const potential = new Set<string>();
    for (const b of brains) if (b.provider) potential.add(b.provider);
    for (const d of drivers) for (const key of d.providerKeys) potential.add(key);
    return Array.from(potential)
      .filter((p) => live.has(p) || ACP_HARNESS_PROVIDERS.has(p))
      .sort();
  }, [gatewayModels, brains, drivers]);

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    const gatewayHasProvider = gatewayModels.some((m) => m.provider === draft.provider);
    if (gatewayHasProvider) {
      // Same live list the provider gate used — model options can never be
      // staler than provider options.
      for (const m of gatewayModels) if (m.provider === draft.provider) set.add(m.id);
    } else {
      // ACP harness providers (claude-code) never appear in models.list;
      // their "models" are the ones the existing brains carry. Anything
      // else here failed the gate above — the field stays free-typed.
      for (const b of brains) if (b.provider === draft.provider && b.model) set.add(b.model);
    }
    if (draft.model) set.add(draft.model);
    return Array.from(set).sort();
  }, [gatewayModels, brains, draft.provider, draft.model]);

  // Which driver owns the label currently in the form — the difference
  // between "quota parking with real facts" and "generic null windows".
  const driverId = useMemo(() => {
    const key = String(draft.provider ?? "").toLowerCase();
    return drivers.find((d) => d.providerKeys.includes(key))?.id ?? "generic";
  }, [drivers, draft.provider]);

  const providerKnownToGateway = useMemo(
    () => gatewayModels.some((m) => m.provider === draft.provider),
    [gatewayModels, draft.provider],
  );

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

  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Edit mode only, and only when nothing routes through this brain anymore.
  const canDelete = mode === "edit" && onDelete != null;
  const deletable = canDelete && (deleteBlockers?.length ?? 0) === 0;

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

          <Field
            label="Provider"
            hint={
              (driverId === "generic"
                ? "No quota driver knows this label — quota windows stay generic (null)."
                : `Quota driver: ${driverId}.`) +
              (draft.provider && !providerKnownToGateway && draft.provider !== ""
                ? " Not in the gateway model cache yet — type the label exactly as registered in AgentOS (e.g. mistral-custom), or press Refresh Models."
                : "")
            }
          >
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

          {/* D64: the Category field is gone — the dispatch path stopped
              reading it when the Brain Map grid (template × role × level)
              became the decider, and the column was dropped from the schema. */}

          {/* D51/D52: the reset schedule decides what a quota refusal MEANS —
              a shortest window under 10 minutes is retried in place (up to
              10×), anything longer waits out a backoff. Providers have
              families of windows, so the operator sees the two that exist. */}
          <Field
            label="Quota reset (short)"
            hint="The window the scheduler waits out on a quota refusal. Shortest window under 10 minutes retries the task automatically, up to 10 times."
          >
            <Select
              value={draft.quotaResetShortMs}
              onChange={(v) => setDraft({ ...draft, quotaResetShortMs: v })}
            >
              <option value="">(default by provider)</option>
              <option value="60000">per-minute</option>
              <option value="18000000">5-hour</option>
            </Select>
          </Field>

          <Field label="Quota reset (long)">
            <Select
              value={draft.quotaResetLongMs}
              onChange={(v) => setDraft({ ...draft, quotaResetLongMs: v })}
            >
              <option value="">(default by provider)</option>
              <option value="86400000">daily</option>
              <option value="604800000">weekly</option>
            </Select>
          </Field>

          {/* D63: the facts the prompt budget (POC-6 §6) will be priced
              against. Seeded from the quota driver at create time; a value
              typed here is an explicit operator override (the D51 rule), and
              blank means driver-default on create / keep-stored on edit. */}
          <Field
            label="Plan tier"
            hint="Slug-like plan name (free, free-trial, lite, pro…). Blank = driver default."
          >
            <input
              value={draft.quotaTier}
              onChange={(e) => setDraft({ ...draft, quotaTier: e.target.value })}
              placeholder="lite"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="RPM" hint="Requests per minute. Blank = driver default (create) / keep stored (edit).">
            <input
              value={draft.rpm}
              onChange={(e) => setDraft({ ...draft, rpm: e.target.value })}
              inputMode="numeric"
              placeholder="30"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="RPD" hint="Requests per day. Blank = driver default / keep stored.">
            <input
              value={draft.rpd}
              onChange={(e) => setDraft({ ...draft, rpd: e.target.value })}
              inputMode="numeric"
              placeholder="1000"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="TPM" hint="Tokens per minute — the measured input wall decides retries, not the advertised one.">
            <input
              value={draft.tpm}
              onChange={(e) => setDraft({ ...draft, tpm: e.target.value })}
              inputMode="numeric"
              placeholder="7000"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="TPD" hint="Tokens per day. Blank = driver default / keep stored.">
            <input
              value={draft.tpd}
              onChange={(e) => setDraft({ ...draft, tpd: e.target.value })}
              inputMode="numeric"
              placeholder="200000"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field
            label="Context window (tokens)"
            hint="Not carried by models.list on this gateway — fill from the provider's docs. Blank = unknown."
          >
            <input
              value={draft.contextWindowTokens}
              onChange={(e) => setDraft({ ...draft, contextWindowTokens: e.target.value })}
              inputMode="numeric"
              placeholder="131072"
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

        <div className="flex items-center justify-end gap-2">
          {canDelete ? (
            <Button
              variant="danger"
              disabled={busy || !deletable}
              title={
                deletable
                  ? "Delete this brain (nothing routes through it)"
                  : `In use — ${deleteBlockers?.join("; ")}`
              }
              onClick={remove}
            >
              Delete
            </Button>
          ) : null}
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
  const [drivers, setDrivers] = useState<QuotaDriverInfo[]>([]);
  const [thinkingLevels, setThinkingLevels] = useState<ThinkingLevelEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; brain: Brain | null } | null>(null);
  const [processManager, setProcessManager] = useState<Brain | null>(null);
  // D67: the delete gate needs to know what still routes through each brain —
  // explicit Brain Map pins (by id) and the default grid (by slug name, a
  // code constant the server cannot un-pin for you). Best-effort: if the map
  // fails to load the Delete button just stays blocked, which is the safe
  // side of that failure.
  const [brainMapData, setBrainMapData] = useState<BrainMap | null>(null);

  useEffect(() => {
    semanggi.models().then((m) => setModels(m.models)).catch(() => setModels([]));
    // Cache first so the dropdowns are never empty while the gateway
    // answers, then the LIVE models.list — the provider gate (rev.3) reads
    // what AgentOS serves RIGHT NOW, and the persisted cache self-heals as
    // a side effect. If the gateway is unreachable the cached answer stays.
    semanggi
      .gatewayModels()
      .then((m) => setGatewayModels(m.models))
      .catch(() => setGatewayModels([]))
      .then(() => semanggi.refreshGatewayModels())
      .then((m) => setGatewayModels(m.models))
      .catch(() => {});
    semanggi.quotaDrivers().then((r) => setDrivers(r.drivers)).catch(() => setDrivers([]));
    semanggi.thinkingLevels().then((r) => setThinkingLevels(r.levels)).catch(() => setThinkingLevels([]));
    semanggi.brainMap().then(setBrainMapData).catch(() => setBrainMapData(null));
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

  // Per-brain reasons deletion is blocked (D67): every explicit Brain Map
  // membership (a cell's ordered list may name the same brain once — D68),
  // plus every default-grid cell naming the brain's slug. A brain serving as
  // a grid default IS in use — deleting it would silently fall every
  // un-pinned cell of that role to the level-candidate fallback.
  const deleteBlockersById = useMemo(() => {
    const byId = new Map<string, string[]>();
    const add = (id: string, reason: string) => byId.set(id, [...(byId.get(id) ?? []), reason]);
    for (const cell of brainMapData?.mappings ?? []) {
      for (const entry of cell.brains) {
        add(entry.brainId, `pinned: ${cell.template}/${cell.role}/${cell.level}`);
      }
    }
    const defaultNamesByBrain = new Map<string, Set<string>>();
    for (const [tpl, roles] of Object.entries(brainMapData?.defaults ?? {})) {
      for (const [role, levels] of Object.entries(roles)) {
        for (const brain of data?.brains ?? []) {
          if (Object.values(levels).includes(brain.name)) {
            const cells = defaultNamesByBrain.get(brain.id) ?? new Set<string>();
            cells.add(`${tpl}/${role}`);
            defaultNamesByBrain.set(brain.id, cells);
          }
        }
      }
    }
    for (const [id, cells] of defaultNamesByBrain) {
      add(id, `Brain Map default grid: ${[...cells].join(", ")}`);
    }
    return byId;
  }, [brainMapData, data]);

  const removeBrain = async (brain: Brain) => {
    await semanggi.deleteBrain(brain.id);
    await reload();
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
          description: brain.description ?? "",
          enabled: brain.enabled,
          quotaResetShortMs: brain.quotaResetShortMs != null ? String(brain.quotaResetShortMs) : "",
          quotaResetLongMs: brain.quotaResetLongMs != null ? String(brain.quotaResetLongMs) : "",
          quotaTier: brain.quotaTier ?? "",
          rpm: brain.rpm != null ? String(brain.rpm) : "",
          rpd: brain.rpd != null ? String(brain.rpd) : "",
          tpm: brain.tpm != null ? String(brain.tpm) : "",
          tpd: brain.tpd != null ? String(brain.tpd) : "",
          contextWindowTokens: brain.contextWindowTokens != null ? String(brain.contextWindowTokens) : "",
        }
      : EMPTY_DRAFT;

  const submitCreate = async (draft: BrainDraft) => {
    await semanggi.createBrain({
      ...draft,
      thinking: draft.thinking || null,
      effortEvidence: draft.effortEvidence || null,
      mode: draft.mode,
      acpAgent: draft.acpAgent || null,
      // "" stays absent on create so the server applies the provider default —
      // the source of truth for "which family of windows" lives there.
      quotaResetShortMs: draft.quotaResetShortMs ? Number(draft.quotaResetShortMs) : undefined,
      quotaResetLongMs: draft.quotaResetLongMs ? Number(draft.quotaResetLongMs) : undefined,
      // Same convention for the D63 facts: absent = driver default (tier,
      // rates, context window), so a fresh brain shows exactly what the
      // registry seeded unless the operator overrode a number.
      quotaTier: draft.quotaTier.trim() ? draft.quotaTier.trim() : undefined,
      rpm: draft.rpm ? Number(draft.rpm) : undefined,
      rpd: draft.rpd ? Number(draft.rpd) : undefined,
      tpm: draft.tpm ? Number(draft.tpm) : undefined,
      tpd: draft.tpd ? Number(draft.tpd) : undefined,
      contextWindowTokens: draft.contextWindowTokens ? Number(draft.contextWindowTokens) : undefined,
    });
    await reload();
  };

  const submitEdit = async (id: string, draft: BrainDraft) => {
    await semanggi.updateBrain(id, {
      level: draft.level,
      description: draft.description,
      thinking: draft.thinking || null,
      effortMode: draft.effortMode,
      effortEvidence: draft.effortEvidence || null,
      enabled: draft.enabled,
      mode: draft.mode,
      acpAgent: draft.acpAgent || null,
      // Same rule as create: an untouched select leaves the stored window
      // alone instead of silently rewriting it to the provider default.
      quotaResetShortMs: draft.quotaResetShortMs ? Number(draft.quotaResetShortMs) : undefined,
      quotaResetLongMs: draft.quotaResetLongMs ? Number(draft.quotaResetLongMs) : undefined,
      // D63 facts on edit: blank keeps the stored value (undefined = "no
      // change"); there is deliberately no "clear to null" here — resetting a
      // seeded number to null is a driver-default decision, not an edit.
      quotaTier: draft.quotaTier.trim() ? draft.quotaTier.trim() : undefined,
      rpm: draft.rpm ? Number(draft.rpm) : undefined,
      rpd: draft.rpd ? Number(draft.rpd) : undefined,
      tpm: draft.tpm ? Number(draft.tpm) : undefined,
      tpd: draft.tpd ? Number(draft.tpd) : undefined,
      contextWindowTokens: draft.contextWindowTokens ? Number(draft.contextWindowTokens) : undefined,
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
                  {["Name", "Model", "Effort", "Level", "Availability", "Quota", ""].map((h) => (
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
                    <td className="px-2 py-1">
                      <Badge tone={brain.availability === "AVAILABLE" ? "success" : "neutral"}>{brain.availability ?? "UNKNOWN"}</Badge>
                    </td>
                    <td className="px-2 py-1">
                      {brain.quotaReset?.shortLabel || brain.quotaReset?.longLabel ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{[brain.quotaReset.shortLabel, brain.quotaReset.longLabel].filter(Boolean).join(" · ")}</span>
                          {brain.quotaReset.autoRetry ? (
                            <Badge
                              tone="success"
                              title={`A quota refusal parks the task for one short window and retries automatically, up to ${brain.quotaReset.retryLimit} times, before blocking.`}
                            >
                              auto-retry ×{brain.quotaReset.retryLimit}
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <BrainRowActions
                        brain={brain}
                        busy={busy}
                        onEdit={() => setModal({ mode: "edit", brain })}
                        onToggle={() => toggle(brain)}
                        onProcessManager={() => setProcessManager(brain)}
                      />
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
          brains={data?.brains ?? []}
          drivers={drivers}
          onRefreshModels={refreshGatewayModels}
          thinkingLevels={thinkingLevels}
          onReloadLevels={reloadThinkingLevels}
          onClose={() => setModal(null)}
          onSubmit={(draft) => (modal.mode === "create" ? submitCreate(draft) : submitEdit(modal.brain!.id, draft))}
          deleteBlockers={modal.mode === "edit" ? deleteBlockersById.get(modal.brain!.id) ?? [] : undefined}
          onDelete={modal.mode === "edit" ? () => removeBrain(modal.brain!) : undefined}
        />
      ) : null}

      {processManager ? <ProcessManagerModal brain={processManager} onClose={() => setProcessManager(null)} /> : null}
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

// --- Brain Map ----------------------------------------------------------------

/**
 * Editor for one grid cell's ordered failover list (D68).
 *
 * Numbered rows with ↑/↓/×, not inline chips and not drag-and-drop: the ORDER
 * is the entire meaning of this cell — which brain is tried first, and who
 * takes over when it is down — so the control has to make position visible
 * and deliberate. Dragging hides swaps behind a gesture; a number says it.
 */
function BrainCellModal({
  template,
  role,
  level,
  cell,
  brains,
  defaults,
  onClose,
  onSaved,
}: {
  template: string;
  role: string;
  level: Level;
  cell: BrainMapCell | undefined;
  brains: BrainMap["brains"];
  defaults: BrainMap["defaults"];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const initial = cell ? [...cell.brains].sort((a, b) => a.position - b.position).map((e) => e.brainId) : [];
  const [ids, setIds] = useState<string[]>(initial);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);
  const remaining = brains.filter((b) => !ids.includes(b.id));
  const defaultName = defaults?.[template]?.[role]?.[level] ?? null;

  const move = (index: number, delta: number) => {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setIds(next);
  };
  const remove = (index: number) => setIds(ids.filter((_, i) => i !== index));
  const add = () => {
    if (!adding || ids.includes(adding)) return;
    setIds([...ids, adding]);
    setAdding("");
  };

  const save = async (list: string[] | null) => {
    setSaving(true);
    setError(null);
    try {
      await semanggi.setBrainCell(template, role, level, list);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${template} · ${role} · ${level}`}
      subtitle="Ordered failover list — the first live member runs; when it is unavailable the next one takes over, and it fails back automatically on recovery."
      onClose={onClose}
      width="max-w-lg"
    >
      <div className="space-y-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="space-y-2">
          {ids.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Empty list — the cell follows the grid default{defaultName ? ` (${defaultName})` : ""}, then level candidates.
            </p>
          ) : (
            ids.map((id, index) => {
              const brain = byId.get(id);
              // Client-side belowLevel for members not saved yet — rank
              // comparison, mirroring the server's RANK check. Above-level
              // brains get no badge: paying more is an operator's right.
              const below =
                brain && LEVEL_RANK[brain.level] != null && LEVEL_RANK[brain.level] < LEVEL_RANK[level];
              return (
                <div key={id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                  <span className="w-5 text-right font-mono text-xs text-muted-foreground">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium">{brain?.name ?? id}</span>
                    {brain ? <span className="ml-1 text-xs text-muted-foreground">— {brain.level}</span> : null}
                    {below ? (
                      <Badge tone="warning" title="This brain's own class is below the cell's level">
                        below level
                      </Badge>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="sm" disabled={index === 0 || saving} onClick={() => move(index, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" size="sm" disabled={index === ids.length - 1 || saving} onClick={() => move(index, 1)}>
                    ↓
                  </Button>
                  <Button variant="ghost" size="sm" disabled={saving} onClick={() => remove(index)}>
                    ✕
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={adding} onChange={setAdding} disabled={saving || remaining.length === 0} className="min-w-0 flex-1">
            <option value="">{remaining.length === 0 ? "every brain is already in the list" : "add a brain…"}</option>
            {remaining.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.level}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" disabled={!adding || saving} onClick={add}>
            Add
          </Button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {initial.length > 0 ? (
            <Button variant="danger" size="sm" disabled={saving} onClick={() => save(null)}>
              Clear cell
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || ids.length === 0} onClick={() => save(ids)}>
            {saving ? "Saving…" : "Save order"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SemanggiBrainMapPanel() {
  const { data, error, reload } = useAsync(() => semanggi.brainMap(), []);
  const [editing, setEditing] = useState<{ template: string; role: string; level: Level } | null>(null);

  const levels: Level[] = data?.levels ?? LEVELS;

  // Pinned cells, keyed by (template, role, level) — each holds its ordered
  // member list, position 0 first.
  const pinned = useMemo(() => {
    const map = new Map<string, BrainMapCell>();
    for (const m of data?.mappings ?? []) map.set(`${m.template}/${m.role}/${m.level}`, m);
    return map;
  }, [data]);

  const brainByName = useMemo(() => new Map((data?.brains ?? []).map((b) => [b.name, b])), [data]);

  // Stale members now hide inside cells: a cell whose entry points at a brain
  // that no longer exists will never run that member.
  const stale = (data?.mappings ?? []).flatMap((m) =>
    m.brains.filter((e) => e.stale).map((e) => `${m.template}/${m.role}/${m.level} → ${e.brainName ?? e.brainId}`),
  );

  return (
    <div className="w-full space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}

      <Notice tone="info">
        Each cell holds an ordered failover list: the first live brain runs, the next takes over when it is down, and it
        fails back on recovery — re-evaluated at every dispatch. Unlisted cells follow the grid defaults, then level
        candidates. A brain below the cell&apos;s level is used but marked <span className="font-medium">below level</span>{" "}
        — an explicit operator choice, never a silent downgrade.
      </Notice>

      {stale.length > 0 ? (
        <Notice tone="danger">
          {stale.length} list member(s) point at a brain that no longer exists and will never run: {stale.join(", ")}.
          Remove them from the list.
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
                      const cell = pinned.get(`${template}/${role}/${level}`);
                      const members = cell ? [...cell.brains].sort((a, b) => a.position - b.position) : [];
                      const defaultName = data?.defaults?.[template]?.[role]?.[level] ?? null;
                      const defaultBrain = defaultName ? brainByName.get(defaultName) : undefined;
                      return (
                        <td key={level} className="px-2 py-1 align-top">
                          <button
                            type="button"
                            onClick={() => setEditing({ template, role, level })}
                            className="group flex min-h-[2rem] w-full flex-col items-start gap-1 rounded-md border border-border/60 px-2 py-1 text-left hover:border-ring"
                            title="Edit the ordered failover list"
                          >
                            {members.length > 0 ? (
                              members.map((m, i) => (
                                <span key={m.brainId} className="flex items-center gap-1">
                                  <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                                  <span className={m.stale ? "line-through opacity-60" : ""}>
                                    {m.brainName ?? m.brainId}
                                  </span>
                                  {m.belowLevel ? <Badge tone="warning">below</Badge> : null}
                                </span>
                              ))
                            ) : defaultBrain ? (
                              <span className="text-muted-foreground">default: {defaultName}</span>
                            ) : (
                              <span className="text-muted-foreground">(auto from level)</span>
                            )}
                          </button>
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

      {editing ? (
        <BrainCellModal
          template={editing.template}
          role={editing.role}
          level={editing.level}
          cell={pinned.get(`${editing.template}/${editing.role}/${editing.level}`)}
          brains={data?.brains ?? []}
          defaults={data?.defaults ?? {}}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

// --- Model Map ----------------------------------------------------------------

/**
 * One row per (provider, model): the resources table (operator policy + live
 * availability) joined with the thinking_levels table (probe-measured facts).
 *
 * This page REPLACES editing resources.json / thinking-levels.json by hand
 * plus a restart (D66): both tables are written through the API, audited in
 * event_log, and the JSON files remain first-boot seeds only. What it does
 * not own: brains/routing (Brains + Brain Map pages) and the live fields
 * (availability, next available) — those belong to the scheduler's quota
 * signals and render read-only here.
 */
const AVAILABILITY_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  AVAILABLE: "success",
  QUOTA_EXHAUSTED: "warning",
  UNAVAILABLE: "danger",
};

type ModelMapDraft = {
  provider: string;
  model: string;
  writeResource: boolean;
  creditClass: string;
  concurrencyLimit: string;
  windowKind: string;
  quotaPolicy: string;
  writeThinking: boolean;
  levels: string;
  effortMode: EffortMode;
  evidence: string;
};

const inputClass =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

function draftFromRow(row: ModelMapRow | null): ModelMapDraft {
  return {
    provider: row?.provider ?? "",
    model: row?.model ?? "",
    writeResource: row ? row.sources.includes("resource") : true,
    creditClass: row?.creditClass ?? "metered",
    concurrencyLimit: row?.concurrencyLimit != null ? String(row.concurrencyLimit) : "1",
    windowKind: row?.windowKind ?? "",
    quotaPolicy: row?.quotaPolicy && Object.keys(row.quotaPolicy).length > 0 ? JSON.stringify(row.quotaPolicy, null, 2) : "",
    writeThinking: row ? row.sources.includes("thinking-levels") : false,
    levels: row?.levels ? row.levels.join(", ") : "",
    effortMode: row?.effortMode ?? "guaranteed",
    evidence: row?.evidence ?? "",
  };
}

function ModelMapModal({
  row,
  onClose,
  onSaved,
}: {
  row: ModelMapRow | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const create = row === null;
  const [draft, setDraft] = useState<ModelMapDraft>(() => draftFromRow(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Delete is edit-only, and only for a row nothing still references — the
  // server computes `deleteBlockers` (models.list, seed, brains, active
  // executions) so this gate and the API refusal can't disagree.
  const deletable = !create && (row?.deleteBlockers?.length ?? 0) === 0;
  const deleteTitle =
    !create && !deletable ? `Blocked: ${row?.deleteBlockers?.join("; ")}` : "Delete this row from both tables";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (create && (!draft.provider.trim() || !draft.model.trim())) {
        throw new Error("provider and model are required");
      }

      if (draft.writeResource) {
        // An empty number input parses to 0, which would silently park every
        // task on the model — that must be an explicit choice, not a typo.
        const concurrency = Number(draft.concurrencyLimit);
        if (draft.concurrencyLimit.trim() === "" || !Number.isInteger(concurrency) || concurrency < 0) {
          throw new Error("concurrency limit must be an integer >= 0");
        }
        let quotaPolicy: Record<string, unknown> | null = null;
        if (draft.quotaPolicy.trim()) {
          try {
            quotaPolicy = JSON.parse(draft.quotaPolicy) as Record<string, unknown>;
          } catch {
            throw new Error("quota policy is not valid JSON");
          }
        }
        const body = {
          creditClass: draft.creditClass,
          concurrencyLimit: concurrency,
          windowKind: draft.windowKind.trim() || null,
          quotaPolicy,
        };
        if (create || !row!.sources.includes("resource")) {
          await semanggi.createResource({ provider: draft.provider.trim(), model: draft.model.trim(), ...body });
        } else {
          await semanggi.updateResourcePolicy(draft.provider.trim(), draft.model.trim(), body);
        }
      }

      if (draft.writeThinking) {
        const levels = draft.levels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean);
        if (levels.length === 0) throw new Error("at least one thinking level is required");
        await semanggi.putThinkingLevels({
          provider: draft.provider.trim(),
          model: draft.model.trim(),
          levels,
          effortMode: draft.effortMode,
          evidence: draft.evidence.trim() || null,
        });
      }

      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!row) return;
    setSaving(true);
    setError(null);
    try {
      await semanggi.deleteModelMapRow(row.provider, row.model);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={create ? "Add model" : `${draft.provider}/${draft.model}`}
      subtitle="Resource policy (scheduling) and thinking facts (probe-measured) are written to separate tables — check a side to write it, uncheck to leave it alone."
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {create ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} placeholder="zai" className={inputClass} />
            </Field>
            <Field label="Model">
              <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="glm-5.2" className={inputClass} />
            </Field>
          </div>
        ) : null}

        <div className="rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={draft.writeResource}
              onChange={(e) => setDraft({ ...draft, writeResource: e.target.checked })}
            />
            Resource entry
            {!create && !row!.sources.includes("resource") ? (
              <Badge tone="warning">missing — tasks on this model park in WAIT_RESOURCE</Badge>
            ) : null}
          </label>
          {draft.writeResource ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Credit class">
                <Select value={draft.creditClass} onChange={(v) => setDraft({ ...draft, creditClass: v })}>
                  <option value="metered">metered</option>
                  <option value="subscription">subscription</option>
                </Select>
              </Field>
              <Field label="Concurrency limit" hint="0 parks every dispatch on this model.">
                <input
                  type="number"
                  min={0}
                  value={draft.concurrencyLimit}
                  onChange={(e) => setDraft({ ...draft, concurrencyLimit: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Window kind" hint="e.g. five_hour (Claude plans); usually learned from live signals.">
                <input value={draft.windowKind} onChange={(e) => setDraft({ ...draft, windowKind: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Quota policy (JSON)" className="sm:col-span-3" hint="Optional. Only used by subscription classes, e.g. claude-code.">
                <textarea
                  value={draft.quotaPolicy}
                  onChange={(e) => setDraft({ ...draft, quotaPolicy: e.target.value })}
                  rows={4}
                  placeholder="{ }"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={draft.writeThinking}
              onChange={(e) => setDraft({ ...draft, writeThinking: e.target.checked })}
            />
            Thinking levels entry
            {!create && !row!.sources.includes("thinking-levels") ? (
              <Badge tone="warning">not measured — probe this model in the Brains form first</Badge>
            ) : null}
          </label>
          {draft.writeThinking ? (
            <div className="mt-3 space-y-3">
              <Notice tone="info">
                Levels are measured facts (D38), and a preference claim without evidence is rejected by the API. Prefer
                the probe (Brains → probe levels); a manual edit here is for models a probe cannot run against.
              </Notice>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Levels" hint="Comma-separated, e.g. off, low, high, max">
                  <input value={draft.levels} onChange={(e) => setDraft({ ...draft, levels: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Effort mode">
                  <Select value={draft.effortMode} onChange={(v) => setDraft({ ...draft, effortMode: v as EffortMode })}>
                    <option value="guaranteed">guaranteed — measured to change output</option>
                    <option value="preference">preference — accepted but not applied</option>
                  </Select>
                </Field>
              </div>
              <Field label="Evidence" hint="What was measured, by whom, when. Required for preference mode.">
                <textarea
                  value={draft.evidence}
                  onChange={(e) => setDraft({ ...draft, evidence: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
            </div>
          ) : null}
        </div>

        {/* Bottom-right actions, same shape as the Brain form: the row this
            form edits ends here, so its Delete/Cancel/Save belong here too —
            not next to a title that names the model, not the action. */}
        <div className="flex items-center justify-end gap-2">
          {!create ? (
            <Button variant="danger" disabled={saving || !deletable} title={deleteTitle} onClick={remove}>
              Delete
            </Button>
          ) : null}
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : create ? "Add model" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SemanggiModelMapPanel() {
  const { data, error, reload } = useAsync(() => semanggi.modelMap(), []);
  const [modal, setModal] = useState<{ row: ModelMapRow | null } | null>(null);

  const rows = data?.models ?? [];
  const oneSided = rows.filter((r) => r.sources.length === 1);

  return (
    <div className="w-full space-y-4">
      {error ? <LoadError error={error} onRetry={reload} /> : null}

      <Notice tone="info">
        One row per (provider, model): scheduling policy (resources) joined with probe-measured thinking facts.
        Availability and next-available are live scheduler signals — read-only here. The JSON config files are
        first-boot seeds; every edit on this page goes through the audited API instead.
      </Notice>

      {oneSided.length > 0 ? (
        <Notice tone="warning">
          {oneSided.length} row(s) exist on one side only:{" "}
          {oneSided
            .map((r) => `${r.provider}/${r.model} (${r.sources.includes("resource") ? "no thinking measurement" : "no resource entry"})`)
            .join(", ")}
          .
        </Notice>
      ) : null}

      <Card
        title="Models"
        subtitle={`${rows.length} model(s)`}
        actions={
          <Button size="sm" onClick={() => setModal({ row: null })}>
            Add model
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-1 font-medium">Model</th>
                <th className="px-2 py-1 font-medium">Credit</th>
                <th className="px-2 py-1 font-medium">Conc.</th>
                <th className="px-2 py-1 font-medium">Availability</th>
                <th className="px-2 py-1 font-medium">Thinking levels</th>
                <th className="px-2 py-1 font-medium">Evidence</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.provider}/${row.model}`} className="border-b border-border/50 align-top">
                  <td className="px-2 py-1">
                    <div className="font-medium">
                      {row.provider}/{row.model}
                    </div>
                    {!row.sources.includes("resource") ? (
                      <Badge tone="danger" title="No resources row: admission parks every task routed here in WAIT_RESOURCE.">
                        no resource entry
                      </Badge>
                    ) : null}
                    {!row.sources.includes("thinking-levels") ? (
                      <Badge tone="warning" title="No probe measurement recorded for this model.">
                        not measured
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-2 py-1">{row.creditClass ?? "—"}</td>
                  <td className="px-2 py-1">{row.concurrencyLimit ?? "—"}</td>
                  <td className="px-2 py-1">
                    {row.availability ? (
                      <Badge
                        tone={AVAILABILITY_TONE[row.availability] ?? "neutral"}
                        title={row.nextAvailableAt ? `until ${new Date(row.nextAvailableAt).toLocaleString()}` : undefined}
                      >
                        {row.availability === "QUOTA_EXHAUSTED" && row.nextAvailableAt
                          ? `quota — ${relativeTime(row.nextAvailableAt)}`
                          : row.availability}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {row.levels ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {row.levels.map((l) => (
                          <Badge key={l}>{l}</Badge>
                        ))}
                        {row.effortMode === "preference" ? (
                          <Badge tone="warning" title={row.evidence ?? undefined}>
                            preference
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-[16rem] truncate px-2 py-1 text-muted-foreground" title={row.evidence ?? undefined}>
                    {row.evidence ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Button size="sm" onClick={() => setModal({ row })}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal ? <ModelMapModal row={modal.row} onClose={() => setModal(null)} onSaved={reload} /> : null}
    </div>
  );
}
