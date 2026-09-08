"use client";

// Primitif tampilan untuk halaman Semanggi.
//
// Sengaja hanya memakai kelas Tailwind dan elemen HTML biasa, tanpa mengimpor
// komponen internal AgentOS. Alasannya bukan gaya melainkan umur: setiap impor
// ke `@/components/mission-control/...` adalah satu titik yang bisa patah saat
// AgentOS di-upgrade, dan D34 sudah menunjukkan biaya menebak-nebak permukaan
// hulu. Yang ditiru adalah bahasa visualnya (kartu, lencana status, toolbar),
// bukan kodenya.

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col gap-6 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/**
 * 12-color accent palette + hash, copied in spirit (not in code — see the
 * file header) from AgentOS's own `lib/openclaw/workspace-colors.ts`, which
 * gives each workspace node on the Mission Control canvas a stable color by
 * hashing its id. Same shape here: a project id always resolves to the same
 * one of 12 accents, so a project's color is recognizable at a glance across
 * a page reload rather than reshuffling.
 */
const PROJECT_ACCENT_PALETTE = [
  "34, 211, 238",
  "59, 130, 246",
  "99, 102, 241",
  "139, 92, 246",
  "168, 85, 247",
  "236, 72, 153",
  "244, 63, 94",
  "249, 115, 22",
  "245, 158, 11",
  "34, 197, 94",
  "20, 184, 166",
  "14, 165, 233",
] as const;

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

