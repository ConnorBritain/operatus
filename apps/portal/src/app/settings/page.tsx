import Link from "next/link";
import { AppearanceSync } from "@/app/_components/appearance-sync";
import { PortalHeader, ProfileAvatar } from "@/app/_components/portal-chrome";
import { GitHubIcon, GoogleIcon } from "@/app/_components/provider-icons";
import { saveBranch, savePreferences, saveProfile, saveWorkspace } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import type { BranchTheme } from "@/lib/database.types";

type SettingsPageProps = { searchParams: Promise<{ notice?: string }> };

const themes: BranchTheme[] = ["cedar", "harbor", "saffron", "juniper", "clay", "iris", "moss", "ember", "coast", "orchid", "slate", "sol"];

const noticeCopy: Record<string, string> = {
  "profile-saved": "Profile updated.",
  "preferences-saved": "Appearance and defaults updated.",
  "workspace-saved": "Workspace name updated.",
  "machine-saved": "Machine branch updated.",
  "profile-invalid": "Enter a display name between 1 and 120 characters.",
  "preferences-invalid": "One or more preferences were not recognized.",
  "workspace-invalid": "Enter a valid workspace name.",
  "branch-invalid": "Enter a valid machine name and theme.",
  "save-failed": "That change could not be saved. Check your access and try again.",
};

