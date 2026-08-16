const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");

function readMigration(suffix) {
  const file = fs.readdirSync(migrationsDir).find((entry) => entry.endsWith(suffix));
  assert.ok(file, `missing migration ${suffix}`);
  return fs.readFileSync(path.join(migrationsDir, file), "utf8").toLowerCase();
}

test("hosted control-plane tables are protected before they are exposed", () => {
  const schema = readMigration("_identity_control_plane.sql");
  const tables = [
    "profiles",
    "workspaces",
    "workspace_memberships",
    "branches",
    "client_devices",
    "nodes",
    "pairing_invitations",
    "repositories",
    "run_projections",
    "commands",
    "audit_events",
  ];

  for (const table of tables) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(schema, /revoke all on all tables in schema public from anon/);
  assert.match(schema, /revoke all on function public\.enroll_atelier_node[\s\S]+from public, anon, authenticated/);
  assert.match(schema, /revoke all on function public\.claim_atelier_commands[\s\S]+from public, anon, authenticated/);
});

test("future Supabase objects remain opt-in for every API role", () => {
  const hardening = [
    readMigration("_lock_down_future_api_objects.sql"),
    readMigration("_revoke_remaining_future_object_privileges.sql"),
  ].join("\n");

  for (const schema of ["public", "private"]) {
    assert.match(
      hardening,
      new RegExp(`alter default privileges for role postgres in schema ${schema}[\\s\\S]+revoke all on tables from (?:public, )?anon, authenticated, service_role`),
    );
    assert.match(
      hardening,
      new RegExp(`alter default privileges for role postgres in schema ${schema}[\\s\\S]+revoke all on sequences from (?:public, )?anon, authenticated, service_role`),
    );
    assert.match(
      hardening,
      new RegExp(`alter default privileges for role postgres in schema ${schema}[\\s\\S]+revoke execute on functions from public, anon, authenticated, service_role`),
    );
  }
});

test("node revocation is atomic and callable only by the service role", () => {
  const revocation = readMigration("_revoke_remote_access.sql");

  assert.match(revocation, /create or replace function public\.revoke_atelier_node/);
  assert.match(revocation, /security definer[\s\S]+set search_path = ''/);
  assert.match(revocation, /membership\.role[\s\S]+membership\.status = 'active'/);
  assert.match(revocation, /device\.user_id = actor_user_id[\s\S]+device\.revoked_at is null/);
  assert.match(revocation, /update public\.nodes[\s\S]+status = 'revoked'/);
  assert.match(revocation, /update public\.commands[\s\S]+status = 'expired'/);
  assert.match(revocation, /'node\.revoked'/);
  assert.match(revocation, /revoke all on function public\.revoke_atelier_node[\s\S]+from public, anon, authenticated/);
  assert.match(revocation, /grant execute on function public\.revoke_atelier_node[\s\S]+to service_role/);
});

test("the callable control-plane API is renamed without rewriting applied history", () => {
  const rename = readMigration("_rename_operatus_rpcs.sql");

  for (const operation of ["enroll", "claim", "revoke"]) {
    assert.match(rename, new RegExp(`rename to ${operation}_operatus_(?:node|commands)`));
  }
  assert.match(rename, /revoke all on function public\.enroll_operatus_node[\s\S]+from public, anon, authenticated/);
  assert.match(rename, /grant execute on function public\.claim_operatus_commands[\s\S]+to service_role/);
  assert.match(rename, /grant execute on function public\.revoke_operatus_node[\s\S]+to service_role/);
});

test("personal preferences are self-scoped and a branch has one active machine", () => {
  const preferences = readMigration("_profile_branch_preferences.sql");

  for (const table of ["user_preferences", "branch_preferences"]) {
    assert.match(preferences, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(preferences, /user_preferences_select_self[\s\S]+auth\.uid\(\)[\s\S]+user_id/);
  assert.match(preferences, /branch_preferences_select_self[\s\S]+is_workspace_member/);
  assert.match(preferences, /create unique index nodes_one_active_per_branch_idx[\s\S]+on public\.nodes\(branch_id\)[\s\S]+where revoked_at is null/);
  assert.match(preferences, /grant select, insert, update on public\.user_preferences to authenticated/);
  assert.match(preferences, /grant select, insert, update, delete on public\.branch_preferences to authenticated/);
  assert.match(preferences, /left\(account_name \|\| '''s firm'/);
  assert.doesNotMatch(preferences, /raw_user_meta_data[\s\S]+authorization/);
});
