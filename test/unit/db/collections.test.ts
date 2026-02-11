import { describe, it, expect, vi } from "vitest";

const mockCreateIndex = vi.fn();
const mockUpdateMany = vi.fn();
const mockCollection = vi.fn().mockReturnValue({
  createIndex: mockCreateIndex,
  updateMany: mockUpdateMany,
});

vi.mock("../../../src/db/mongo.js", () => ({
  getDb: () => ({ collection: mockCollection }),
}));

const { transactions, sessions, ensureIndexes } = await import("../../../src/db/collections.js");

describe("collections", () => {
  it("transactions returns the transactions collection", () => {
    transactions();
    expect(mockCollection).toHaveBeenCalledWith("transactions");
  });

  it("sessions returns the sessions collection", () => {
    sessions();
    expect(mockCollection).toHaveBeenCalledWith("sessions");
  });
});

describe("ensureIndexes", () => {
  it("creates date and source indexes and migrates string dates", async () => {
    await ensureIndexes();

    expect(mockCreateIndex).toHaveBeenCalledWith({ date: -1 });
    expect(mockCreateIndex).toHaveBeenCalledWith({ source: 1 });
    expect(mockUpdateMany).toHaveBeenCalledOnce();
    expect(mockUpdateMany.mock.calls[0][0]).toEqual({ date: { $type: "string" } });
  });
});
