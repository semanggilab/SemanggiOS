#!/bin/sh
set -eu

umask 077

service_role=$(printf '%s' "${AGENTOS_SERVICE_ROLE:-agentos}" | tr '[:upper:]' '[:lower:]')

if [ "$service_role" = "browser-worker" ]; then
  export AGENTOS_BROWSER_WORKER_HOST="${AGENTOS_BROWSER_WORKER_HOST:-::}"
  export AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX="${AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX:-1}"
  exec /agentos/scripts/railway-browser-worker-entrypoint.sh
fi

# Railway can inject a service PORT even when its generated public domain still
# targets the template default (3000). Keep the public proxy and Next.js listener
# aligned for every fresh template deployment.
export PORT=3000

if [ "${RAILWAY_ENVIRONMENT_ID:-}" != "" ] && [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != "/data" ]; then
  echo "AgentOS requires a Railway volume mounted at /data." >&2
  exit 1
fi

# Swarm delivers secrets as files under /run/secrets/<name>, never as plain
# env vars (unlike Railway, where these arrive as env directly) - fall back to
# reading the secret file when the env var itself is not set, so the same
# entrypoint works on both platforms without the stack yml having to fake an
# env-var-from-secret mechanism Swarm doesn't have.
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(cat /run/secrets/openclaw_gateway_token 2>/dev/null || true)}"
export AGENTOS_API_TOKEN="${AGENTOS_API_TOKEN:-$(cat /run/secrets/agentos_api_token 2>/dev/null || true)}"
export AGENTOS_INITIAL_ADMIN_PASSWORD="${AGENTOS_INITIAL_ADMIN_PASSWORD:-$(cat /run/secrets/agentos_initial_admin_password 2>/dev/null || true)}"
export AGENTOS_BROWSER_WORKER_TOKEN="${AGENTOS_BROWSER_WORKER_TOKEN:-$(cat /run/secrets/browser_worker_token 2>/dev/null || true)}"

if [ "${OPENCLAW_GATEWAY_TOKEN:-}" = "" ]; then
  echo "OPENCLAW_GATEWAY_TOKEN is required. Configure it with a generated Railway template secret." >&2
  exit 1
fi

if [ "${AGENTOS_API_TOKEN:-}" = "" ]; then
  echo "AGENTOS_API_TOKEN is required. Configure it with a generated Railway template secret." >&2
  exit 1
fi

mkdir -p /data/agentos/mission-control /data/browser-profiles /data/openclaw /data/openclaw-config /data/workspaces
chown node:node \
  /data \
  /data/agentos \
  /data/agentos/mission-control \
  /data/browser-profiles \
  /data/openclaw \
  /data/openclaw-config \
  /data/workspaces
chmod 0700 \
  /data/agentos \
  /data/agentos/mission-control \
  /data/browser-profiles \
  /data/openclaw \
  /data/openclaw-config \
  /data/workspaces

if [ ! -s /data/agentos/instance-protection.json ] && [ "${AGENTOS_INITIAL_ADMIN_PASSWORD:-}" = "" ]; then
  echo "AGENTOS_INITIAL_ADMIN_PASSWORD is required for the first deployment." >&2
  exit 1
fi

exec gosu node:node node /agentos/scripts/railway-supervisor.mjs
