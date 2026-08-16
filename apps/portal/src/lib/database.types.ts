export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationship[];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<{
        user_id: string;
        display_name: string;
        avatar_url: string | null;
        created_at: string;
        updated_at: string;
      }>;
      workspaces: Table<{
        id: string;
        name: string;
        slug: string;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>;
      workspace_memberships: Table<{
        workspace_id: string;
        user_id: string;
        role: "owner" | "admin" | "operator" | "viewer";
        status: "invited" | "active" | "suspended";
        created_at: string;
        updated_at: string;
      }>;
      branches: Table<{
        id: string;
        workspace_id: string;
        name: string;
        slug: string;
        theme: BranchTheme;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>;
      client_devices: Table<{
        id: string;
        user_id: string;
        label: string;
        platform: string;
        public_key: string | null;
        last_seen_at: string | null;
        revoked_at: string | null;
        created_at: string;
      }>;
      nodes: Table<NodeRow, NodeInsert>;
      pairing_invitations: Table<PairingInvitationRow, PairingInvitationInsert>;
      repositories: Table<RepositoryRow, RepositoryInsert>;
      run_projections: Table<RunProjectionRow, RunProjectionInsert>;
      commands: Table<CommandRow, CommandInsert>;
      audit_events: Table<AuditEventRow, AuditEventInsert>;
    };
    Views: Record<string, never>;
    Functions: {
      enroll_atelier_node: {
        Args: {
          invitation_code_hash: string;
          node_token_hash: string;
          node_name: string;
          node_hostname: string;
          node_platform: string;
          node_architecture: string;
          node_app_version: string;
          node_capabilities?: Json;
          node_public_key?: string | null;
        };
        Returns: string;
      };
      claim_atelier_commands: {
        Args: { node_token_hash: string; command_limit?: number };
        Returns: Array<{
          id: string;
          operation: CommandOperation;
          payload: Json;
          idempotency_key: string;
          expected_run_version: number | null;
          expires_at: string;
          run_projection_id: string | null;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type BranchTheme =
  | "cedar" | "harbor" | "saffron" | "juniper" | "clay" | "iris"
  | "moss" | "ember" | "coast" | "orchid" | "slate" | "sol";

export type NodeRow = {
  id: string;
  workspace_id: string;
  branch_id: string;
  name: string;
  hostname: string;
  platform: "darwin" | "win32" | "linux";
  architecture: string;
  app_version: string;
  capabilities: Json;
  public_key: string | null;
  token_hash: string;
  paired_by: string | null;
  status: "online" | "offline" | "degraded" | "revoked";
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NodeInsert = Omit<NodeRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type PairingInvitationRow = {
  id: string;
  workspace_id: string;
  branch_id: string;
  created_by: string;
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
  node_id: string | null;
  created_at: string;
};

export type PairingInvitationInsert = Omit<PairingInvitationRow, "id" | "created_at" | "consumed_at" | "node_id"> & {
  id?: string;
  created_at?: string;
  consumed_at?: string | null;
  node_id?: string | null;
};

export type RepositoryRow = {
  id: string;
  workspace_id: string;
  node_id: string;
  local_repository_id: string;
  display_name: string;
  remote_host: string | null;
  remote_owner: string | null;
  remote_name: string | null;
  last_seen_at: string;
  created_at: string;
};

export type RepositoryInsert = Omit<RepositoryRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type RunProjectionRow = {
  id: string;
  workspace_id: string;
  node_id: string;
  repository_id: string | null;
  local_run_id: string;
  title: string;
  phase: string;
  terminal_status: string | null;
  artifact_sha: string | null;
  run_version: number;
  snapshot: Json;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type RunProjectionInsert = Omit<RunProjectionRow, "id"> & { id?: string };

export type CommandOperation =
  | "message_conductor"
  | "pause_run"
  | "cancel_run"
  | "answer_human_required"
  | "approve_human_gate";

export type CommandRow = {
  id: string;
  workspace_id: string;
  node_id: string;
  run_projection_id: string | null;
  issued_by: string;
  issued_from_device_id: string | null;
  operation: CommandOperation;
  payload: Json;
  idempotency_key: string;
  expected_run_version: number | null;
  status: "queued" | "delivered" | "accepted" | "rejected" | "expired" | "failed";
  expires_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  acknowledgment: Json | null;
  created_at: string;
  updated_at: string;
};

export type CommandInsert = Omit<CommandRow, "id" | "status" | "delivered_at" | "acknowledged_at" | "acknowledgment" | "created_at" | "updated_at"> & {
  id?: string;
  status?: CommandRow["status"];
  delivered_at?: string | null;
  acknowledged_at?: string | null;
  acknowledgment?: Json | null;
  created_at?: string;
  updated_at?: string;
};

export type AuditEventRow = {
  id: number;
  workspace_id: string;
  actor_kind: "user" | "device" | "node" | "system";
  actor_user_id: string | null;
  actor_device_id: string | null;
  actor_node_id: string | null;
  action: string;
  resource_kind: string;
  resource_id: string | null;
  metadata: Json;
  created_at: string;
};

export type AuditEventInsert = Omit<AuditEventRow, "id" | "created_at"> & {
  id?: number;
  created_at?: string;
};
