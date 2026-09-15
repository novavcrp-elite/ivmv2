import "dotenv/config";
import bcrypt from "bcryptjs";
import readline from "readline";
import path from "path";
import fs from "fs-extra";

const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

fs.ensureDirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");

console.log("=== IVM Panel Owner User Creation ===");

// Supported CLI flags: username <value> password <value> mail|email <value>
const ARG_ALIASES: Record<string, "username" | "password" | "email"> = {
  username: "username",
  user: "username",
  password: "password",
  pass: "password",
  mail: "email",
  email: "email",
};

function parseArgs(argv: string[]) {
  const values: { username?: string; password?: string; email?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const field = ARG_ALIASES[String(argv[i]).toLowerCase()];
    if (!field) continue;
    const value = argv[i + 1];
    // Skip when the next token is another flag or missing entirely.
    if (value === undefined || value.startsWith("--") || ARG_ALIASES[String(value).toLowerCase()]) continue;
    values[field] = value;
    i++;
  }
  return values;
}

async function run() {
  const users = await fs.readJson(USERS_FILE);
  const cli = parseArgs(process.argv.slice(2));
  const username = cli.username ?? process.env.IVM_OWNER_USER;
  const password = cli.password ?? process.env.IVM_OWNER_PASS;
  const email = cli.email ?? process.env.IVM_OWNER_EMAIL;

  if (username && password) {
    await createOrUpdateOwner(users, username.trim(), password, email?.trim());
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Username: ", async (username) => {
    rl.question("Password: ", async (password) => {
      rl.close();
      if (!username || !password) {
        console.error("Username and password are required.");
        process.exit(1);
      }
      await createOrUpdateOwner(users, username.trim(), password, email?.trim());
    });
  });
}

async function createOrUpdateOwner(users: any[], username: string, password: string, email?: string) {
  if (!username || username.length < 3) {
    console.error("Error: Username must be at least 3 characters.");
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error("Error: Password must be at least 6 characters.");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const existingIndex = users.findIndex((u: any) => u.username && u.username.toLowerCase() === username.toLowerCase());

  if (existingIndex !== -1) {
    users[existingIndex].password = hashedPassword;
    users[existingIndex].role = "owner";
    if (email) users[existingIndex].email = email;
    users[existingIndex].passwordVersion = (users[existingIndex].passwordVersion || 0) + 1;
    await fs.writeJson(USERS_FILE, users, { spaces: 2 });
    console.log(`User '${username}' updated to Owner successfully.`);
  } else {
    // Demote any old owner so there is only one authoritative owner
    users.forEach((u: any) => {
      if (u.role === "owner") u.role = "admin";
    });

    users.push({
      id: "owner-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      username,
      password: hashedPassword,
      ...(email ? { email } : {}),
      role: "owner",
      passwordVersion: 0,
      createdAt: new Date().toISOString()
    });
    await fs.writeJson(USERS_FILE, users, { spaces: 2 });
    console.log(`Owner user '${username}' created successfully.`);
  }

  // Verification: Read back and verify
  const verifiedUsers = await fs.readJson(USERS_FILE);
  const verifiedUser = verifiedUsers.find((u: any) => u.username && u.username.toLowerCase() === username.toLowerCase());
  if (!verifiedUser || verifiedUser.role !== "owner") {
    console.error("Verification failed: Owner user not found in database.");
    process.exit(1);
  }
  const isMatch = await bcrypt.compare(password, verifiedUser.password);
  if (!isMatch) {
    console.error("Verification failed: Password hash comparison failed.");
    process.exit(1);
  }

  console.log("Owner user verified in database.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed to setup owner account:", err);
  process.exit(1);
});

