"use client";

// Client-side wrapper around `OperationsShell` for the Summary page.
//
// WHY THIS FILE EXISTS
//
// `OperationsShell`'s `children` prop is a render function: `(context) =>
// ReactNode`. `app/summary/page.tsx` is a Server Component — it has to be,
// since it calls the `server-only` `getInitialControlPlaneSnapshot()`. A
// Server Component cannot pass a function as a prop to a Client Component;
// functions aren't serializable across that boundary, and Next.js throws
// "Functions cannot be passed directly to Client Components" at render time.
// The render-prop function has to be defined *inside* the client boundary —
// which is exactly what this file is. The server page only fetches data and
// hands it to this client component as a plain (serializable) object.

import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { OperationsShell } from "@/components/operations/operations-shell";
import { SummaryPage } from "./summary-page";

export function SemanggiSummaryShell({ initialSnapshot }: { initialSnapshot: MissionControlSnapshot }) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot}>
      {(context) => <SummaryPage activeWorkspacePath={context.activeWorkspace?.path ?? null} />}
    </OperationsShell>
  );
}
