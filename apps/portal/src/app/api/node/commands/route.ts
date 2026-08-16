import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateNode } from "@/lib/node-auth";

export async function GET(request: NextRequest) {
  const identity = await authenticateNode(request);
  if (!identity) return NextResponse.json({ error: "NODE_UNAUTHENTICATED" }, { status: 401 });

  const { data, error } = await identity.admin.rpc("claim_operatus_commands", {
    node_token_hash: identity.tokenHash,
    command_limit: 20,
  });

  if (error) return NextResponse.json({ error: "COMMAND_POLL_FAILED" }, { status: 500 });
  const commands = data ?? [];
  const projectionIds = commands.flatMap((command) => command.run_projection_id ? [command.run_projection_id] : []);
  const projections = projectionIds.length
    ? await identity.admin.from("run_projections").select("id, local_run_id")
      .eq("node_id", identity.node.id).in("id", projectionIds)
    : { data: [], error: null };
  if (projections.error) return NextResponse.json({ error: "COMMAND_CONTEXT_FAILED" }, { status: 500 });
  const localRuns = new Map((projections.data ?? []).map((projection) => [projection.id, projection.local_run_id]));
  return NextResponse.json({
    commands: commands.map((command) => ({
      ...command,
      localRunId: command.run_projection_id ? localRuns.get(command.run_projection_id) ?? null : null,
    })),
  });
}
