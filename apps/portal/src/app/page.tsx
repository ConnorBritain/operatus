import Link from "next/link";
import Image from "next/image";
import { AuthPanel } from "@/app/_components/auth-panel";
import { PairingPanel } from "@/app/_components/pairing-panel";
import { NodeControls } from "@/app/_components/node-controls";
import { LiveUpdater } from "@/app/_components/live-updater";
import { DeviceRegistrar } from "@/app/_components/device-registrar";
import { signOut } from "@/app/actions";
import { requireUser } from "@/lib/auth";

type PageProps = { searchParams: Promise<{ workspace?: string }> };

function relativeTime(value: string | null) {
  if (!value) return "Not connected yet";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function isRecentlyOnline(lastSeenAt: string | null, status: string) {
  return status === "online" && Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 90_000);
}

function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-illustration" aria-label="Atelier remote studio">
        <div className="brand-lockup">
          <Image src="/atelier-mark.svg" alt="" width={54} height={54} priority />
          <span>Atelier</span>
        </div>
        <div className="studio-scene" aria-hidden="true">
          <div className="window"><i /><i /><i /></div>
          <div className="desk desk-one"><span /><b /></div>
          <div className="desk desk-two"><span /><b /></div>
          <div className="plant"><i /><i /><i /></div>
          <div className="floor-grid" />
        </div>
        <div className="login-copy">
          <span className="eyebrow">Your studios, within reach</span>
          <h1>Drop into the office from anywhere.</h1>
          <p>See every branch, follow conducted work, and send only the narrow commands each machine is prepared to accept.</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">Remote studio access</span>
          <h2>Welcome to Atelier</h2>
          <p className="muted">Sign in to see the machines and workspaces tied to your identity.</p>
          <AuthPanel />
          <p className="trust-note">Your browser never receives node credentials or arbitrary shell access. Local Atelier remains run and Git authority.</p>
        </div>
      </section>
    </main>
  );
}

