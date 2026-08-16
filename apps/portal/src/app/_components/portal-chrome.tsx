import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/actions";

type WorkspaceLink = { id: string; name: string };

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-lockup${compact ? " compact" : ""}`} href="/">
      <Image className="canonical-mark" src="/ventura-icon.png" alt="" width={compact ? 42 : 54} height={compact ? 42 : 54} priority />
      <span>Ventura</span>
    </Link>
  );
}

export function ProfileAvatar({ name, avatarUrl, theme = "cedar", size = "normal" }: {
  name: string;
  avatarUrl?: string | null;
  theme?: string;
  size?: "small" | "normal" | "large";
}) {
  return (
    <span className={`profile-avatar theme-${theme} ${size}`}>
      {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

export function PortalHeader({
  workspaces,
  selectedWorkspaceId,
  displayName,
  avatarUrl,
  avatarTheme,
  role,
}: {
  workspaces: WorkspaceLink[];
  selectedWorkspaceId?: string;
  displayName: string;
  avatarUrl?: string | null;
  avatarTheme?: string;
  role?: string;
}) {
  return (
    <header className="topbar">
      <BrandMark compact />
      <nav className="workspace-switcher" aria-label="Workspaces">
        {workspaces.map((workspace) => (
          <Link key={workspace.id} className={workspace.id === selectedWorkspaceId ? "active" : ""} href={`/?workspace=${workspace.id}`}>
            {workspace.name}
          </Link>
        ))}
      </nav>
      <div className="account-chip">
        <ProfileAvatar name={displayName} avatarUrl={avatarUrl} theme={avatarTheme} size="small" />
        <span>{displayName}<small>{role ?? "member"}</small></span>
        <Link className="text-button" href="/settings">Settings</Link>
        <form action={signOut}><button className="text-button" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
