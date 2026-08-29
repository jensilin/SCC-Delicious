require("../setup");

const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const { createApp } = require("../../src/app");
const { env } = require("../../src/config/env");
const { prisma } = require("../../src/config/prisma");

// src/app.js pulls in the Prisma client at require time, so release its pool even though these
// tests never query, otherwise the process can stay alive after the last assertion.
after(async () => {
  await prisma.$disconnect();
});

test("createApp returns an Express application", () => {
  const app = createApp();

  assert.equal(typeof app, "function");
  assert.equal(typeof app.listen, "function");
  assert.equal(typeof app.use, "function");
});

test("createApp does not start a server, so a caller chooses the port", () => {
  const app = createApp();

  // An Express application only becomes a server once listen() is called. Nothing in the module
  // has bound a port, which is what lets these tests and server.js share one definition.
  assert.equal(app.listening, undefined);
});

test("createApp builds an independent application on each call", () => {
  assert.notEqual(createApp(), createApp());
});

test("configuration validation accepted the test environment", () => {
  assert.equal(env.NODE_ENV, "test");
  assert.equal(typeof env.PORT, "number");
  assert.ok(env.CORS_ORIGIN.length > 0);
});

test("the application is pointed at the local test database, not Supabase", () => {
  // A harness fault here would let a later destructive test reach real data, so it is asserted
  // rather than assumed.
  assert.equal(new URL(env.DATABASE_URL).hostname, "127.0.0.1");
});
