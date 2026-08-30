// Creates an ADMIN account. This is the controlled mechanism the architecture requires: it runs on
// the server, by an operator who already holds the environment and its secrets, and there is no
// endpoint anywhere in the API that can produce an ADMIN.
//
// Usage:
//   npm run create-admin -- admin@example.com
//
// The password is read from standard input, never from an argument, so it cannot be left behind in
// shell history or a process listing. On a terminal the input is not echoed.

const { Writable } = require("node:stream");
const readline = require("node:readline");

const { prisma } = require("../src/config/prisma");
const { hashPassword } = require("../src/lib/password");
const { registerSchema } = require("../src/validators/auth.validator");

function readPassword() {
  // Piped input is read whole, which is what makes the script usable from an automated setup.
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let input = "";

      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", () => resolve(input.trim()));
      process.stdin.on("error", reject);
    });
  }

  // On a terminal the prompt is written but the typed characters are swallowed, so the password
  // never appears on screen.
  const maskedOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!maskedOutput.muted) {
        process.stdout.write(chunk, encoding);
      }

      callback();
    },
  });

  const rl = readline.createInterface({ input: process.stdin, output: maskedOutput, terminal: true });

  return new Promise((resolve) => {
    rl.question("Password: ", (answer) => {
      maskedOutput.muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });

    maskedOutput.muted = true;
  });
}

async function main() {
  const email = process.argv[2];

  if (!email) {
    throw new Error("Usage: npm run create-admin -- <email>");
  }

  const password = await readPassword();

  // The same rules public registration applies. An administrator is the account most worth
  // protecting, so it would be perverse to hold it to a weaker standard.
  const credentials = registerSchema.safeParse({ email, password });

  if (!credentials.success) {
    const problems = credentials.error.issues
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid credentials: ${problems}`);
  }

  // Named so the operator can see which database this landed in before trusting that it worked.
  // The name only, never the connection string.
  const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;

  const admin = await prisma.user.create({
    data: {
      email: credentials.data.email,
      passwordHash: await hashPassword(credentials.data.password),
      role: "ADMIN",
    },
  });

  console.log(`Created ADMIN ${admin.email} (${admin.id}) in database "${name}".`);
}

main()
  .catch((error) => {
    // P2002 is Prisma's unique-constraint violation, which here means the address is taken. Unlike
    // the registration endpoint there is no reason to be careful about it: the only audience is an
    // operator who can read the table anyway.
    const message = error.code === "P2002" ? "That email address is already registered." : error.message;

    console.error(message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
