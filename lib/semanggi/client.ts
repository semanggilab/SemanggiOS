// Klien tipis ke proxy Semanggi, plus bentuk data yang dipakai halaman.
//
// Semua permintaan lewat `/api/semanggi/...` pada origin yang sama, sehingga
// sesi AgentOS ikut terbawa dan token controller tetap di sisi server.

export type Level = "low" | "normal" | "critical";
export type EffortMode = "guaranteed" | "preference";

export type Brain = {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  thinking: string | null;
  effortMode: EffortMode;
  effortEvidence: string | null;
  mode: string;
  acpAgent: string | null;
  quotaResetShortMs?: number | null;
  quotaResetLongMs?: number | null;
  level: Level;
  category: string | null;
  enabled: boolean;
  availability?: string;
  nextAvailableAt?: number | null;
  /** Server-derived view of the two windows (D51) — what the scheduler will
   *  actually do, so the panel never has to re-derive policy from raw ms. */
  quotaReset?: {
    shortMs: number | null;
    longMs: number | null;
    shortLabel: string | null;
    longLabel: string | null;
    autoRetry: boolean;
    retryLimit: number;
  } | null;
};

export type RoleLevels = {
  /** template → profile → role → level. Every combination is explicit. */
  defaults: Record<string, Record<string, Record<string, Level>>>;
  profileMapping: Record<string, Level>;
  profiles: Profile[];
  overrides: Array<{
    template: string;
    profile: Profile;
    role: string;
    level: Level;
    updatedAt: number;
  }>;
};

export type BrainMapping = {
  template: string;
  role: string;
  level: Level;
  brainId: string;
  brainName: string | null;
  brainLevel: Level | null;
  belowLevel: boolean;
  stale: boolean;
  actor: string;
  updatedAt: number;
};

export type BrainMap = {
  roles: Record<string, string[]>;
  rolesNotInAgentOs: string[];
  levels: Level[];
  /** template → role → level → default brain NAME (the grid's initial fill). */
  defaults: Record<string, Record<string, Record<string, string>>>;
  brains: Array<{ id: string; name: string; level: Level; category: string | null }>;
  mappings: BrainMapping[];
};

/** One row of the "Project Role Level" modal: a role actually registered on
 *  the project, the level it would run at, and the brain that level maps to. */
export type ProjectRoleLevel = {
  role: string;
  level: Level;
  roleMapDefault: Level;
  projectOverride: Level | null;
  brain: { id: string; name: string } | null;
  brainSource: string;
  brainNote: string | null;
};

export type ProjectRoleLevels = {
  projectId: string;
  template: string;
  profile: Profile;
  profiles: Profile[];
  hasOwnMapping: boolean;
  roles: ProjectRoleLevel[];
};

/** One row of the Command Center readiness checklist (workspace document). */
export type ProjectDocStatus = {
  /** Filename stem, no directory, no extension — what the pill shows. */
  name: string;
  /** Which workspace directory the document lives in ("docs" | "memory"). */
  dir: string;
  exists: boolean;
  size: number;
  updatedAt: number | null;
};

export type ProjectDocs = {
  projectId: string;
  template: string;
  workspacePath: string | null;
  docs: ProjectDocStatus[];
};

export type ProjectDocContent = {
  name: string;
  dir: string;
  exists: boolean;
  content: string | null;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: number;
  effectivePriority: number;
  expedited: boolean;
  expediteUntil: number | null;
  qualityClass: string;
  status: string;
  waitReason: string | null;
  workerId: string | null;
  sessionPolicy: string;
  approvalLevel: string;
  workspacePath: string | null;
  workspaceMode: string;
  modelPolicy: Record<string, unknown>;
  nextRetryAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Execution = {
  id: string;
  taskId: string;
  revisionNo: number;
  model: string | null;
  status: string;
  result: string | null;
  tokensBillable: number;
  startedAt: number | null;
  endedAt: number | null;
};

export type Approval = {
  id: string;
  taskId: string;
  level: string;
  question: string;
  options: string[];
  decision: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
};

export type TaskDetail = {
  task: Task;
  executions: Execution[];
  approvals: Approval[];
  dependencies: Array<{ id: string; status: string }>;
};

/**
 * The gateway's own content-block shape — see `messages.flatten` in the
 * controller (repositories.mjs) for where this vocabulary comes from:
 * "thinking" is reasoning kept out of the flattened `text` because it's
 * often longer than the answer, "toolCall" is what ran (a command, a file
 * write, whatever `arguments` holds for that tool), "text" is the response
 * itself. Anything else is rendered generically rather than hidden — the
 * gateway may add block types this UI doesn't know about yet.
 */
export type TranscriptBlock = {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
};

export type TranscriptTurn = {
  executionId?: string;
  revision: number;
  role: string;
  at: number;
  text: string;
  seq?: number;
  blocks: TranscriptBlock[] | null;
};

export type WorkEvent = {
  seq: number;
  at: number;
  kind: string;
  subjectType: string;
  subjectId: string;
  actor: string;
  payload: Record<string, unknown>;
};

export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  weight: number;
  workspacePath: string | null;
  taskCount: number;
  phase: { stocked: number; queued: number; waiting: number; needsAttention: number; running: number; done: number };
  tokens: number;
  runs: number;
  lastActivityAt: number | null;
  needsAttention: number;
};

