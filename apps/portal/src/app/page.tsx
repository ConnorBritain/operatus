import Link from "next/link";
import { AuthPanel } from "@/app/_components/auth-panel";
import { AppearanceSync } from "@/app/_components/appearance-sync";
import { BrandWordmark, PortalHeader } from "@/app/_components/portal-chrome";
import { PairingPanel } from "@/app/_components/pairing-panel";
import { NodeControls } from "@/app/_components/node-controls";
import { LiveUpdater } from "@/app/_components/live-updater";
import { DeviceRegistrar } from "@/app/_components/device-registrar";
import { toggleFavorite } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import type { MachineScope } from "@/lib/database.types";

type PageProps = { searchParams: Promise<{ workspace?: string; scope?: string }> };

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
      <section className="login-illustration" aria-label="Remote venture operations floor">
        <BrandWordmark className="hero-wordmark" />
        <img
          aria-hidden="true"
          className="login-office-art"
          decoding="async"
          fetchPriority="high"
          height="1086"
          src="/operatus-office-collaboration.webp"
          width="1448"
        />
        <div className="login-copy">
          <span className="eyebrow">The firm, in motion</span>
          <h1>Every branch.<br />One firm.</h1>
          <p>Watch each machine, follow the work as it moves, and step in from wherever you are.</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-panel-inner">
          <div className="login-brand-lockup">
            <img aria-hidden="true" className="login-brand-mark" height="1024" src="/operatus-mark-transparent.png" width="1024" />
            <BrandWordmark />
          </div>
          <div className="login-card pixel-panel">
            <div className="login-card-heading">
              <span className="eyebrow">Agent firm control</span>
              <h2>Welcome back</h2>
            </div>
            <p className="muted">Sign in to see the machines and workspaces tied to your identity.</p>
            <AuthPanel />
            <p className="trust-note">Your browser never receives node credentials or arbitrary shell access. Local machines retain run and Git authority.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

const scopes: Array<{ value: MachineScope; label: string }> = [
  { value: "all", label: "All machines" },
  { value: "online", label: "Online" },
  { value: "favorites", label: "Favorites" },
];

