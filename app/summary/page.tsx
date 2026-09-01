// Semanggi Summary page.
//
// Wrapped in AgentOS's own `OperationsShell` so it renders with the same
// sidebar as every other Operations page, and so its "active workspace"
// filter comes from the real thing AgentOS tracks (`context.activeWorkspace`)
// rather than a `?workspace=<path>` query-string stand-in.
//
// This file itself is a Server Component (it awaits the `server-only`
// `getInitialControlPlaneSnapshot()`), so it cannot hand `OperationsShell`'s
// render-prop `children` function directly — functions can't cross the
// server/client boundary as props. `SemanggiSummaryShell` is the Client
// Component that owns that render function; this page only fetches the
// snapshot and passes it down as plain data.

import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";
import { SemanggiSummaryShell } from "@/components/semanggi/summary-shell";

export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <SemanggiSummaryShell initialSnapshot={snapshot} />;
}
