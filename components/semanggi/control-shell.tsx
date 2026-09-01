"use client";

// Client-side wrapper around `OperationsShell` for the Control page.
//
// Same reason as `summary-shell.tsx`: `OperationsShell`'s `children` render
// function has to be defined inside a Client Component. `app/control/page.tsx`
// is a Server Component (it awaits the server-only snapshot loader), so it
// can only hand this component a plain, serializable `initialSnapshot` — the
// render-prop closure lives here instead.

import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { OperationsShell } from "@/components/operations/operations-shell";
import { ControlPage } from "./control-page";

export function SemanggiControlShell({ initialSnapshot }: { initialSnapshot: MissionControlSnapshot }) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot}>
      {(context) => <ControlPage activeWorkspacePath={context.activeWorkspace?.path ?? null} />}
    </OperationsShell>
  );
}