export default async function Home({ searchParams }: PageProps) {
  const { userId, supabase } = await requireUser();
  if (!userId) return <LoginPage />;

  const [{ data: profile }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url").eq("user_id", userId).maybeSingle(),
    supabase.from("workspace_memberships").select("workspace_id, role").eq("user_id", userId).eq("status", "active"),
  ]);

  if (membershipError) {
    return (
      <main className="center-stage">
        <section className="paper-card narrow-card">
          <span className="eyebrow">Identity connected</span>
          <h1>The studio directory is being prepared.</h1>
          <p>Your Supabase session is valid, but the Atelier control-plane schema is not available yet.</p>
        </section>
      </main>
    );
  }

  const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
  const { workspace: requestedWorkspace } = await searchParams;
  const selectedWorkspaceId = workspaceIds.includes(requestedWorkspace ?? "") ? requestedWorkspace! : workspaceIds[0];

  const [workspaceResult, branchResult, nodeResult, runResult] = selectedWorkspaceId
    ? await Promise.all([
        supabase.from("workspaces").select("id, name, slug").in("id", workspaceIds).order("created_at"),
        supabase.from("branches").select("id, workspace_id, name, slug, theme").eq("workspace_id", selectedWorkspaceId).order("created_at"),
        supabase.from("nodes").select("id, workspace_id, branch_id, name, hostname, platform, architecture, app_version, status, last_seen_at, revoked_at").eq("workspace_id", selectedWorkspaceId).is("revoked_at", null).order("created_at"),
        supabase.from("run_projections").select("id, node_id, title, phase, terminal_status, artifact_sha, run_version, updated_at").eq("workspace_id", selectedWorkspaceId).order("updated_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const workspaces = workspaceResult.data ?? [];
  const branches = branchResult.data ?? [];
  const nodes = nodeResult.data ?? [];
  const runs = runResult.data ?? [];
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const membership = memberships?.find((item) => item.workspace_id === selectedWorkspaceId);
  const latestRunByNode = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!latestRunByNode.has(run.node_id)) latestRunByNode.set(run.node_id, run);
  const onlineCount = nodes.filter((node) => isRecentlyOnline(node.last_seen_at, node.status)).length;

  return (
    <div className="portal-shell">
      <DeviceRegistrar />
      <LiveUpdater />
      <header className="topbar">
        <Link className="brand-lockup compact" href="/">
          <Image src="/atelier-mark.svg" alt="" width={42} height={42} priority />
          <span>Atelier</span>
        </Link>
        <nav className="workspace-switcher" aria-label="Workspaces">
          {workspaces.map((workspace) => (
            <Link key={workspace.id} className={workspace.id === selectedWorkspaceId ? "active" : ""} href={`/?workspace=${workspace.id}`}>
              {workspace.name}
            </Link>
          ))}
        </nav>
        <div className="account-chip">
          <span className="avatar">{profile?.display_name?.slice(0, 1).toUpperCase() ?? "A"}</span>
          <span>{profile?.display_name ?? "Atelier member"}<small>{membership?.role ?? "member"}</small></span>
          <form action={signOut}><button className="text-button" type="submit">Sign out</button></form>
        </div>
      </header>

      <main className="portal-main">
        <section className="hero-row">
          <div>
            <span className="eyebrow">Remote operations floor</span>
            <h1>{selectedWorkspace?.name ?? "Your Atelier"}</h1>
            <p>{onlineCount} of {nodes.length} machines online · {runs.length} visible runs</p>
          </div>
          {branches[0] ? <PairingPanel workspaceId={selectedWorkspaceId} branchId={branches[0].id} /> : null}
        </section>

        {branches.length === 0 ? (
          <section className="paper-card empty-state">
            <span className="eyebrow">Fresh floor</span>
            <h2>No branches are visible yet.</h2>
            <p>The first branch is normally created with your account. Refresh after the identity migration finishes.</p>
          </section>
        ) : (
          <section className="branch-grid" aria-label="Office branches">
            {branches.map((branch) => {
              const branchNodes = nodes.filter((node) => node.branch_id === branch.id);
              return (
                <article className={`branch-card theme-${branch.theme}`} key={branch.id}>
                  <header className="branch-header">
                    <span className="branch-swatch" />
                    <div><span className="eyebrow">{branch.theme} branch</span><h2>{branch.name}</h2></div>
                    <span className="branch-count">{branchNodes.length} {branchNodes.length === 1 ? "machine" : "machines"}</span>
                  </header>
                  {branchNodes.length === 0 ? (
                    <div className="branch-empty">
                      <div className="empty-desk" aria-hidden="true"><i /><b /></div>
                      <p>No machine has joined this branch yet.</p>
                      <PairingPanel workspaceId={selectedWorkspaceId} branchId={branch.id} />
                    </div>
                  ) : (
                    <div className="node-list">
                      {branchNodes.map((node) => {
                        const latestRun = latestRunByNode.get(node.id);
                        const online = isRecentlyOnline(node.last_seen_at, node.status);
                        return (
                          <section className="node-card" key={node.id}>
                            <div className="node-heading">
                              <span className={`presence-dot ${online ? "online" : "offline"}`} />
                              <div><h3>{node.name}</h3><p>{node.hostname} · {node.platform}/{node.architecture}</p></div>
                              <span className="last-seen">{relativeTime(node.last_seen_at)}</span>
                            </div>
                            {latestRun ? (
                              <div className="run-strip">
                                <div>
                                  <span className="eyebrow">Current work</span>
                                  <strong>{latestRun.title}</strong>
                                  <p>{latestRun.phase.replaceAll("_", " ")}{latestRun.artifact_sha ? ` · ${latestRun.artifact_sha.slice(0, 8)}` : ""}</p>
                                </div>
                                <span className={`run-state ${latestRun.terminal_status ? "complete" : "active"}`}>
                                  {latestRun.terminal_status ?? "in progress"}
                                </span>
                              </div>
                            ) : <div className="quiet-state">No shared run is active.</div>}
                            <NodeControls nodeId={node.id} runId={latestRun?.id} runVersion={latestRun?.run_version} />
                          </section>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <footer className="portal-footer">
          <span><i className="presence-dot online" /> Identity-bound control plane</span>
          <span>Local nodes retain authority · Commands expire in five minutes</span>
        </footer>
      </main>
    </div>
  );
}
