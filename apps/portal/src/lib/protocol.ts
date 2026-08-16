import { z } from "zod";
import type { Json } from "@/lib/database.types";

const jsonObject: z.ZodType<Record<string, Json>> = z.record(z.string(), z.json());

export const invitationRequestSchema = z.object({
  workspaceId: z.uuid(),
  branchId: z.uuid(),
});

export const enrollmentSchema = z.object({
  code: z.string().min(8).max(14),
  name: z.string().trim().min(1).max(120),
  hostname: z.string().trim().min(1).max(255),
  platform: z.enum(["darwin", "win32", "linux"]),
  architecture: z.string().trim().min(1).max(32),
  appVersion: z.string().trim().min(1).max(40),
  capabilities: jsonObject.optional().default({}),
  publicKey: z.string().max(4096).nullable().optional(),
});

export const repositorySchema = z.object({
  localRepositoryId: z.string().min(8).max(128),
  displayName: z.string().min(1).max(160),
  remoteHost: z.string().max(120).nullable().optional(),
  remoteOwner: z.string().max(160).nullable().optional(),
  remoteName: z.string().max(160).nullable().optional(),
});

export const runProjectionSchema = z.object({
  localRunId: z.string().min(1).max(128),
  localRepositoryId: z.string().min(8).max(128).nullable().optional(),
  title: z.string().min(1).max(240),
  phase: z.string().min(1).max(64),
  terminalStatus: z.string().max(64).nullable().optional(),
  artifactSha: z.string().regex(/^[0-9a-f]{40}$/).nullable().optional(),
  runVersion: z.number().int().nonnegative(),
  snapshot: jsonObject,
  startedAt: z.iso.datetime().nullable().optional(),
  completedAt: z.iso.datetime().nullable().optional(),
});

export const nodeSyncSchema = z.object({
  status: z.enum(["online", "offline", "degraded"]),
  appVersion: z.string().trim().min(1).max(40).optional(),
  capabilities: jsonObject.optional(),
  repositories: z.array(repositorySchema).max(250).default([]),
  runs: z.array(runProjectionSchema).max(250).default([]),
});

export const commandOperationSchema = z.enum([
  "message_conductor",
  "pause_run",
  "cancel_run",
  "answer_human_required",
  "approve_human_gate",
]);

export const commandRequestSchema = z.object({
  operation: commandOperationSchema,
  runProjectionId: z.uuid().nullable().optional(),
  payload: jsonObject.default({}),
  idempotencyKey: z.uuid(),
  expectedRunVersion: z.number().int().nonnegative().nullable().optional(),
});

export const commandAcknowledgmentSchema = z.object({
  commandId: z.uuid(),
  status: z.enum(["accepted", "rejected", "failed"]),
  acknowledgment: jsonObject.default({}),
});
