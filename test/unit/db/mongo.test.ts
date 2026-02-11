import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockDb = vi.fn().mockReturnValue({ collection: vi.fn() });

vi.mock("mongodb", () => ({
  MongoClient: class {
    connect = mockConnect;
    close = mockClose;
    db = mockDb;
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: { mongoUri: "mongodb://localhost:27017", mongoDbName: "test-db" },
}));

const { connect, disconnect, getDb } = await import("../../../src/db/mongo.js");

describe("mongo", () => {
  beforeEach(async () => {
    await disconnect();
    vi.clearAllMocks();
  });

  describe("connect", () => {
    it("creates client and connects", async () => {
      await connect();
      expect(mockConnect).toHaveBeenCalledOnce();
    });

    it("reuses existing connection on second call", async () => {
      await connect();
      await connect();
      expect(mockConnect).toHaveBeenCalledOnce();
    });
  });

  describe("getDb", () => {
    it("returns database instance after connect", async () => {
      await connect();
      getDb();
      expect(mockDb).toHaveBeenCalledWith("test-db");
    });
  });

  describe("disconnect", () => {
    it("closes client", async () => {
      await connect();
      await disconnect();
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it("allows reconnecting after disconnect", async () => {
      await connect();
      await disconnect();
      await connect();
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });
});
