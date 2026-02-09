import jwt from "jsonwebtoken";

export function generateJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    {
      algorithm: "RS256",
      header: {
        alg: "RS256",
        typ: "JWT",
        kid: appId,
      },
    },
  );
}
