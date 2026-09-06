import { NextResponse } from "next/server";
import { z } from "zod";

import { deployWorkspacePlan } from "@/lib/agentos/planner";
import type {
  OperationProgressSnapshot,
  WorkspacePlanDeployStreamEvent
} from "@/lib/agentos/contracts";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deploySchema = z.object({
  plan: z.any().optional(),
  stream: z.boolean().optional()
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  const permission = await requireAgentOsProductPermission(request, "missions.use");
  if ("response" in permission) return permission.response;

  try {
    const { planId } = await context.params;
    const input = deploySchema.parse(await request.json());

    if (!input.stream) {
      const result = await deployWorkspacePlan(planId, input.plan, { actor: permission.actor });
      return NextResponse.json(redactSecrets(result));
    }

    const encoder = new TextEncoder();
    let latestProgress: OperationProgressSnapshot | undefined;

    // See app/api/workspaces/route.ts for why this is a plain ReadableStream
    // rather than the writable side of a TransformStream: the latter
    // intermittently ended the chunked response one write short of its
    // terminator on this stack, which Chrome reports as
    // ERR_INCOMPLETE_CHUNKED_ENCODING even though the client had already
    // received every NDJSON line, including "done".
    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: WorkspacePlanDeployStreamEvent) => {
          const safeEvent = redactSecrets(event);
          controller.enqueue(encoder.encode(`${JSON.stringify(safeEvent)}\n`));
        };

        try {
          const result = await deployWorkspacePlan(planId, input.plan, {
            actor: permission.actor,
            onProgress: async (progress) => {
              latestProgress = progress;
              send({
                type: "progress",
                progress
              });
            }
          });

          send({
            type: "done",
            ok: true,
            progress:
              latestProgress ??
              ({
                title: "Deploying workspace",
                description: "Planner deploy finished.",
                percent: 100,
                steps: []
              } satisfies OperationProgressSnapshot),
            result
          });
        } catch (error) {
          send({
            type: "done",
            ok: false,
            error: redactErrorMessage(error, "Unable to deploy planner workspace."),
            progress: latestProgress
          });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to deploy planner workspace.")
      },
      { status: 400 }
    );
  }
}