function isOnline(lastSeenAt: string | null, status: string) {
  return status === "online" && Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 90_000);
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const { userId, supabase } = await requireUser();
  if (!userId) return <main className="center-stage"><Link className="button primary" href="/">Sign in</Link></main>;

  const [{ data: userData }, { data: profile }, { data: preferences }, { data: memberships }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("display_name, avatar_url").eq("user_id", userId).maybeSingle(),
    supabase.from("user_preferences").select("appearance, avatar_theme, machine_scope, density").eq("user_id", userId).maybeSingle(),
    supabase.from("workspace_memberships").select("workspace_id, role").eq("user_id", userId).eq("status", "active"),
  ]);

  const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
  const [{ data: workspaces }, { data: branches }, { data: nodes }] = await Promise.all([
    workspaceIds.length ? supabase.from("workspaces").select("id, name, slug").in("id", workspaceIds).order("created_at") : Promise.resolve({ data: [] }),
    workspaceIds.length ? supabase.from("branches").select("id, workspace_id, name, slug, theme").in("workspace_id", workspaceIds).order("created_at") : Promise.resolve({ data: [] }),
    workspaceIds.length ? supabase.from("nodes").select("id, branch_id, hostname, platform, architecture, status, last_seen_at, revoked_at").in("workspace_id", workspaceIds).is("revoked_at", null) : Promise.resolve({ data: [] }),
  ]);

  const displayName = profile?.display_name ?? "Operator";
  const avatarTheme = preferences?.avatar_theme ?? "cedar";
  const notice = noticeCopy[(await searchParams).notice ?? ""];
  const identities = userData?.user?.identities ?? [];
  const nodeByBranch = new Map((nodes ?? []).map((node) => [node.branch_id, node]));
  const primaryWorkspace = workspaces?.[0];
  const primaryRole = memberships?.find((item) => item.workspace_id === primaryWorkspace?.id)?.role;

  return (
    <div className="portal-shell settings-shell">
      <AppearanceSync appearance={preferences?.appearance ?? "system"} density={preferences?.density ?? "comfortable"} />
      <PortalHeader
        workspaces={workspaces ?? []}
        selectedWorkspaceId={primaryWorkspace?.id}
        displayName={displayName}
        avatarUrl={profile?.avatar_url}
        avatarTheme={avatarTheme}
        role={primaryRole}
      />

      <main className="settings-layout">
        <aside className="settings-nav pixel-panel">
          <div className="settings-person">
            <ProfileAvatar name={displayName} avatarUrl={profile?.avatar_url} theme={avatarTheme} />
            <div><strong>{displayName}</strong><small>{userData?.user?.email ?? "Signed in"}</small></div>
          </div>
          <nav aria-label="Settings sections">
            <a href="#profile">Profile</a>
            <a href="#appearance">Appearance</a>
            <a href="#machines">Machines</a>
            <a href="#identity">Sign-in</a>
            <a href="#runtime">Local runtime</a>
            <a href="#notifications">Notifications</a>
          </nav>
          <Link className="back-link" href="/">← Back to floor</Link>
        </aside>

        <div className="settings-content">
          <header className="settings-title">
            <span className="eyebrow">Personal controls</span>
            <h1>Settings</h1>
            <p>Presentation follows you across clients. Execution settings stay with the branch that owns them.</p>
          </header>
          {notice ? <p className="settings-notice" role="status">{notice}</p> : null}

          <section className="settings-section" id="profile">
            <div className="section-heading"><span className="pixel-glyph">01</span><div><h2>Profile</h2><p>How you appear across your workspaces and clients.</p></div></div>
            <div className="settings-card pixel-panel">
              <form action={saveProfile} className="settings-form">
                <label htmlFor="displayName">Display name</label>
                <input id="displayName" name="displayName" defaultValue={displayName} maxLength={120} required />
                <div className="form-actions"><button className="button primary" type="submit">Save profile</button></div>
              </form>
              <div className="profile-preview">
                <ProfileAvatar name={displayName} avatarUrl={profile?.avatar_url} theme={avatarTheme} size="large" />
                <div><span className="eyebrow">Current presentation</span><strong>{displayName}</strong><p>{profile?.avatar_url ? "Using the picture supplied by your sign-in provider." : "Using your initial and selected color."}</p></div>
              </div>
            </div>
          </section>

          <section className="settings-section" id="appearance">
            <div className="section-heading"><span className="pixel-glyph">02</span><div><h2>Appearance</h2><p>A warmer operations floor with a crisp 16-bit frame.</p></div></div>
            <form action={savePreferences} className="settings-card pixel-panel settings-form">
              <fieldset>
                <legend>Color scheme</legend>
                <div className="choice-grid three">
                  {["system", "light", "dark"].map((value) => <label className="choice-card" key={value}><input type="radio" name="appearance" value={value} defaultChecked={(preferences?.appearance ?? "system") === value} /><span>{value}</span></label>)}
                </div>
              </fieldset>
              <fieldset>
                <legend>Profile color</legend>
                <div className="palette-grid">
                  {themes.map((theme) => <label className={`palette-choice theme-${theme}`} key={theme}><input type="radio" name="avatarTheme" value={theme} defaultChecked={avatarTheme === theme} /><i /><span>{theme}</span></label>)}
                </div>
              </fieldset>
              <div className="form-grid">
                <label>Default machine view<select name="machineScope" defaultValue={preferences?.machine_scope ?? "all"}><option value="all">All machines</option><option value="online">Online</option><option value="favorites">Favorites</option></select></label>
                <label>Information density<select name="density" defaultValue={preferences?.density ?? "comfortable"}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
              </div>
              <div className="form-actions"><button className="button primary" type="submit">Save appearance</button></div>
            </form>
          </section>

          <section className="settings-section" id="machines">
            <div className="section-heading"><span className="pixel-glyph">03</span><div><h2>Machines</h2><p>Each branch is one durable machine identity, even while it is offline or being re-paired.</p></div></div>
            <div className="settings-stack">
              {(workspaces ?? []).map((workspace) => {
                const role = memberships?.find((item) => item.workspace_id === workspace.id)?.role;
                const canEdit = role === "owner" || role === "admin";
                return (
                  <div className="settings-card pixel-panel" key={workspace.id}>
                    <form action={saveWorkspace} className="workspace-name-form">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <label>Workspace name<input name="name" defaultValue={workspace.name} maxLength={120} disabled={!canEdit} /></label>
                      {canEdit ? <button className="button secondary" type="submit">Rename</button> : null}
                    </form>
                    <div className="machine-settings-list">
                      {(branches ?? []).filter((branch) => branch.workspace_id === workspace.id).map((branch) => {
                        const node = nodeByBranch.get(branch.id);
                        const online = Boolean(node && isOnline(node.last_seen_at, node.status));
                        return (
                          <form action={saveBranch} className={`machine-setting theme-${branch.theme}`} key={branch.id}>
                            <input type="hidden" name="branchId" value={branch.id} />
                            <span className={`presence-dot ${online ? "online" : "offline"}`} />
                            <label>Branch name<input name="name" defaultValue={branch.name} maxLength={80} disabled={!canEdit} /></label>
                            <label>Visual theme<select name="theme" defaultValue={branch.theme} disabled={!canEdit}>{themes.map((theme) => <option key={theme} value={theme}>{theme}</option>)}</select></label>
                            <div className="machine-meta"><strong>{node ? node.hostname : "Not paired"}</strong><small>{node ? `${node.platform}/${node.architecture}` : "Ready for one machine"}</small></div>
                            {canEdit ? <button className="button secondary" type="submit">Save</button> : null}
                          </form>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-section" id="identity">
            <div className="section-heading"><span className="pixel-glyph">04</span><div><h2>Sign-in</h2><p>Account identity is separate from machine credentials and provider subscriptions.</p></div></div>
            <div className="settings-card pixel-panel identity-list">
              {identities.map((identity) => <div className="identity-row" key={identity.id}><span className="provider-mark">{identity.provider === "github" ? <GitHubIcon /> : identity.provider === "google" ? <GoogleIcon /> : "@"}</span><div><strong>{identity.provider === "email" ? "Email link" : identity.provider}</strong><small>{String(identity.identity_data?.email ?? userData?.user?.email ?? "Connected")}</small></div><span className="status-chip connected">Connected</span></div>)}
            </div>
          </section>

          <section className="settings-section" id="runtime">
            <div className="section-heading"><span className="pixel-glyph">05</span><div><h2>Local runtime</h2><p>Provider, Git, worktree, and model defaults belong to each branch.</p></div></div>
            <div className="settings-card pixel-panel truthful-grid">
              <article><span className="status-chip local">Local</span><h3>Claude Code & Codex</h3><p>Authentication, account details, models, and usage remain on the machine. They are never inferred from your web identity.</p></article>
              <article><span className="status-chip local">Local</span><h3>Git & worktrees</h3><p>Repository access and worktree defaults stay under the branch daemon’s control. The portal receives only explicitly shared projections.</p></article>
              <article><span className="status-chip planned">Planned</span><h3>Corporate library</h3><p>A future company layer can distribute pinned skills, policies, and sealed ventures. Every branch will revalidate them locally.</p></article>
            </div>
          </section>

          <section className="settings-section" id="notifications">
            <div className="section-heading"><span className="pixel-glyph">06</span><div><h2>Notifications</h2><p>Clear boundaries now; useful alerts when delivery is implemented.</p></div></div>
            <div className="settings-card pixel-panel roadmap-row"><span className="status-chip planned">Roadmap</span><div><h3>Mobile and browser alerts</h3><p>Push delivery is not enabled yet. No decorative toggle will claim otherwise. The first alerts will cover human-required gates, completed ventures, and disconnected branches.</p></div></div>
          </section>
        </div>
      </main>
    </div>
  );
}
