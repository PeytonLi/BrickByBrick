import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { RunModel } from "../src/models/run";

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { dbName: "test" });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("RunModel", () => {
  it("creates a run and reads it back", async () => {
    const run = await RunModel.create({
      runId: "run-001",
      config: { tau: 0.6, max_pairs: 5 },
      status: "running",
      startedAt: new Date(),
      pairsCommitted: 0,
      totalIterations: 0,
    });

    expect(run.runId).toBe("run-001");
    expect(run.status).toBe("running");
    expect(run.config).toEqual({ tau: 0.6, max_pairs: 5 });
  });

  it("updates status to complete", async () => {
    const run = await RunModel.create({
      runId: "run-002",
      config: { tau: 0.5 },
      status: "running",
      startedAt: new Date(),
      pairsCommitted: 0,
      totalIterations: 0,
    });

    run.status = "complete";
    run.completedAt = new Date();
    await run.save();

    const found = await RunModel.byId("run-002");
    expect(found?.status).toBe("complete");
    expect(found?.completedAt).toBeInstanceOf(Date);
  });

  it("RunModel.latest() returns correctly sorted runs", async () => {
    await RunModel.deleteMany({});

    await RunModel.create({
      runId: "old-run",
      config: {},
      status: "complete",
      startedAt: new Date("2024-01-01"),
      pairsCommitted: 3,
      totalIterations: 5,
    });

    await RunModel.create({
      runId: "new-run",
      config: {},
      status: "running",
      startedAt: new Date("2025-01-01"),
      pairsCommitted: 1,
      totalIterations: 2,
    });

    const latest = await RunModel.latest(2);
    expect(latest).toHaveLength(2);
    expect(latest[0].runId).toBe("new-run");
    expect(latest[1].runId).toBe("old-run");
  });

  it("RunModel.byId() finds a run", async () => {
    await RunModel.create({
      runId: "by-id-test",
      config: {},
      status: "failed",
      startedAt: new Date(),
      pairsCommitted: 0,
      totalIterations: 1,
    });

    const found = await RunModel.byId("by-id-test");
    expect(found?.runId).toBe("by-id-test");
    expect(found?.status).toBe("failed");
  });

  it("defaults status to running", async () => {
    const run = await RunModel.create({
      runId: "default-status",
      config: {},
      startedAt: new Date(),
    });

    expect(run.status).toBe("running");
    expect(run.pairsCommitted).toBe(0);
    expect(run.totalIterations).toBe(0);
  });

  it("has a serve path and setServe static", () => {
    expect(RunModel.schema.path("serve")).toBeDefined();
    expect(typeof RunModel.setServe).toBe("function");
  });

  it("persists serve info via setServe and reads it back", async () => {
    await RunModel.create({
      runId: "serve-test",
      config: {},
      status: "running",
      startedAt: new Date(),
    });

    await RunModel.setServe("serve-test", {
      podId: "pod-abc",
      serveUrl: "https://serve.example.com/pod-abc",
      baseModel: "qwen-coder-7b",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const found = await RunModel.byId("serve-test");
    expect(found?.serve).toBeDefined();
    expect(found?.serve?.podId).toBe("pod-abc");
    expect(found?.serve?.baseModel).toBe("qwen-coder-7b");
  });
});
