// Semanggi Control page.
//
// Wrapped in `OperationsShell` for the same reason as the Summary page: the
// AgentOS sidebar, and a real `activeWorkspace` from AgentOS instead of a
// query-string stand-in. See `app/summary/page.tsx` for why the render-prop
// `children` function lives in a separate Client Component
// (`SemanggiControlShell`) rather than inline here.

import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";
import { SemanggiControlShell } from "@/components/semanggi/control-shell";

export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <SemanggiControlShell initialSnapshot={snapshot} />;
}
