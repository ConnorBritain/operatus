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
