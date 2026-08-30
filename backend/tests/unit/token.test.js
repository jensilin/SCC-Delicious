require("../setup");

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { SignJWT, decodeJwt } = require("jose");

const { env } = require("../../src/config/env");
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require("../../src/lib/token");

const userId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("an access token carries exactly sub, role, iat and exp", async () => {
  const payload = await verifyAccessToken(await signAccessToken({ userId, role: "STUDENT" }));

  assert.equal(payload.sub, userId);
  assert.equal(payload.role, "STUDENT");
  assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "role", "sub"]);
});

test("an access token is signed with HS256", async () => {
  const token = await signAccessToken({ userId, role: "ADMIN" });
  const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());

  assert.equal(header.alg, "HS256");
});

test("a refresh token carries identity but not role", async () => {
  const payload = await verifyRefreshToken(await signRefreshToken({ userId }));

  assert.equal(payload.sub, userId);
  assert.equal(payload.role, undefined);
});

test("a refresh token is not accepted as an access token", async () => {
  // The separate secrets exist for this: presenting the long-lived credential where the short-lived
  // one belongs must fail at the signature, not at a claim check that could be forgotten.
  const refreshToken = await signRefreshToken({ userId });

  await assert.rejects(verifyAccessToken(refreshToken));
});

test("an access token is not accepted as a refresh token", async () => {
  const accessToken = await signAccessToken({ userId, role: "STUDENT" });

  await assert.rejects(verifyRefreshToken(accessToken));
});

test("a tampered payload is rejected", async () => {
  const [header, payload, signature] = (await signAccessToken({ userId, role: "STUDENT" })).split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());

  claims.role = "ADMIN";

  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");

  await assert.rejects(verifyAccessToken(`${header}.${forged}.${signature}`));
});

test("an expired access token is rejected", async () => {
  const expired = await new SignJWT({ role: "STUDENT" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("-1s")
    .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));

  await assert.rejects(verifyAccessToken(expired), /exp/i);
});

test("an unsigned token is rejected", async () => {
  // alg: "none" is the classic JWT bypass. Pinning the algorithm at verification is what stops it.
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: "ADMIN" })).toString("base64url");

  await assert.rejects(verifyAccessToken(`${header}.${payload}.`));
});

test("the access token expires at the configured lifetime", async () => {
  const seconds = { s: 1, m: 60, h: 3600, d: 86400 };
  const expected =
    Number(env.ACCESS_TOKEN_TTL.slice(0, -1)) * seconds[env.ACCESS_TOKEN_TTL.slice(-1)];

  const { iat, exp } = decodeJwt(await signAccessToken({ userId, role: "STUDENT" }));

  assert.equal(exp - iat, expected);
});
