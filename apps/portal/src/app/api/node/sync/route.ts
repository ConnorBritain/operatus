import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateNode } from "@/lib/node-auth";
import { nodeSyncSchema } from "@/lib/protocol";
import type { Database } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  const identity = await authenticateNode(request);
  if (!identity) return NextResponse.json({ error: "NODE_UNAUTHENTICATED" }, { status: 401 });

  const parsed = nodeSyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const now = new Date().toISOString();
  const nodeUpdate: Database["public"]["Tables"]["nodes"]["Update"] = { status: parsed.data.status, last_seen_at: now };
  if (parsed.data.appVersion) nodeUpdate.app_version = parsed.data.appVersion;
  if (parsed.data.capabilities) nodeUpdate.capabilities = parsed.data.capabilities;

  const { error: nodeError } = await identity.admin.from("nodes").update(nodeUpdate)
    .eq("id", identity.node.id).is("revoked_at", null);
  if (nodeError) return NextResponse.json({ error: "NODE_UPDATE_FAILED" }, { status: 500 });

  const repositoryIds = new Map<string, string>();
  for (const repository of parsed.data.repositories) {
    const { data, error } = await identity.admin.from("repositories").upsert({
      workspace_id: identity.node.workspace_id,
      node_id: identity.node.id,
      local_repository_id: repository.localRepositoryId,
      display_name: repository.displayName,
      remote_host: repository.remoteHost ?? null,
      remote_owner: repository.remoteOwner ?? null,
      remote_name: repository.remoteName ?? null,
      last_seen_at: now,
    }, { onConflict: "node_id,local_repository_id" }).select("id, local_repository_id").single();
    if (error || !data) return NextResponse.json({ error: "REPOSITORY_SYNC_FAILED" }, { status: 500 });
    repositoryIds.set(data.local_repository_id, data.id);
  }

  for (const run of parsed.data.runs) {
    const { error } = await identity.admin.from("run_projections").upsert({
      workspace_id: identity.node.workspace_id,
      node_id: identity.node.id,
      repository_id: run.localRepositoryId ? repositoryIds.get(run.localRepositoryId) ?? null : null,
      local_run_id: run.localRunId,
      title: run.title,
      phase: run.phase,
      terminal_status: run.terminalStatus ?? null,
      artifact_sha: run.artifactSha ?? null,
      run_version: run.runVersion,
      snapshot: run.snapshot,
      started_at: run.startedAt ?? null,
      completed_at: run.completedAt ?? null,
      updated_at: now,
    }, { onConflict: "node_id,local_run_id" });
    if (error) return NextResponse.json({ error: "RUN_SYNC_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ acceptedAt: now, repositories: repositoryIds.size, runs: parsed.data.runs.length });
}
