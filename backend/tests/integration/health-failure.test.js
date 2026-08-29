require("../setup");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { after, before, test } = require("node:test");

const FIXTURE = path.join(__dirname, "fixtures", "unreachable-database-server.js");

// Loading the application from the Windows filesystem can take the better part of a minute on a
// cold cache, so the fixture is given room rather than a tight timeout that would fail spuriously.
const STARTUP_TIMEOUT_MS = 120_000;

let child;
let baseUrl;

before(async () => {
  child = spawn(process.execPath, [FIXTURE], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  baseUrl = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => {
      reject(new Error(`fixture never reported a port within ${STARTUP_TIMEOUT_MS}ms. stderr: ${stderr}`));
    }, STARTUP_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/PORT=(\d+)/);

      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture exited early with code ${code}. stderr: ${stderr}`));
    });
  });
});

after(async () => {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

test("GET /health reports 503 when the database is unreachable", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "error", database: "down" });
});

test("an unreachable database does not crash the process", async () => {
  // The endpoint answering a second time is the evidence: a thrown connection error would have
  // taken the server down with it.
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 503);
  assert.equal(child.exitCode, null);
});

test("the failure response leaks no connection detail", async () => {
  const body = await (await fetch(`${baseUrl}/health`)).text();

  assert.ok(!/postgres(ql)?:\/\//.test(body), "response must not contain a connection string");
  assert.ok(!body.includes("127.0.0.1"), "response must not name the database host");
  assert.ok(!body.toLowerCase().includes("nobody"), "response must not name the database user");
});
