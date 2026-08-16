export interface RemoteNodeConfig {
  enabled: boolean;
  portalUrl: string;
  nodeId?: string;
  nodeName?: string;
}

export type RemoteNodeState = 'disabled' | 'unpaired' | 'connecting' | 'online' | 'degraded';

/** Renderer-safe status. The bearer token never crosses IPC. */
export interface RemoteNodeStatus {
  state: RemoteNodeState;
  enabled: boolean;
  paired: boolean;
  portalUrl: string;
  nodeId: string | null;
  nodeName: string;
  lastSyncAt: number | null;
  error: string | null;
}

export interface RemoteNodeConfigureInput {
  enabled?: boolean;
  portalUrl?: string;
  nodeName?: string;
}

export interface RemoteNodePairInput {
  code: string;
  nodeName?: string;
}
