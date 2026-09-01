// Semanggi Control page.
//
// Wrapped in `OperationsShell` for the same reason as the Summary page: the
// AgentOS sidebar, and a real `activeWorkspace` from AgentOS instead of a
// query-string stand-in. Control doesn't currently filter by workspace path
// (it works from the project picker inside ControlPage), so the context is
// available here for parity and future use rather than being consumed yet.

import { OperationsShell } from "@/components/operations/operations-shell";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";
import { ControlPage as SemanggiControlPage } from "@/components/semanggi/control-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <OperationsShell initialSnapshot={snapshot}>{() => <SemanggiControlPage />}</OperationsShell>;
}
