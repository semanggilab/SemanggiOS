"use client";

// Halaman Summary: kartu ringkasan di atas, kanban per project di bawah.
//
// KENAPA KANBAN-NYA PER PROJECT, BUKAN SATU ANTRIAN DATAR
//
// Antrian datar menjawab pertanyaan penjadwal ("apa berikutnya?"). Operator
// menanyakan hal lain: "project saya sedang di mana?". Menggabungkan semua
// project dalam satu papan membuat dua project yang tidak saling berhubungan
// terlihat seperti satu aliran kerja, dan kolom "Menunggu Anda" kehilangan
// artinya — menunggu Anda, pada project yang mana?
//
// KENAPA KOLOMNYA ACCORDION VERTIKAL
//
// Enam kolom × N project tidak muat di layar mana pun. Melipat kolom yang
// kosong (dan kolom yang tidak sedang dilihat) membuat papan tetap terbaca
// tanpa menyembunyikan bahwa kolom itu ada — nol yang terlihat adalah
// informasi, kolom yang hilang bukan.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
  Clock,
  Hourglass,
  ListChecks,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  COLUMNS,
  columnFor,
  relativeTime,
  semanggi,
  type CatalogModel,
  type ColumnId,
  type ProjectSummary,
  type Task,
} from "@/lib/semanggi/client";
import { Badge, Button, Card, Empty, getProjectAccentRgb, LoadError, PageShell, Select, statusTone } from "./ui";
import { TaskDialog } from "./task-dialog";

const REFRESH_MS = 15_000;

/**
 * A column scrolls instead of growing past this height. A board with six
 * columns across several projects has to stay scannable — an "attention"
 * column with thirty tasks would otherwise push every other project off the
 * screen. Fixed in px (not a card-count multiple) so every column's scroll
 * boundary lines up at the same height regardless of how tall any one card
 * happens to render.
 */
const TASK_LIST_MAX_HEIGHT_PX = 445;

export function SummaryPage({ activeWorkspacePath }: { activeWorkspacePath?: string | null }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("workspace");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const [summary, taskList] = await Promise.all([semanggi.projectSummary(), semanggi.tasks()]);
      setProjects(summary.projects);
      setTasks(taskList.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    semanggi
      .models()
      .then((m) => setModels(m.models))
      .catch(() => setModels([]));
  }, []);

  /**
   * Current-project filter.
   *
   * Semanggi projects are identified by `workspacePath`, and AgentOS's active
   * workspace is also a path — so the match is a path prefix, not a shared id.
   * That's a consequence, not a design choice: Semanggi hasn't yet synced
   * projects from AgentOS (the discovery task is still open), so the one
   * thing both genuinely share is where the files live. `activeWorkspacePath`
   * now comes from AgentOS's real `OperationsShellContext.activeWorkspace`,
   * passed down from `app/summary/page.tsx` — no more `?workspace=` hack.
   *
   * More than one Semanggi project can share the same workspace path (a
   * workspace can carry several parallel efforts), so "current project"
   * means exactly ONE project — the first match, same tie-break Control uses
   * for its own "Active Project" picker — not every project that happens to
   * touch that workspace. "All projects" is the escape hatch for the rest.
   */
  const currentProject = useMemo(() => {
    if (projects.length === 0) return null;
    const match = activeWorkspacePath
      ? projects.find(
          (p) => p.workspacePath && (p.workspacePath === activeWorkspacePath || p.workspacePath.startsWith(`${activeWorkspacePath}/`)),
        )
      : null;
    return match ?? projects[0];
  }, [projects, activeWorkspacePath]);

  const visibleProjects = useMemo(() => {
    if (scope === "all") return projects;
    return currentProject ? [currentProject] : [];
  }, [projects, scope, currentProject]);

  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = map.get(task.projectId) ?? [];
      list.push(task);
      map.set(task.projectId, list);
    }
    return map;
  }, [tasks]);

  // Explicit toggles are sticky (kept in `collapsed`); a column with no
  // manual toggle yet defaults to collapsed exactly when it's empty — an
  // empty column carries no information worth the vertical space, and one
  // that gains its first task should open on its own rather than stay
  // folded because of a toggle nobody set.
  const toggle = (projectId: string, column: ColumnId, currentlyCollapsed: boolean) =>
    setCollapsed((prev) => ({ ...prev, [`${projectId}:${column}`]: !currentlyCollapsed }));

  return (
    <PageShell
      title="Summary"
      description="Summary cards and a per-project work board. Columns follow the operator's vocabulary, not the state machine's."
      actions={
        <>
          <Select value={scope} onChange={setScope}>
            <option value="workspace">Current Project</option>
            <option value="all">All projects</option>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Reload
          </Button>
        </>
      }
    >
      {error ? <LoadError error={error} onRetry={load} /> : null}

      {!error && !loading && visibleProjects.length === 0 ? (
        <Empty>
          {scope === "workspace"
            ? "No current project to show. Choose “All projects” to see the rest."
            : "No projects in the controller yet."}
        </Empty>
      ) : null}

      <div className="space-y-8">
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            tasks={tasksByProject.get(project.id) ?? []}
            collapsed={collapsed}
            onToggle={toggle}
            onOpen={setOpenTask}
          />
        ))}
      </div>

      {openTask ? (
        <TaskDialog taskId={openTask} models={models} onClose={() => setOpenTask(null)} onChanged={() => void load()} />
      ) : null}
    </PageShell>
  );
}

