import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { generateJwt } from "../../../src/api/jwt.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const pemPrivate = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const pemPublic = publicKey.export({ type: "spki", format: "pem" }) as string;

describe("generateJwt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a token with 3 segments", () => {
    const token = generateJwt("my-app", pemPrivate);
    expect(token.split(".")).toHaveLength(3);
  });

  it("has correct header with alg RS256 and kid matching appId", () => {
    const token = generateJwt("my-app", pemPrivate);
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());

    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe("my-app");
    expect(header.typ).toBe("JWT");
  });

  it("has correct payload claims with frozen time", () => {
    const token = generateJwt("my-app", pemPrivate);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const expectedIat = Math.floor(new Date("2025-06-15T12:00:00Z").getTime() / 1000);

    expect(payload.iss).toBe("enablebanking.com");
    expect(payload.aud).toBe("api.enablebanking.com");
    expect(payload.iat).toBe(expectedIat);
    expect(payload.exp).toBe(expectedIat + 3600);
  });

  it("signature verifies with the public key", () => {
    const token = generateJwt("my-app", pemPrivate);
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const data = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(signatureB64, "base64url");

    const isValid = verify("sha256", Buffer.from(data), pemPublic, signature);
    expect(isValid).toBe(true);
  });
});
