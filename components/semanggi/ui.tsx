"use client";

// Primitif tampilan untuk halaman Semanggi.
//
// Sengaja hanya memakai kelas Tailwind dan elemen HTML biasa, tanpa mengimpor
// komponen internal AgentOS. Alasannya bukan gaya melainkan umur: setiap impor
// ke `@/components/mission-control/...` adalah satu titik yang bisa patah saat
// AgentOS di-upgrade, dan D34 sudah menunjukkan biaya menebak-nebak permukaan
// hulu. Yang ditiru adalah bahasa visualnya (kartu, lencana status, toolbar),
// bukan kodenya.

import { type ReactNode } from "react";

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
 * Kegagalan muat ditampilkan, tidak disembunyikan.
 *
 * Layar kosong karena controller tidak terjangkau dan layar kosong karena tidak
 * ada pekerjaan terlihat sama persis bagi operator — dan keduanya menuntun ke
 * tindakan yang berbeda.
 */
export function LoadError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Notice tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{error}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
      </div>
    </Notice>
  );
}
