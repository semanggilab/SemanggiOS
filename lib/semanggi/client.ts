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
  /** D64: which quota driver classifies this brain ("generic" = none). */
  quotaDriver?: string;
  /** D63 rate/fact columns — seeded from the driver, operator-patchable. */
  quotaTier?: string | null;
  rpm?: number | null;
  rpd?: number | null;
  tpm?: number | null;
  tpd?: number | null;
  contextWindowTokens?: number | null;
  /** D80: minimum live sandboxes kept for this brain (0 = never auto-provisioned). */
  minSandboxes?: number;
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

/** One member of a Brain Map cell's ordered failover list (D68). Position 0
 *  is tried first at every dispatch attempt; a disabled member is skipped but
 *  keeps its slot, so re-enabling it fails back automatically. */
export type BrainMapEntry = {
  position: number;
  brainId: string;
  brainName: string | null;
  brainLevel: Level | null;
  belowLevel: boolean;
  stale: boolean;
};

/** One (template, role, level) cell and its full ordered member list. */
export type BrainMapCell = {
  template: string;
  role: string;
  level: Level;
  brains: BrainMapEntry[];
  updatedAt: number;
};

export type BrainMap = {
  roles: Record<string, string[]>;
  rolesNotInAgentOs: string[];
  levels: Level[];
  /** template → role → level → default brain NAME (the grid's initial fill). */
  defaults: Record<string, Record<string, Record<string, string>>>;
  brains: Array<{ id: string; name: string; level: Level }>;
  mappings: BrainMapCell[];
};

/** One row of the "Project Role Level" modal: a role actually registered on
 *  the project, the level it would run at, and the brain chain that level
 *  maps to — first live member plus the named failover peers behind it. */
