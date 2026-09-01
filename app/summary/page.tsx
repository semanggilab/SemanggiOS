// Semanggi Summary page.
//
// Wrapped in AgentOS's own `OperationsShell` so it renders with the same
// sidebar as every other Operations page, and so its "active workspace"
// filter comes from the real thing AgentOS tracks (`context.activeWorkspace`)
// rather than a `?workspace=<path>` query-string stand-in. The stand-in was a
// stopgap for exactly this — see the previous version of this file — and is
// removed now that the real hook is being used.

import { OperationsShell } from "@/components/operations/operations-shell";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";
import { SummaryPage as SemanggiSummaryPage } from "@/components/semanggi/summary-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return (
    <OperationsShell initialSnapshot={snapshot}>
      {(context) => <SemanggiSummaryPage activeWorkspacePath={context.activeWorkspace?.path ?? null} />}
    </OperationsShell>
  );
}
