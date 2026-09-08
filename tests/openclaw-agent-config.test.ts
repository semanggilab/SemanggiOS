import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { upsertAgentConfigEntry, type MutableAgentConfigEntry } from "@/lib/openclaw/domains/agent-config";

afterEach(() => {
  setOpenClawAdapterForTesting(null);
});

test("agent config upsert preserves omitted fields while updating identity and model", async () => {
  let config: MutableAgentConfigEntry[] = [
    {
      id: "agent-1",
      workspace: "/workspace",
      agentDir: "/workspace/.openclaw/agents/agent-1/agent",
      name: "Agent One",
      model: "openai/old",
      identity: {
        name: "Agent One",
        emoji: "A"
      }
    }
  ];

  setOpenClawAdapterForTesting({
    async getConfig(pathName: string) {
      if (pathName === "agents.entries") {
        return null;
      }
      assert.equal(pathName, "agents.list");
      return config;
    },
    async setConfig(pathName: string, value: unknown) {
      assert.equal(pathName, "agents.list");
      config = value as MutableAgentConfigEntry[];
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    model: "openai/new"
  });

  assert.deepEqual(config[0], {
    id: "agent-1",
    workspace: "/workspace",
    agentDir: "/workspace/.openclaw/agents/agent-1/agent",
    name: "Agent One",
    model: "openai/new",
    identity: {
      name: "Agent One",
      emoji: "A"
    }
  });

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    identity: {
      name: "Agent Prime",
      theme: "violet"
    }
  });

  assert.equal(config[0]?.name, "Agent One");
  assert.deepEqual(config[0]?.identity, {
    name: "Agent Prime",
    theme: "violet"
  });
});

test("agent config reads and writes the OpenClaw 2026.8.2 agents.entries registry", async () => {
  let entries: Record<string, Record<string, unknown>> = {
    "agent-1": {
      workspace: "/workspace",
      name: "Agent One",
      model: "openai/old",
      skills: ["read", "write"]
    }
  };
  const writes: Array<{ pathName: string; value: unknown }> = [];

  setOpenClawAdapterForTesting({
    async getConfig(pathName: string) {
      assert.equal(pathName, "agents.entries");
      return entries;
    },
    async setConfig(pathName: string, value: unknown) {
      writes.push({ pathName, value });
      entries = value as Record<string, Record<string, unknown>>;
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await upsertAgentConfigEntry("agent-1", "/workspace", { model: "openai/new" });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.pathName, "agents.entries");
  assert.deepEqual(writes[0]?.value, {
    "agent-1": {
      workspace: "/workspace",
      name: "Agent One",
      model: "openai/new",
      skills: ["read", "write"]
    }
  });
  assert.equal("id" in entries["agent-1"]!, false);
});

test("agent config maps only supported Worker Profile runtime fields and preserves unknown tool settings", async () => {
  let config: MutableAgentConfigEntry[] = [
    {
      id: "agent-1",
      workspace: "/workspace",
      tools: {
        alsoAllow: ["web_fetch"],
        fs: {
          workspaceOnly: false
        }
      },
      sandbox: {
        backend: "docker"
      }
    }
  ];

  setOpenClawAdapterForTesting({
    async getConfig<TPayload>() {
      return config as TPayload;
    },
    async setConfig(_pathName: string, value: unknown) {
      config = value as MutableAgentConfigEntry[];
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    description: "Deliver a concise daily brief.",
    tools: {
      profile: "coding",
      allow: ["read", "write", "read"],
      deny: ["browser"],
      fs: { workspaceOnly: true }
    },
    sandbox: {
      mode: "all",
      scope: "agent",
      workspaceAccess: "ro"
    },
    memorySearch: {
      enabled: true,
      sources: ["memory", "sessions", "memory"]
    }
  });

  assert.deepEqual(config[0]?.tools, {
    alsoAllow: ["web_fetch"],
    profile: "coding",
    allow: ["read", "write"],
    deny: ["browser"],
    fs: {
      workspaceOnly: true
    }
  });
  assert.deepEqual(config[0]?.sandbox, {
    backend: "docker",
    mode: "all",
    scope: "agent",
    workspaceAccess: "ro"
  });
  assert.deepEqual(config[0]?.memorySearch, {
    enabled: true,
    sources: ["memory", "sessions"]
  });
  assert.equal(config[0]?.description, "Deliver a concise daily brief.");
});