export type ProjectRoleLevel = {
  role: string;
  level: Level;
  roleMapDefault: Level;
  projectOverride: Level | null;
  brain: { id: string; name: string } | null;
  brainSource: string;
  brainNote: string | null;
  brainPeers: string[];
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

/**
 * One workspace file, as the "@" search and the viewer panel see it (D73).
 *
 * Distinct from ProjectDocStatus above, which describes the READINESS
 * CHECKLIST — seven fixed names graded per template. This is whatever
 * actually exists under docs/, memory/ and deliverables/, including files
 * that were born while the work was being done and could never have been
 * whitelisted in advance.
 */
export type WorkspaceFile = {
  /** Path relative to the project workspace, e.g. "docs/adr/0001.md". */
  path: string;
  name: string;
  dir: string;
  size: number;
  updatedAt: number | null;
  /** Only markdown is writable — the server owns this rule, not the panel. */
  editable: boolean;
};

export type WorkspaceFileContent = {
  path: string;
  exists: boolean;
  editable: boolean;
  /** A binary file says so rather than arriving as broken text. */
  binary: boolean;
  content: string | null;
  size: number;
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

/** D64: one registry entry — which gateway labels a quota driver answers to. */
export type QuotaDriverInfo = {
  id: string;
  providerKeys: string[];
  tier: string | null;
};

export type ThinkingLevelEntry = {
  provider: string;
  model: string;
  levels: string[];
  effortMode: EffortMode;
  evidence: string | null;
  updatedAt: number;
};

/**
 * One row of Settings → Model Map (D66): the JOIN of the resources table
 * (operator policy + live availability signals) and the thinking_levels
 * table (probe-measured facts). A side that has no row for this
 * (provider, model) is null — visible, not hidden, because a missing
 * resource row parks every routed task in WAIT_RESOURCE.
 */
export type ModelMapRow = {
  provider: string;
  model: string;
  creditClass: string | null;
  concurrencyLimit: number | null;
  quotaPolicy: Record<string, unknown> | null;
  windowKind: string | null;
  availability: string | null;
  nextAvailableAt: number | null;
  lastQuotaSignal: string | null;
  resourceUpdatedAt: number | null;
  levels: string[] | null;
  effortMode: EffortMode | null;
  evidence: string | null;
  levelsUpdatedAt: number | null;
  sources: string[];
  /**
   * D67: why this row may NOT be deleted (empty = deletable). Computed by the
   * server — models.list catalog, resources.json seed, referencing brains,
   * active executions — because the delete rule is server fact, not a guess
   * the client should re-derive from three other endpoints.
   */
  deleteBlockers: string[];
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

/** One row of the Process Manager (D78): a gateway agent bound to this
 *  brain's model plus its sandbox workspace. projectId/taskId attribute the
 *  sandbox to the task currently (or last) running there — null for a fresh
 *  probe; RUNNING means a DISPATCHED/RUNNING task occupies it and kill is
 *  refused server-side. */
export type BrainSandbox = {
  agentId: string;
  name: string;
  workspace: string | null;
  status: "RUNNING" | "IDLE";
  projectId: string | null;
  taskId: string | null;
  probe: boolean;
};

/** D79: one row of the fleet-wide overview. An agent satisfying two brains
 *  (same provider+model) appears ONCE — attributed to the first brain in the
 *  server's list order — because a Total counter that double-counts lies. */
export type FleetSandbox = BrainSandbox & {
  brainId: string;
  brainName: string;
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
  /** The full ordered failover chain behind `brain` (D68) — first entry is
   *  `brain` itself when one resolves. */
  brainList: string[];
  brainSource: string | null;
  brainNote: string | null;
  after: string[];
  taskId?: string;
  dependsOn?: string[];
};

export type ControlReply = {
  intent: "CHAT" | "WORK" | "TASK" | "CONFIRM" | "PREPARE" | "DOC";
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
  /** DOC: berkas yang dirujuk permintaan plus keluarannya — apa yang bisa
   *  dibuka langsung dari balasan tanpa mengetik ulang path-nya. */
  files?: string[];
};

/**
 * POC-10: one ad-hoc chat session (§7). A session is NOT a task — it never
 * touches the task state machine; its transcript lives in chat_messages and
 * its brain is resolved from the Role Brain Map's "chat" role unless the
 * operator picked one explicitly.
 */
export type ChatSession = {
  id: string;
  projectId: string;
  brainId: string;
  title: string | null;
  /** Stable gateway session key once the first message has been dispatched
   *  (`chat:<sessionId>:<ms>`); null until then. Read-only from the UI. */
  gatewaySessionRef: string | null;
  status: "ACTIVE" | "ARCHIVED";
  actor: string;
  createdAt: number;
  lastActiveAt: number;
};

/** One row of a session transcript. Operator rows land DONE immediately;
 *  brain rows go PENDING → RUNNING → DONE/FAILED as the dispatch pipeline
 *  progresses (§8.3) — the statuses the room's 10s poll keys on. */
export type ChatMessage = {
  id: string;
  sessionId: string;
  seq: number;
  role: "operator" | "brain";
  content: string | null;
  /** Paths under chat/<sessionId>/uploads/ — the server enforces that prefix
   *  on send; the chips in the composer come from the upload endpoint. */
  attachments: string[] | null;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  createdAt: number;
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

  // Lampiran operator (D76/D77) — bytes MENTAH, bukan JSON: fetch() dengan body
  // Buffer/ArrayBuffer menjaga berkas utuh melintasi proxy (yang meneruskan
  // content-type octet-stream apa adanya). Satu berkas per panggilan; multi-file
  // diulang oleh pemanggil supaya kegagalan per berkas terlapor per berkas.
  upload: async (projectId: string, name: string, bytes: ArrayBuffer | Blob | File) => {
    const res = await fetch(`/api/semanggi/work/projects/${projectId}/uploads?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new SemanggiError(`Unexpected non-JSON reply (HTTP ${res.status})`, res.status);
    }
    if (!res.ok) {
      const payload = parsed as { error?: string; code?: string } | null;
      throw new SemanggiError(payload?.error ?? `HTTP ${res.status}`, res.status, payload?.code ?? null);
    }
    return parsed as { ok: true; path: string; size: number };
  },
  // Tombol "×" pada chip lampiran (D77). Hanya staging tmp/uploads/ yang bisa
  // dihapus — salinan per-task sudah milik task yang mengadopsinya.
  deleteUpload: (projectId: string, path: string) =>
    call<{ ok: true; path: string }>(
      "DELETE",
      `work/projects/${projectId}/uploads?path=${encodeURIComponent(path)}`,
    ),

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
  // D66 Model Map: the resource+thinking-levels join, and its two write
  // paths. Live fields (availability, nextAvailableAt) are read-only on the
  // server; the PATCH body only carries policy fields.
  modelMap: () => call<{ models: ModelMapRow[] }>("GET", "work/model-map"),
  createResource: (body: {
    provider: string;
    model: string;
    creditClass?: string;
    concurrencyLimit?: number;
    quotaPolicy?: Record<string, unknown> | null;
    windowKind?: string | null;
  }) => call<{ resource: { provider: string; model: string } }>("POST", "work/resources", body),
  // Query params, not path segments: groq model ids contain "/" and a slash
  // cannot survive the Next.js catch-all proxy path.
  updateResourcePolicy: (
    provider: string,
    model: string,
    patch: {
      creditClass?: string;
      concurrencyLimit?: number;
      quotaPolicy?: Record<string, unknown> | null;
      windowKind?: string | null;
    },
  ) =>
    call<{ resource: { provider: string; model: string } }>(
      "PATCH",
      `work/resources?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`,
      patch,
    ),
  putThinkingLevels: (entry: {
    provider: string;
    model: string;
    levels: string[];
    effortMode: EffortMode;
    evidence?: string | null;
  }) => call<{ level: ThinkingLevelEntry }>("PUT", "work/thinking-levels", entry),
  // D67: removes ONE Model Map row — both sides (resource policy + measured
  // levels). Same query-param identity rule as PATCH: groq model ids contain
  // "/" and cannot survive the catch-all proxy as a path segment. Refused
  // server-side while anything still references the model.
  deleteModelMapRow: (provider: string, model: string) =>
    call<{ deleted: { provider: string; model: string }; sides: string[] }>(
      "DELETE",
      `work/model-map?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`,
    ),
  brains: () => call<{ brains: Brain[] }>("GET", "work/brains"),
  createBrain: (brain: Partial<Brain>) => call<{ brain: Brain }>("POST", "work/brains", brain),
  updateBrain: (id: string, patch: Partial<Brain>) => call<{ brain: Brain }>("PATCH", `work/brains/${id}`, patch),
  // The server also clears any Brain Map cells still pinning the brain; the
  // form only offers this after the UI's own in-use gate passes, so the
  // clearing path is a safety net, not the normal route.
  deleteBrain: (id: string) =>
    call<{ brain: Brain; clearedMappings: Array<{ template: string; role: string; level: string }> }>(
      "DELETE",
      `work/brains/${id}`,
    ),
  testBrain: (id: string) => call<BrainTestResult>("POST", `work/brains/${id}/test`, {}),
  // Same test, before the Brain exists as a saved row — lets "Add Brain"
  // verify a (provider, model[, acpAgent]) combination has a live agent
  // before the operator commits to it. `acpAgent` matters only for
  // provider "claude-code": that harness is reached through a named ACP
  // agent (routing.json), never matched by model like every other provider.
  testBrainDraft: (draft: { provider: string; model: string; thinking?: string | null; effortMode?: EffortMode; acpAgent?: string | null }) =>
    call<BrainTestResult>("POST", "work/brains/test", draft),
  // --- Process Manager (D78) -------------------------------------------------
  // A "sandbox" is the gateway agent + its workspace. The list is
  // agent-centric: that is the thing Test Connection mutates (auto-provisioned
  // probe agents appear here) and the thing Create/Kill operate on.
  brainSandboxes: (id: string) => call<{ brain: { id: string; name: string; provider: string; model: string }; sandboxes: BrainSandbox[] }>(
    "GET",
    `work/brains/${id}/sandboxes`,
  ),
  createBrainSandbox: (id: string, spec: { name: string; workspace?: string }) =>
    call<{ sandbox: { agentId: string; name: string; workspace: string; model: string }; status: string }>(
      "POST",
      `work/brains/${id}/sandboxes`,
      spec,
    ),
  // Kill is refused server-side (409) for a sandbox running a task — the rule
  // lives there, the UI only hides the button (D67 pattern).
  killBrainSandbox: (id: string, agentId: string) =>
    call<{ killed: boolean; agentId: string; removedBindings: number }>(
      "POST",
      `work/brains/${id}/sandboxes/kill`,
      { agentId },
    ),
  // D79: fleet-wide counts for the status card + the all-Running/all-Idle
  // Process Manager. Filter trims only the list; counts always describe the
  // whole fleet.
  sandboxesOverview: (status?: "RUNNING" | "IDLE") =>
    call<{ counts: { total: number; running: number; idle: number }; sandboxes: FleetSandbox[] }>(
      "GET",
      `work/sandboxes${status ? `?status=${status}` : ""}`,
    ),
  // Cached list (fast, no live gateway call). refreshGatewayModels() below is
  // the one that actually asks the gateway and persists the answer here.
  gatewayModels: () => call<{ models: GatewayModel[] }>("GET", "work/gateway/models"),
  refreshGatewayModels: () => call<{ models: GatewayModel[] }>("POST", "work/gateway/models/refresh", {}),
  quotaDrivers: () => call<{ drivers: QuotaDriverInfo[] }>("GET", "work/quota-drivers"),
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
  // D68: a cell holds an ORDERED failover list. `brainIds[0]` is tried first
  // at every dispatch attempt; null/[] clears the cell back to grid default.
  setBrainCell: (template: string, role: string, level: Level, brainIds: string[] | null) =>
    call<unknown>("PUT", "work/brain-map", { template, role, level, brainIds }),
  projectRoleLevels: (id: string, profile?: Profile) => {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return call<ProjectRoleLevels>("GET", `work/projects/${id}/role-levels${q}`);
  },
  projectDocs: (id: string) => call<ProjectDocs>("GET", `work/projects/${id}/docs`),
  projectDoc: (id: string, name: string) =>
    call<ProjectDocContent>("GET", `work/projects/${id}/docs/${encodeURIComponent(name)}`),
  saveProjectDoc: (id: string, name: string, content: string) =>
    call<ProjectDocContent>("PUT", `work/projects/${id}/docs/${encodeURIComponent(name)}`, { content }),
  // D73 — workspace files under docs/, memory/ and deliverables/. Path travels
  // as a QUERY PARAM, never a path segment: a path contains "/" and would be
  // shredded by the Next.js catch-all proxy (the same reason Model Map
  // identifies groq models by query param).
  workspaceFiles: (id: string, params: { q?: string; ext?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.ext) search.set("ext", params.ext);
    return call<{ projectId: string; workspacePath: string | null; roots: string[]; files: WorkspaceFile[] }>(
      "GET",
      `work/projects/${id}/files${search.size ? `?${search}` : ""}`,
    );
  },
  workspaceFile: (id: string, path: string) =>
    call<WorkspaceFileContent>("GET", `work/projects/${id}/file?path=${encodeURIComponent(path)}`),
  saveWorkspaceFile: (id: string, path: string, content: string) =>
    call<WorkspaceFileContent>("PUT", `work/projects/${id}/file?path=${encodeURIComponent(path)}`, { content }),
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

  // --- POC-10 chat (T5, spec §8) --------------------------------------------
  //
  // The composer routing gate lives on the SERVER (§12.6.4): the client asks
  // "is this text chat-eligible?" rather than re-deriving the verb/prefix/
  // chatty rules here — two copies of the router's vocabulary would diverge
  // the first time one of them changes.
  chatEligible: (text: string) =>
    call<{ eligible: boolean }>("GET", `work/chat/eligible?text=${encodeURIComponent(text)}`),
  // Sidebar list — server orders newest-first by last_active_at.
  listChatSessions: (projectId: string) =>
    call<{ sessions: ChatSession[] }>("GET", `work/chat/sessions?projectId=${encodeURIComponent(projectId)}`),
  chatSession: (id: string) => call<{ session: ChatSession; messages: ChatMessage[] }>("GET", `work/chat/sessions/${id}`),
  createChatSession: (body: { projectId: string; brainId?: string; title?: string }) =>
    call<{ session: ChatSession; brainDefault: boolean }>("POST", "work/chat/sessions", body),
  patchChatSession: (id: string, patch: { title?: string; status?: "ACTIVE" | "ARCHIVED" }) =>
    call<{ session: ChatSession }>("PATCH", `work/chat/sessions/${id}`, patch),
  // Admin-only server-side; exposed for completeness/cleanup tooling, not
  // wired to a button — archive is the operator-facing end of a session.
  deleteChatSession: (id: string) => call<{ deleted: boolean; sessionId: string }>("DELETE", `work/chat/sessions/${id}`),
  sendChatMessage: (id: string, body: { text: string; projectId: string; attachments?: string[] }) =>
    call<{ operatorMessage: ChatMessage; message: ChatMessage }>("POST", `work/chat/sessions/${id}/messages`, body),
  // §10.2: the reset-context switch NEVER happens without confirmReset — the
  // server answers 409 naming the brain until the client says yes explicitly.
  switchChatBrain: (id: string, brainId: string, confirmReset = false) =>
    call<{ session: ChatSession; changed: boolean }>("POST", `work/chat/sessions/${id}/brain`, {
      brainId,
      confirmReset,
    }),
  // Same raw-bytes shape as `upload` above (D76) but rooted at the session:
  // chat/<sessionId>/uploads/ — files are NEVER adopted by a task and are
  // swept by the TTL cleaner, not by a chip "×" delete.
  uploadChatFile: async (id: string, name: string, bytes: ArrayBuffer | Blob | File) => {
    const res = await fetch(`/api/semanggi/work/chat/sessions/${id}/uploads?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new SemanggiError(`Unexpected non-JSON reply (HTTP ${res.status})`, res.status);
    }
    if (!res.ok) {
      const payload = parsed as { error?: string; code?: string } | null;
      throw new SemanggiError(payload?.error ?? `HTTP ${res.status}`, res.status, payload?.code ?? null);
    }
    return parsed as { ok: true; path: string; size: number };
  },
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
