import { describe, expect, it } from "vitest";
import {
  commandRequestSchema,
  enrollmentSchema,
  nodeSyncSchema,
  runProjectionSchema,
} from "@/lib/protocol";
import { newPairingCode, normalizePairingCode } from "@/lib/node-auth";
import { describeClientDevice } from "@/lib/client-device";

describe("remote control protocol", () => {
  it("normalizes human pairing codes without accepting hidden characters", () => {
    expect(normalizePairingCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(newPairingCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("accepts bounded enrollment metadata", () => {
    expect(enrollmentSchema.safeParse({
      code: "ABCD-2345-EFGH",
      name: "Mac studio",
      hostname: "studio.local",
      platform: "darwin",
      architecture: "arm64",
      appVersion: "0.1.0",
    }).success).toBe(true);
  });

  it("rejects arbitrary command operations", () => {
    const result = commandRequestSchema.safeParse({
      operation: "run_shell",
      payload: { command: "rm -rf /" },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result.success).toBe(false);
  });

  it("requires exact full commit identities", () => {
    const base = {
      localRunId: "run-1",
      title: "Verify a change",
      phase: "awaiting_critic",
      runVersion: 2,
      snapshot: {},
    };
    expect(runProjectionSchema.safeParse({ ...base, artifactSha: "a".repeat(40) }).success).toBe(true);
    expect(runProjectionSchema.safeParse({ ...base, artifactSha: "a".repeat(8) }).success).toBe(false);
  });

  it("bounds each heartbeat batch", () => {
    const runs = Array.from({ length: 251 }, (_, index) => ({
      localRunId: `run-${index}`,
      title: "Run",
      phase: "orienting",
      runVersion: 0,
      snapshot: {},
    }));
    expect(nodeSyncSchema.safeParse({ status: "online", repositories: [], runs }).success).toBe(false);
  });

  it("assigns stable, low-detail labels to authenticated browser devices", () => {
    expect(describeClientDevice(new Headers({ "user-agent": "Mozilla/5.0 (Linux; Android 16)" }))).toEqual({
      label: "Android phone or tablet",
      platform: "android",
    });
    expect(describeClientDevice(new Headers({ "sec-ch-ua-platform": '"macOS"' }))).toEqual({
      label: "Mac browser",
      platform: "macos",
    });
    expect(describeClientDevice(new Headers())).toEqual({
      label: "Web browser",
      platform: "browser",
    });
  });
});