export function getProjectAccentRgb(projectId: string) {
  const seed = projectId.trim() || projectId;
  return PROJECT_ACCENT_PALETTE[hashString(seed) % PROJECT_ACCENT_PALETTE.length];
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  accentRgb,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  // When set, the card takes on the translucent, blurred "cockpit" surface
  // used elsewhere in Mission Control (Settings' own panels, the Dashboard's
  // stat cards) instead of the flat default, tinted by this color — see
  // `getProjectAccentRgb`. Left unset, every existing caller (Brains, Role
  // Map, Brain Map, Settings' Project panel) keeps today's flat `bg-card`
  // look untouched.
  accentRgb?: string;
}) {
  const surface = accentRgb
    ? "border-transparent bg-card/95 shadow-[0_16px_40px_rgba(0,0,0,0.10)] backdrop-blur-xl"
    : "border-border bg-card shadow-sm";
  return (
    <section
      className={`rounded-xl border text-card-foreground ${surface} ${className}`}
      style={
        accentRgb
          ? {
              borderColor: `rgba(${accentRgb}, 0.35)`,
              backgroundImage: `radial-gradient(circle at 12% 0%, rgba(${accentRgb}, 0.14), transparent 45%), radial-gradient(circle at 92% 100%, rgba(${accentRgb}, 0.08), transparent 42%)`,
            }
          : undefined
      }
    >
      {title || actions ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"
          style={accentRgb ? { borderColor: `rgba(${accentRgb}, 0.22)` } : undefined}
        >
          <div>
            <div className="text-sm font-medium">{title}</div>
            {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-sky-500/10 text-sky-600 border-sky-500/30 dark:text-sky-300",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-600 border-red-500/30 dark:text-red-300",
};

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Nada per status.
 *
 * "Menunggu Anda" sengaja diberi nada peringatan sementara seluruh WAIT_* lain
 * netral: keduanya sama-sama "tidak bergerak", tetapi hanya satu yang bisa
 * diselesaikan orang yang sedang melihat layar.
 */
export function statusTone(status: string): Tone {
  if (["RUNNING", "DISPATCHED"].includes(status)) return "info";
  if (status === "COMPLETE") return "success";
  if (["FAILED", "BLOCKED"].includes(status)) return "danger";
  if (status === "WAIT_HUMAN") return "warning";
  if (status === "CANCELLED") return "neutral";
  return "neutral";
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  title,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "outline" | "ghost" | "danger" | "link";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
  const sizes = { sm: "h-7 px-2 text-xs", md: "h-9 px-3 text-sm" };
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
    ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground",
    danger: "border border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-300",
    // Plain text, like a link — no border, no fill. Deliberately carries no
    // text color of its own (unlike the other variants): a row of these next
    // to each other (Edit / Disable / Test) needs one to turn green or amber
    // on a result without a baked-in color fighting that override, so every
    // caller supplies its own `text-*` via `className` instead.
    link: "bg-transparent hover:underline underline-offset-2",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * Copy text to the clipboard, reporting success honestly.
 *
 * `navigator.clipboard` only exists in SECURE contexts — and the cluster's
 * UI is served over plain HTTP from a non-localhost origin, where the modern
 * API is simply absent. The legacy textarea path is therefore not a
 * fallback for old browsers but the path that actually runs in production;
 * both are tried, and failure is returned (not thrown) so a caller can
 * choose not to flash a fake "copied" checkmark.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or a non-secure context rejecting the promise —
    // fall through to the legacy path before giving up.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off-screen but still rendered — a display:none node has nothing for
    // execCommand to select.
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy-to-clipboard affordance with a brief "copied" checkmark.
 *
 * Two shapes because it lives in two kinds of places:
 *  - `as="button"` (default) — its own button, for headers and regions.
 *  - `as="span"` — for sites already INSIDE a clickable card/row rendered
 *    as a real <button> (task cards, registered-task rows): a button nested
 *    in a button is invalid HTML, so the affordance degrades to a span with
 *    a click handler. The click ALWAYS stops propagation, or copying a task
 *    id would also open the task.
 *
 * The icon defaults to 1em so it tracks the surrounding font size — the
 * caller sets the text size context, the icon follows.
 */
export function CopyButton({
  text,
  label = "Copy to clipboard",
  as = "button",
  className = "",
  iconClassName = "h-[1em] w-[1em]",
}: {
  text: string;
  label?: string;
  as?: "button" | "span";
  className?: string;
  iconClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const handle = async (event: { stopPropagation: () => void; preventDefault: () => void }) => {
    event.stopPropagation();
    event.preventDefault();
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };
  const icon = copied ? <Check className={iconClassName} /> : <Copy className={iconClassName} />;
  const shared = {
    title: copied ? "Copied" : label,
    "aria-label": label,
    onClick: (event: ReactMouseEvent) => void handle(event),
    className: `inline-flex shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className}`,
  };
  return as === "span" ? (
    <span role="button" tabIndex={-1} {...shared}>
      {icon}
    </span>
  ) : (
    <button type="button" {...shared}>
      {icon}
    </button>
  );
}

/**
 * Small modal dialog, used for Add/Edit Brain.
 *
 * A dedicated primitive rather than reusing `TaskDialog`'s inline markup: that
 * one is built around a task's specific tabs and controls, and forcing a form
 * dialog through the same shape would couple two things that change for
 * different reasons.
 */
// Modals stack (D78's Process Manager opens a Create-spec modal ON TOP of
// itself): without bookkeeping, ONE Escape closed every layer at once, because
// each overlay listens on window independently. A mount-ordered stack lets
// only the topmost modal answer. Overlay clicks need no such guard — the
// later portal always paints above and takes the pointer event.
const modalStack: number[] = [];
let nextModalId = 1;

/**
 * Register a modal-like layer in the shared Escape stack. Extracted from
 * Modal (D79) because TaskDialog renders its own overlay markup yet now
 * stacks ON TOP of Process Manager — an overlay outside the stack would
 * answer Escape twice (its own listener plus the layer beneath it) and paint
 * under a portaled Modal at the same z. The callback decides what "answering
 * Escape" means (TaskDialog dismisses its side panel first).
 */
export function useModalLayer(onEscape: () => void) {
  const modalIdRef = useRef(nextModalId++);
  // Latest-callback ref: the effect registers once, but the semantics of the
  // escape can change with state (side panel open or not).
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    modalStack.push(modalIdRef.current);
    return () => {
      const index = modalStack.indexOf(modalIdRef.current);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stacked modals: only the topmost layer answers, so Escape peels one
      // layer at a time instead of dismissing the whole stack underneath a
      // form the operator is still filling in.
      if (modalStack[modalStack.length - 1] !== modalIdRef.current) return;
      escapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Modal({
  title,
  subtitle,
  actions,
  onClose,
  children,
  width = "max-w-2xl",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  // Rendered inline NEXT TO the title, not on the right edge: an action that
  // belongs to the thing named in the title (DocModal's Edit/Save acts on the
  // document the title names) should sit with it. A button floated in the
  // body instead moved between read and edit mode and read as page chrome.
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useModalLayer(onClose);

  // Portal to document.body — required, not cosmetic. The Mission Control
  // shell renders the content column inside `relative z-20`, which is a
  // stacking context: any overlay inside it, however large its z-index, is
  // capped at that z-20 layer and paints UNDER the fixed sidebar (z-30) —
  // exactly the "modal loses to the sidebar" bug (2026-09-05). A portal
  // mounts the overlay outside that context, where its own z-index is
  // meaningful again. z-[70] clears every shell layer (sidebar z-30, mobile
  // drawer z-50) except the mobile top bar's toasts.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        className={`w-full ${width} rounded-xl border border-border bg-background shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold">{title}</h2>
              {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
            {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Text input with dropdown suggestions the user can still override by typing.
 *
 * Provider and model are exactly this shape: the gateway only reports models
 * it currently has onboarded (`GET .../gateway/models`), which is a small,
 * live-changing subset of everything a Brain could reasonably point at (an
 * ACP provider like `claude-code`, or a provider not onboarded yet). A strict
 * `<select>` would make those impossible to enter; a plain `<input>` would
 * lose the convenience of picking from what's known. `<input list>` gives
 * both without inventing a new widget.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  return (
    <>
      <input
        list={listId}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}

export function Select({
  value,
  onChange,
  children,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${className}`}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1${className ? ` ${className}` : ""}`}>
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone = "warning", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-md border px-3 py-2 text-xs ${TONE_CLASS[tone]}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{children}</div>;
}

/**
 * Load failures are shown, not hidden.
 *
 * An empty screen because the controller is unreachable and an empty screen
 * because there's simply no work look identical to an operator — and each
 * one calls for a different next step.
 */
export function LoadError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Notice tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{error}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </Notice>
  );
}