export type Profile = "fast" | "balanced" | "quality";

// D37: template and profile are the project's own setting now — typed once
// in Settings → Project rather than re-typed on every Control page request.
export type ProjectSettings = {
  id: string;
  name: string;
  weight: number;
  status: string;
  workspacePath: string | null;
  template: string;
  profile: Profile;
};

export type CatalogModel = {
  name: string;
  provider: string;
  model: string;
  effort: string | null;
  effortMode: EffortMode;
  effortEvidence: string | null;
  mode: string;
  acpAgent: string | null;
  availability: string;
};

export type GatewayModel = {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  available?: boolean;
};

export type ThinkingLevelEntry = {
  provider: string;
  model: string;
  levels: string[];
  effortMode: EffortMode;
  evidence: string | null;
  updatedAt: number;
};

export type ThinkingProbeSample = {
  level: string;
  included: boolean;
  outputTokens?: number | null;
  reason: string | null;
  status?: string;
  latencyMs?: number;
  startedAt?: number;
};

export type ThinkingProbeStatus = {
  found?: boolean;
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  reason: string | null;
  message: string | null;
  samples: ThinkingProbeSample[];
};

export type ThinkingProbeStartResult = {
  ok: boolean;
  started: boolean;
  reason?: string;
  provider: string;
  model: string;
  agentId?: string;
  status: ThinkingProbeStatus;
};

export type BrainTestResult = {
  ok: boolean;
  reason?: string;
  message?: string;
  status?: string;
  latencyMs?: number;
  agentId?: string;
  thinking?: string | null;
  error?: string;
};

export type PlanStep = {
  role: string;
  label: string;
  level: Level;
  category: string | null;
  qualityClass: string;
  workspaceMode: string;
  deliverable: string | null;
  title: string;
  brain: string | null;
  brainSource: string | null;
  brainNote: string | null;
  after: string[];
  taskId?: string;
  dependsOn?: string[];
};

export type ControlReply = {
  intent: "CHAT" | "WORK" | "TASK" | "CONFIRM" | "PREPARE";
  reply: string;
  reason?: string | null;
  action?: string | null;
  taskId?: string | null;
  needsConfirmation?: boolean;
  target?: { id: string; title: string; status: string } | null;
  created?: boolean;
  plan?: PlanStep[];
  tasks: PlanStep[];
  /** PREPARE "daftarkan…": task yang dibuat dari docs/tasks.md, urut dokumen. */
  registered?: Array<{
    localId: string;
    id: string;
    title: string;
    status: string;
    role: string | null;
    deps: string[];
  }>;
};