/**
 * One card per project: info-metrics grid on top, the task-status accordion
 * board underneath — both inside the SAME `Card`, tinted by the project's
 * own accent color (see `getProjectAccentRgb`). They used to be two separate
 * elements (a `Card` followed by a plain `<div>`), which read as if the board
 * belonged to the page rather than to the project sitting right above it;
 * nesting the board inside the card makes that ownership visible, and the
 * shared accent ties both halves together as one project at a glance.
 */
function ProjectCard({
  project,
  tasks,
  collapsed,
  onToggle,
  onOpen,
}: {
  project: ProjectSummary;
  tasks: Task[];
  collapsed: Record<string, boolean>;
  onToggle: (projectId: string, column: ColumnId, currentlyCollapsed: boolean) => void;
  onOpen: (taskId: string) => void;
}) {
  const accentRgb = getProjectAccentRgb(project.id);

  // "Menunggu Anda" dipisahkan dari "menunggu sistem" di kartu paling atas,
  // karena hanya satu dari keduanya yang bisa diselesaikan hari ini oleh orang
  // yang sedang melihat layar.
  const cards: Array<{
    label: string;
    value: string | number;
    tone?: "warning" | "info";
    hint?: string;
    icon: LucideIcon;
    iconWrap: string;
  }> = [
    { label: "Total tasks", value: project.taskCount, icon: ListChecks, iconWrap: "border-border bg-muted text-muted-foreground" },
    { label: "Running", value: project.phase.running, tone: "info", icon: Activity, iconWrap: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300" },
    { label: "Queued", value: project.phase.queued, icon: Clock, iconWrap: "border-border bg-muted text-muted-foreground" },
    {
      label: "Waiting on system",
      value: project.phase.waiting,
      hint: "quota, lease, dependencies",
      icon: Hourglass,
      iconWrap: "border-border bg-muted text-muted-foreground",
    },
    {
      label: "Needs you",
      value: project.phase.needsAttention,
      tone: "warning",
      hint: "approvals, blocked, failed",
      icon: AlertTriangle,
      iconWrap: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    },
    {
      label: "Tokens used",
      value: project.tokens.toLocaleString("en-US"),
      hint: `${project.runs} run(s)`,
      icon: Sparkles,
      iconWrap: "border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300",
    },
  ];

  return (
    <Card
      accentRgb={accentRgb}
      title={
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: `rgb(${accentRgb})` }}
            aria-hidden
          />
          {project.name}
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">{project.id}</code>
          {project.needsAttention > 0 ? <Badge tone="warning">{project.needsAttention} need attention</Badge> : null}
        </span>
      }
      subtitle={`${project.workspacePath ?? "no workspace"} · last activity ${relativeTime(project.lastActivityAt)}`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="flex items-start gap-2 rounded-lg border border-border bg-background/60 px-3 py-2">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${c.iconWrap}`}>
              <c.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div
                className={`text-xl font-semibold ${
                  c.tone === "warning" && Number(c.value) > 0
                    ? "text-amber-600 dark:text-amber-300"
                    : c.tone === "info" && Number(c.value) > 0
                      ? "text-sky-600 dark:text-sky-300"
                      : ""
                }`}
              >
                {c.value}
              </div>
              {c.hint ? <div className="text-[10px] text-muted-foreground">{c.hint}</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="my-4 border-t" style={{ borderColor: `rgba(${accentRgb}, 0.18)` }} />

      <Board project={project} tasks={tasks} collapsed={collapsed} onToggle={onToggle} onOpen={onOpen} />
    </Card>
  );
}

function Board({
  project,
  tasks,
  collapsed,
  onToggle,
  onOpen,
}: {
  project: ProjectSummary;
  tasks: Task[];
  collapsed: Record<string, boolean>;
  onToggle: (projectId: string, column: ColumnId, currentlyCollapsed: boolean) => void;
  onOpen: (taskId: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<ColumnId, Task[]>();
    for (const column of COLUMNS) map.set(column.id, []);
    for (const task of tasks) map.get(columnFor(task.status))!.push(task);
    for (const list of map.values()) {
      list.sort((a, b) => b.effectivePriority - a.effectivePriority || b.updatedAt - a.updatedAt);
    }
    return map;
  }, [tasks]);

  return (
    <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {COLUMNS.map((column) => {
        const list = grouped.get(column.id) ?? [];
        const key = `${project.id}:${column.id}`;
        const isCollapsed = collapsed[key] ?? list.length === 0;
        return (
          <div key={column.id} className="rounded-lg border border-border bg-muted/30">
            <button
              onClick={() => onToggle(project.id, column.id, isCollapsed)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              aria-expanded={!isCollapsed}
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}>›</span>
                {column.label}
              </span>
              <Badge tone={column.id === "attention" && list.length > 0 ? "warning" : "neutral"}>{list.length}</Badge>
            </button>
            {!isCollapsed ? (
              <div
                className="space-y-2 overflow-y-auto px-2 pb-2"
                style={{ maxHeight: `${TASK_LIST_MAX_HEIGHT_PX}px` }}
              >
                {list.length === 0 ? (
                  <div className="px-1 py-3 text-center text-[11px] text-muted-foreground">empty</div>
                ) : (
                  list.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />)
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (taskId: string) => void }) {
  return (
    <button
      onClick={() => onOpen(task.id)}
      className="w-full rounded-md border border-border bg-background px-2 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="text-[10px] text-muted-foreground">{task.id}</code>
        {task.expedited ? <Badge tone="warning">expedited</Badge> : null}
      </div>
      <div className="mt-1 line-clamp-2 text-xs font-medium">{task.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
        <Badge tone="neutral">{task.qualityClass}</Badge>
      </div>
      {task.waitReason ? (
        <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground" title={task.waitReason}>
          {task.waitReason}
        </div>
      ) : null}
    </button>
  );
}
