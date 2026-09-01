"use client";

// Primitif tampilan untuk halaman Semanggi.
//
// Sengaja hanya memakai kelas Tailwind dan elemen HTML biasa, tanpa mengimpor
// komponen internal AgentOS. Alasannya bukan gaya melainkan umur: setiap impor
// ke `@/components/mission-control/...` adalah satu titik yang bisa patah saat
// AgentOS di-upgrade, dan D34 sudah menunjukkan biaya menebak-nebak permukaan
// hulu. Yang ditiru adalah bahasa visualnya (kartu, lencana status, toolbar),
// bukan kodenya.

import { useEffect, useId, type ReactNode } from "react";

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

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-card text-card-foreground shadow-sm ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
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

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
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
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
  const sizes = { sm: "h-7 px-2 text-xs", md: "h-9 px-3 text-sm" };
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
    ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground",
    danger: "border border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-300",
  };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
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
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = "max-w-2xl",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        className={`w-full ${width} rounded-xl border border-border bg-background shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
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