export default async function Home({ searchParams }: PageProps) {
  const { userId, supabase } = await requireUser();
  if (!userId) return <LoginPage />;

  const [{ data: profile }, { data: preferences }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url").eq("user_id", userId).maybeSingle(),
    supabase.from("user_preferences").select("appearance, avatar_theme, machine_scope, density").eq("user_id", userId).maybeSingle(),
    supabase.from("workspace_memberships").select("workspace_id, role").eq("user_id", userId).eq("status", "active"),
  ]);

  if (membershipError) {
    return (
      <main className="center-stage">
        <section className="paper-card narrow-card pixel-panel">
          <span className="eyebrow">Identity connected</span>
          <h1>The firm directory is being prepared.</h1>
          <p>Your session is valid, but the remote control-plane schema is not available yet.</p>
        </section>
      </main>
    );
  }

  const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
  const params = await searchParams;
  const selectedWorkspaceId = workspaceIds.includes(params.workspace ?? "") ? params.workspace! : workspaceIds[0];
  const requestedScope = scopes.some((scope) => scope.value === params.scope) ? params.scope as MachineScope : null;
  const activeScope = requestedScope ?? preferences?.machine_scope ?? "all";

  const [workspaceResult, branchResult, nodeResult, runResult, favoriteResult] = selectedWorkspaceId
    ? await Promise.all([
        supabase.from("workspaces").select("id, name, slug").in("id", workspaceIds).order("created_at"),
        supabase.from("branches").select("id, workspace_id, name, slug, theme").eq("workspace_id", selectedWorkspaceId).order("created_at"),
        supabase.from("nodes").select("id, workspace_id, branch_id, name, hostname, platform, architecture, app_version, status, last_seen_at, revoked_at").eq("workspace_id", selectedWorkspaceId).is("revoked_at", null).order("created_at"),
        supabase.from("run_projections").select("id, node_id, title, phase, terminal_status, artifact_sha, run_version, updated_at").eq("workspace_id", selectedWorkspaceId).order("updated_at", { ascending: false }),
        supabase.from("branch_preferences").select("branch_id, favorite").eq("workspace_id", selectedWorkspaceId).eq("user_id", userId),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const workspaces = workspaceResult.data ?? [];
  const branches = branchResult.data ?? [];
  const nodes = nodeResult.data ?? [];
  const runs = runResult.data ?? [];
  const favorites = new Set((favoriteResult.data ?? []).filter((item) => item.favorite).map((item) => item.branch_id));
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const membership = memberships?.find((item) => item.workspace_id === selectedWorkspaceId);
  const latestRunByNode = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!latestRunByNode.has(run.node_id)) latestRunByNode.set(run.node_id, run);
  const onlineCount = nodes.filter((node) => isRecentlyOnline(node.last_seen_at, node.status)).length;
  const nodeByBranch = new Map(nodes.map((node) => [node.branch_id, node]));
  const visibleBranches = branches.filter((branch) => {
    const node = nodeByBranch.get(branch.id);
    if (activeScope === "favorites") return favorites.has(branch.id);
    if (activeScope === "online") return Boolean(node && isRecentlyOnline(node.last_seen_at, node.status));
    return true;
  });
  const unpairedBranch = branches.find((branch) => !nodeByBranch.has(branch.id));
  const displayName = profile?.display_name ?? "Operator";

  return (
    <div className="portal-shell">
      <AppearanceSync appearance={preferences?.appearance ?? "system"} density={preferences?.density ?? "comfortable"} />
      <DeviceRegistrar />
      <LiveUpdater />
      <PortalHeader
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        displayName={displayName}
        avatarUrl={profile?.avatar_url}
        avatarTheme={preferences?.avatar_theme}
        role={membership?.role}
      />

      <main className="portal-main">
        <section className="hero-row">
          <div>
            <span className="eyebrow">{selectedWorkspace?.name ?? "Personal firm"}</span>
            <h1>Operations floor</h1>
            <p>{onlineCount} of {nodes.length} branches online · {runs.length} visible ventures</p>
          </div>
          {unpairedBranch ? <PairingPanel workspaceId={selectedWorkspaceId} branchId={unpairedBranch.id} /> : null}
        </section>

        <nav className="machine-filter pixel-panel" aria-label="Machine filters">
          <span className="machine-filter-label">Viewing</span>
          {scopes.map((scope) => (
            <Link
              key={scope.value}
              className={activeScope === scope.value ? "active" : ""}
              href={`/?workspace=${selectedWorkspaceId}&scope=${scope.value}`}
            >
              {scope.label}
              {scope.value === "all" ? <small>{branches.length}</small> : null}
              {scope.value === "online" ? <small>{onlineCount}</small> : null}
              {scope.value === "favorites" ? <small>{favorites.size}</small> : null}
            </Link>
          ))}
        </nav>

        {branches.length === 0 ? (
          <section className="paper-card empty-state pixel-panel">
            <span className="eyebrow">Fresh floor</span>
            <h2>No machine branches are visible yet.</h2>
            <p>Your first branch is normally prepared when the account is created.</p>
          </section>
        ) : visibleBranches.length === 0 ? (
          <section className="paper-card empty-state pixel-panel">
            <span className="eyebrow">Quiet floor</span>
            <h2>No machines match this view.</h2>
            <p>Choose another filter or mark a machine as a favorite.</p>
          </section>
        ) : (
          <section className="branch-grid" aria-label="Machine branches">
            {visibleBranches.map((branch) => {
              const node = nodeByBranch.get(branch.id);
              const latestRun = node ? latestRunByNode.get(node.id) : undefined;
              const online = Boolean(node && isRecentlyOnline(node.last_seen_at, node.status));
              const favorite = favorites.has(branch.id);
              return (
                <article className={`branch-card pixel-panel theme-${branch.theme}`} key={branch.id}>
                  <header className="branch-header">
                    <span className="branch-swatch" />
                    <div><span className="eyebrow">{branch.theme} branch</span><h2>{branch.name}</h2></div>
                    <form action={toggleFavorite}>
                      <input type="hidden" name="branchId" value={branch.id} />
                      <input type="hidden" name="workspaceId" value={selectedWorkspaceId} />
                      <input type="hidden" name="favorite" value={String(!favorite)} />
                      <button className={`favorite-button ${favorite ? "active" : ""}`} type="submit" aria-label={favorite ? "Remove from favorites" : "Add to favorites"}>★</button>
                    </form>
                  </header>
                  {!node ? (
                    <div className="branch-empty">
                      <div className="empty-desk" aria-hidden="true"><i /><b /></div>
                      <p>This machine branch is ready to be paired.</p>
                      <PairingPanel workspaceId={selectedWorkspaceId} branchId={branch.id} />
                    </div>
                  ) : (
                    <section className="node-card">
                      <div className="node-heading">
                        <span className={`presence-dot ${online ? "online" : "offline"}`} />
                        <div><h3>{node.name}</h3><p>{node.hostname} · {node.platform}/{node.architecture}</p></div>
                        <span className="last-seen">{relativeTime(node.last_seen_at)}</span>
                      </div>
                      {latestRun ? (
                        <div className="run-strip">
                          <div>
                            <span className="eyebrow">Current venture</span>
                            <strong>{latestRun.title}</strong>
                            <p>{latestRun.phase.replaceAll("_", " ")}{latestRun.artifact_sha ? ` · ${latestRun.artifact_sha.slice(0, 8)}` : ""}</p>
                          </div>
                          <span className={`run-state ${latestRun.terminal_status ? "complete" : "active"}`}>
                            {latestRun.terminal_status ?? "in progress"}
                          </span>
                        </div>
                      ) : <div className="quiet-state">No shared venture is active.</div>}
                      <NodeControls
                        nodeId={node.id}
                        runId={latestRun?.id}
                        runVersion={latestRun?.run_version}
                        canManageAccess={membership?.role === "owner" || membership?.role === "admin"}
                      />
                    </section>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <footer className="portal-footer">
          <span><i className="presence-dot online" /> Identity-bound control plane</span>
          <span>Each branch is one machine · Commands expire in five minutes</span>
        </footer>
      </main>
    </div>
  );
}