export class SemanggiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/semanggi/${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Balasan bukan JSON hampir selalu berarti perantara, bukan controller.
    throw new SemanggiError(`Unexpected non-JSON reply (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) {
    const payload = parsed as { error?: string; code?: string } | null;
    throw new SemanggiError(payload?.error ?? `HTTP ${res.status}`, res.status, payload?.code ?? null);
  }
  return parsed as T;
}

export const semanggi = {
  projectSummary: () => call<{ projects: ProjectSummary[]; generatedAt: number }>("GET", "work/projects/summary"),
  projects: () => call<{ projects: ProjectSettings[] }>("GET", "work/projects"),
  updateProjectSettings: (id: string, patch: { template?: string; profile?: Profile }) =>
    call<{ project: ProjectSettings }>("PATCH", `work/projects/${id}`, patch),
  // Registers an AgentOS workspace as a Semanggi project — the other
  // direction of the same match-by-path relationship Summary/Control already
  // read (a project's workspacePath). Name defaults to the workspace's own
  // name since there is nothing else yet to name it after at this point.
  createProject: (body: { name: string; workspacePath: string }) =>
    call<{ project: { id: string; name: string; weight: number; template: string; profile: Profile } }>(
      "POST",
      "work/projects",
      body,
    ),
  tasks: (params: { project?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.project) q.set("project", params.project);
    if (params.status) q.set("status", params.status);
    return call<{ tasks: Task[] }>("GET", `work/tasks${q.size ? `?${q}` : ""}`);
  },
  task: (id: string) => call<TaskDetail>("GET", `work/tasks/${id}`),
  events: (subject: string, limit = 200) =>
    call<{ events: WorkEvent[] }>("GET", `work/events?subject=${encodeURIComponent(subject)}&limit=${limit}`),
  transcript: (id: string) => call<{ taskId: string; turns: TranscriptTurn[] }>("GET", `work/tasks/${id}/transcript`),

  start: (id: string) => call<{ task: Task }>("POST", `work/tasks/${id}/start`, {}),
  stop: (id: string, reason?: string) => call<{ task: Task }>("POST", `work/tasks/${id}/stop`, { reason }),
  cancel: (id: string, note?: string) => call<{ task: Task }>("POST", `work/tasks/${id}/cancel`, { note }),
  expedite: (id: string, ttlMs: number) => call<{ task: Task }>("POST", `work/tasks/${id}/expedite`, { ttl: ttlMs }),
  comment: (id: string, text: string) => call<unknown>("POST", `work/tasks/${id}/comments`, { text }),
  setModel: (id: string, preferred: string[]) =>
    call<{ task: Task }>("PATCH", `work/tasks/${id}`, { modelPolicy: { preferred } }),
  rerun: (id: string, sessionMode: "CONTINUE" | "FORK" | "FRESH", instruction = "") =>
    call<{ task: Task }>("POST", `work/tasks/${id}/revisions`, { sessionMode, instruction }),
  decide: (approvalId: string, decision: "APPROVE" | "REJECT" | "MODIFY", note?: string) =>
    call<{ approval: Approval }>("POST", `work/approvals/${approvalId}/decide`, { decision, note }),

  models: () => call<{ models: CatalogModel[] }>("GET", "work/models"),
  brains: () => call<{ brains: Brain[] }>("GET", "work/brains"),
  createBrain: (brain: Partial<Brain>) => call<{ brain: Brain }>("POST", "work/brains", brain),
  updateBrain: (id: string, patch: Partial<Brain>) => call<{ brain: Brain }>("PATCH", `work/brains/${id}`, patch),
  testBrain: (id: string) => call<BrainTestResult>("POST", `work/brains/${id}/test`, {}),
  // Same test, before the Brain exists as a saved row — lets "Add Brain"
  // verify a (provider, model[, acpAgent]) combination has a live agent
  // before the operator commits to it. `acpAgent` matters only for
  // provider "claude-code": that harness is reached through a named ACP
  // agent (routing.json), never matched by model like every other provider.
  testBrainDraft: (draft: { provider: string; model: string; thinking?: string | null; effortMode?: EffortMode; acpAgent?: string | null }) =>
    call<BrainTestResult>("POST", "work/brains/test", draft),
  // Cached list (fast, no live gateway call). refreshGatewayModels() below is
  // the one that actually asks the gateway and persists the answer here.
  gatewayModels: () => call<{ models: GatewayModel[] }>("GET", "work/gateway/models"),
  refreshGatewayModels: () => call<{ models: GatewayModel[] }>("POST", "work/gateway/models/refresh", {}),
  thinkingLevels: (provider?: string, model?: string) => {
    const q = provider && model ? `?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}` : "";
    return call<{ levels: ThinkingLevelEntry[] }>("GET", `work/gateway/thinking-levels${q}`);
  },
  refreshThinkingLevels: () => call<{ synced: number; at: number }>("POST", "work/gateway/thinking-levels/refresh", {}),
  // Real per-model probe (D26): dispatches actual runs against the gateway,
  // scoped to exactly the (provider, model) given — never a fleet sweep.
  // Fire-and-forget on the server side; poll thinkingProbeStatus for progress.
  probeThinkingLevels: (provider: string, model: string) =>
    call<ThinkingProbeStartResult>("POST", "work/gateway/thinking-levels/probe", { provider, model }),
  thinkingProbeStatus: (provider: string, model: string) =>
    call<ThinkingProbeStatus>(
      "GET",
      `work/gateway/thinking-levels/probe/status?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`,
    ),
  roleLevels: () => call<RoleLevels>("GET", "work/role-levels"),
  setRoleLevel: (template: string, profile: Profile, role: string, level: Level | null) =>
    call<unknown>("PUT", "work/role-levels", { template, profile, role, level }),
  brainMap: () => call<BrainMap>("GET", "work/brain-map"),
  setBrainMapping: (template: string, role: string, level: Level, brainId: string | null) =>
    call<unknown>("PUT", "work/brain-map", { template, role, level, brainId }),
  projectRoleLevels: (id: string, profile?: Profile) => {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return call<ProjectRoleLevels>("GET", `work/projects/${id}/role-levels${q}`);
  },
  projectDocs: (id: string) => call<ProjectDocs>("GET", `work/projects/${id}/docs`),
  projectDoc: (id: string, name: string) =>
    call<ProjectDocContent>("GET", `work/projects/${id}/docs/${encodeURIComponent(name)}`),
  saveProjectDoc: (id: string, name: string, content: string) =>
    call<ProjectDocContent>("PUT", `work/projects/${id}/docs/${encodeURIComponent(name)}`, { content }),
  putProjectRoleLevels: (
    id: string,
    body: { profile?: Profile; roleLevels: Array<{ role: string; level: Level }> },
  ) => call<{ projectId: string; roleLevels: Array<{ role: string; level: Level }> }>(
    "PUT",
    `work/projects/${id}/role-levels`,
    body,
  ),

  control: (payload: { text: string; projectId?: string; template?: string; profile?: string; confirm?: boolean }) =>
    call<ControlReply>("POST", "work/control/message", payload),
};

// --- kosakata status ---------------------------------------------------------
//
// Kolom kanban sengaja LEBIH SEDIKIT dari status di mesin state. Tujuh status
// WAIT_* yang berbeda benar untuk penjadwal, tetapi sebagai tujuh kolom ia
// menyembunyikan satu-satunya perbedaan yang penting bagi operator: mana yang
// menunggu sistem, dan mana yang menunggu DIA.

export const COLUMNS = [
  { id: "stocked", label: "On hold", statuses: ["CREATED"] },
  { id: "queued", label: "Queued", statuses: ["QUEUED", "RESUMABLE"] },
  { id: "waiting", label: "Waiting on system", statuses: ["WAIT_DEP", "WAIT_WORKSPACE", "WAIT_RESOURCE", "WAIT_QUOTA", "WAIT_CONCURRENCY", "WAIT_WORKER", "WAIT_RUNTIME"] },
  { id: "attention", label: "Needs you", statuses: ["WAIT_HUMAN", "BLOCKED", "FAILED"] },
  { id: "running", label: "Running", statuses: ["DISPATCHED", "RUNNING"] },
  { id: "done", label: "Done", statuses: ["COMPLETE", "CANCELLED"] },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

export function columnFor(status: string): ColumnId {
  const hit = COLUMNS.find((c) => (c.statuses as readonly string[]).includes(status));
  return hit?.id ?? "waiting";
}

// The mount contract puts every task workspace under this prefix (see
// assertWorkspacePath in the controller). It's structural, not content — an
// operator reading a path wants to know which project/branch/worktree they're
// looking at, not confirm the mount point for the tenth time today.
const WORKSPACE_PREFIX = "/opt/semanggi/volumes/shared/service/semanggios/openclaw";

export function shortenWorkspacePath(path: string | null | undefined): string {
  if (!path) return "—";
  if (path === WORKSPACE_PREFIX) return "/";
  if (path.startsWith(`${WORKSPACE_PREFIX}/`)) return `…/${path.slice(WORKSPACE_PREFIX.length + 1)}`;
  return path;
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1000, "second"],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      const plural = n === 1 ? name : `${name}s`;
      return diff >= 0 ? `${n} ${plural} ago` : `in ${n} ${plural}`;
    }
  }
  return "just now";
}
