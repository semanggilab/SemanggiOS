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
  level: Level;
  category: string | null;
  enabled: boolean;
  availability?: string;
  nextAvailableAt?: number | null;
};

export type RoleLevels = {
  defaults: Record<string, Record<string, Level | null>>;
  profileMapping: Record<string, Level>;
  overrides: Array<{ template: string; role: string; level: Level; updatedAt: number }>;
};

export type BrainMapping = {
  template: string;
  role: string;
  brainId: string;
  brainName: string | null;
  brainLevel: Level | null;
  roleLevel: Level | null;
  stale: boolean;
  actor: string;
  updatedAt: number;
};

export type BrainMap = {
  roles: Record<string, string[]>;
  rolesNotInAgentOs: string[];
  brains: Array<{ id: string; name: string; level: Level; category: string | null }>;
  mappings: BrainMapping[];
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

export type CatalogModel = {
  name: string;
  provider: string;
  model: string;
  effort: string | null;
  effortMode: EffortMode;
  effortEvidence: string | null;
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
  intent: "CHAT" | "WORK" | "TASK" | "CONFIRM";
  reply: string;
  reason?: string | null;
  action?: string | null;
  taskId?: string | null;
  needsConfirmation?: boolean;
  target?: { id: string; title: string; status: string } | null;
  created?: boolean;
  plan?: PlanStep[];
  tasks: PlanStep[];
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
  tasks: (params: { project?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.project) q.set("project", params.project);
    if (params.status) q.set("status", params.status);
    return call<{ tasks: Task[] }>("GET", `work/tasks${q.size ? `?${q}` : ""}`);
  },
  task: (id: string) => call<TaskDetail>("GET", `work/tasks/${id}`),
  events: (subject: string, limit = 200) =>
    call<{ events: WorkEvent[] }>("GET", `work/events?subject=${encodeURIComponent(subject)}&limit=${limit}`),
  transcript: (id: string) =>
    call<{ taskId: string; turns: Array<{ role: string; at: number; text: string; revision: number }> }>(
      "GET",
      `work/tasks/${id}/transcript`,
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
  decide: (approvalId: string, decision: "APPROVE" | "REJECT", note?: string) =>
    call<{ approval: Approval }>("POST", `work/approvals/${approvalId}/decide`, { decision, note }),

  models: () => call<{ models: CatalogModel[] }>("GET", "work/models"),
  brains: () => call<{ brains: Brain[] }>("GET", "work/brains"),
  createBrain: (brain: Partial<Brain>) => call<{ brain: Brain }>("POST", "work/brains", brain),
  updateBrain: (id: string, patch: Partial<Brain>) => call<{ brain: Brain }>("PATCH", `work/brains/${id}`, patch),
  testBrain: (id: string) => call<BrainTestResult>("POST", `work/brains/${id}/test`, {}),
  gatewayModels: () => call<{ models: GatewayModel[] }>("GET", "work/gateway/models"),
  thinkingLevels: (provider?: string, model?: string) => {
    const q = provider && model ? `?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}` : "";
    return call<{ levels: ThinkingLevelEntry[] }>("GET", `work/gateway/thinking-levels${q}`);
  },
  refreshThinkingLevels: () => call<{ synced: number; at: number }>("POST", "work/gateway/thinking-levels/refresh", {}),
  roleLevels: () => call<RoleLevels>("GET", "work/role-levels"),
  setRoleLevel: (template: string, role: string, level: Level) =>
    call<unknown>("PUT", "work/role-levels", { template, role, level }),
  brainMap: () => call<BrainMap>("GET", "work/brain-map"),
  setBrainMapping: (template: string, role: string, brainId: string | null) =>
    call<unknown>("PUT", "work/brain-map", { template, role, brainId }),

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
