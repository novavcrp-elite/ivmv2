import fs from "fs-extra";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn, ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import { downloadJar } from "./jarDownloader.js";
import { panelEvents } from "../events.js";
import { getJavaVersionForMinecraft } from "../../utils/minecraftJava.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const processes = new Map<string, ChildProcess>();

/** Records the dependency manifest a project's install was last run against. */
const DEPS_MARKER = ".ivm-deps.json";
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const fileSignature = async (filePath: string): Promise<string | null> => {
  try {
    const buf = await fs.readFile(filePath);
    return crypto.createHash("sha1").update(buf).digest("hex");
  } catch {
    return null;
  }
};

/**
 * Install a project's dependencies before its process starts.
 *
 * The container runtime always did this inside its entrypoint, but the local
 * runtime spawned `node` / `python3` straight onto the entry file, so anything
 * with dependencies died on the first import. Manifests are hashed against a
 * marker file so restarting an unchanged project does not re-run a slow install.
 */
async function installDependencies(
  serverPath: string,
  type: string,
  logMessage: (msg: string) => void,
): Promise<void> {
  const isNodeApp = type === "nodejs" || type === "node";
  const isPythonApp = type === "python" || type === "python3";
  if (!isNodeApp && !isPythonApp) return;

  const manifest = isNodeApp ? "package.json" : "requirements.txt";
  const manifestSignature = await fileSignature(path.join(serverPath, manifest));
  if (!manifestSignature) return; // no manifest — nothing to install

  const lockSignature = isNodeApp
    ? await fileSignature(path.join(serverPath, "package-lock.json"))
    : null;
  const signature = `${manifest}:${manifestSignature}:${lockSignature || ""}`;

  const markerPath = path.join(serverPath, DEPS_MARKER);
  const previous = await fs.readJSON(markerPath).catch(() => null);
  if (previous?.signature === signature) {
    logMessage(`${manifest} unchanged since the last install — skipping dependency install.`);
    return;
  }

  const isNodeInstall = isNodeApp;
  const command = isNodeInstall ? "npm" : "python3";
  const args = isNodeInstall
    ? ["install", "--no-audit", "--no-fund"]
    : ["-m", "pip", "install", "--disable-pip-version-check", "-r", manifest];

  logMessage(`Installing dependencies from ${manifest}...`);
  const runInstall = (extra: string[] = []) =>
    execFileAsync(command, [...args, ...extra], {
      cwd: serverPath,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

  try {
    let stdout = "";
    try {
      ({ stdout } = await runInstall());
    } catch (err: any) {
      const detail = `${err?.stderr || ""}${err?.stdout || ""}`;
      // Ubuntu 23.04+ and Debian 12 mark the system interpreter as externally
      // managed (PEP 668), which rejects a plain pip install as root.
      if (!isNodeInstall && /externally-managed-environment/i.test(detail)) {
        logMessage("System Python is externally managed; retrying with --break-system-packages...");
        ({ stdout } = await runInstall(["--break-system-packages"]));
      } else {
        throw err;
      }
    }

    const tail = String(stdout || "").trim().split("\n").slice(-6).join("\n");
    if (tail) logMessage(tail);
    await fs.writeJSON(markerPath, { signature, installedAt: new Date().toISOString() }, { spaces: 2 });
    logMessage("Dependencies installed.");
  } catch (err: any) {
    const detail = String(err?.stderr || err?.message || err).trim().split("\n").slice(-8).join("\n");
    // A failed install is worth surfacing, but the process may still run if the
    // dependencies happen to be vendored — so warn rather than abort the start.
    logMessage(`Dependency install failed (continuing anyway):\n${detail}`);
  }
}

const localStartedAt = new Map<string, string>();
const activeStreams = new Set<string>();

export const resolveJavaBinary = async (targetJavaVersion?: string): Promise<string | null> => {
  if (process.env.JAVA_BIN && await fs.pathExists(process.env.JAVA_BIN)) {
    return process.env.JAVA_BIN;
  }
  const versionSpecificCandidates: string[] = [];
  if (targetJavaVersion) {
    versionSpecificCandidates.push(
      `/usr/lib/jvm/java-${targetJavaVersion}-openjdk-amd64/bin/java`,
      `/usr/lib/jvm/java-${targetJavaVersion}-openjdk-arm64/bin/java`,
      `/usr/lib/jvm/java-${targetJavaVersion}-openjdk/bin/java`,
      `/usr/lib/jvm/temurin-${targetJavaVersion}-jdk-amd64/bin/java`,
      `/usr/lib/jvm/temurin-${targetJavaVersion}-jdk/bin/java`,
      `/opt/java/openjdk-${targetJavaVersion}/bin/java`,
      `/opt/jdk-${targetJavaVersion}/bin/java`
    );
  }
  for (const cand of versionSpecificCandidates) {
    if (await fs.pathExists(cand)) {
      return cand;
    }
  }

  const candidates = [
    "java",
    "/usr/bin/java",
    "/usr/local/bin/java",
    "/usr/lib/jvm/java-26-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-25-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-22-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-21-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-17-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-11-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-8-openjdk-amd64/bin/java",
    "/usr/lib/jvm/default-java/bin/java",
    "/opt/java/openjdk/bin/java"
  ];
  for (const cand of candidates) {
    if (cand === "java") {
      try {
        await execAsync("which java");
        return "java";
      } catch (e) {}
    } else if (await fs.pathExists(cand)) {
      return cand;
    }
  }
  return null;
};

export const createLocalServer = async (serverData: any) => {
  const serverPath = path.join(process.cwd(), ".data", "servers", serverData.id);
  await fs.ensureDir(serverPath);

  const type = (serverData.type || "paper").toLowerCase();

  if (type === "nodejs" || type === "node") {
    const indexPath = path.join(serverPath, "index.js");
    const pkgPath = path.join(serverPath, "package.json");
    if (!await fs.pathExists(indexPath)) {
      await fs.writeFile(indexPath, `// Node.js Application on IVM Panel\nconst http = require('http');\nconst port = process.env.PORT || process.env.SERVER_PORT || ${serverData.port || 3000};\n\nconsole.log('==============================================');\nconsole.log('🚀 Node.js Application Running on port ' + port);\nconsole.log('Node Version: ' + process.version);\nconsole.log('Upload your files in File Manager to customize!');\nconsole.log('==============================================');\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'application/json' });\n  res.end(JSON.stringify({ status: 'online', runtime: 'node.js', time: new Date().toISOString() }));\n});\n\nserver.listen(port, '0.0.0.0', () => {\n  console.log(\`[Server] Listening on http://0.0.0.0:\${port}\`);\n});\n`);
    }
    if (!await fs.pathExists(pkgPath)) {
      await fs.writeFile(pkgPath, JSON.stringify({
        name: (serverData.name || "node-app").toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        version: "1.0.0",
        description: "Node.js application hosted on IVM Panel",
        main: "index.js",
        scripts: { "start": "node index.js" }
      }, null, 2));
    }
    return `local-${serverData.id}`;
  } else if (type === "python" || type === "python3") {
    const mainPath = path.join(serverPath, "main.py");
    const reqPath = path.join(serverPath, "requirements.txt");
    if (!await fs.pathExists(mainPath)) {
      await fs.writeFile(mainPath, `# Python Application on IVM Panel\nimport os\nimport sys\nfrom http.server import HTTPServer, BaseHTTPRequestHandler\n\nport = int(os.environ.get("SERVER_PORT", os.environ.get("PORT", ${serverData.port || 8000})))\nprint("==============================================", flush=True)\nprint("🐍 Python Application Running", flush=True)\nprint(f"Python Version: {sys.version}", flush=True)\nprint(f"Listening Port: {port}", flush=True)\nprint("Upload your files in File Manager to customize!", flush=True)\nprint("==============================================", flush=True)\n\nclass RequestHandler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200)\n        self.send_header('Content-type', 'application/json')\n        self.end_headers()\n        self.wfile.write(b'{"status": "online", "runtime": "python"}')\n\n    def log_message(self, format, *args):\n        print(f"[{self.log_date_time_string()}] {format % args}", flush=True)\n\nserver = HTTPServer(('0.0.0.0', port), RequestHandler)\nprint(f"[Server] Listening on http://0.0.0.0:{port}", flush=True)\ntry:\n    server.serve_forever()\nexcept KeyboardInterrupt:\n    print("\\nStopping server...", flush=True)\n    server.server_close()\n`);
    }
    if (!await fs.pathExists(reqPath)) {
      await fs.writeFile(reqPath, "# Add python dependencies here\n");
    }
    return `local-${serverData.id}`;
  } else if (type === "velocity") {
    const configPath = path.join(serverPath, "velocity.toml");
    if (!await fs.pathExists(configPath)) {
      await fs.writeFile(configPath, `bind = "0.0.0.0:${serverData.port || 25577}"\nmotd = "&#09add3A Velocity Server"\n`);
    }
  } else if (type === "bungeecord" || type === "waterfall") {
    const configPath = path.join(serverPath, "config.yml");
    if (!await fs.pathExists(configPath)) {
      await fs.writeFile(configPath, `listeners:\n- query_port: ${serverData.port || 25577}\n  host: 0.0.0.0:${serverData.port || 25577}\n  max_players: 1000\n`);
    }
  } else {
    // Standard Minecraft server
    const eulaPath = path.join(serverPath, "eula.txt");
    await fs.writeFile(eulaPath, "eula=true\n");

    const propsPath = path.join(serverPath, "server.properties");
    if (!await fs.pathExists(propsPath)) {
      await fs.writeFile(propsPath, `server-port=${serverData.port || 25565}\n`);
    }
  }

  const jarPath = path.join(serverPath, "server.jar");
  let needDownload = false;
  if (!await fs.pathExists(jarPath)) {
    needDownload = true;
  } else {
    const stat = await fs.stat(jarPath);
    if (stat.size < 500 * 1024) {
      needDownload = true;
    }
  }

  if (needDownload) {
    try {
      await downloadJar(type, serverData.version || "latest", jarPath);
    } catch (e: any) {
      console.warn(`[Local Server] Deferred JAR download: ${e.message}`);
    }
  }

  return `local-${serverData.id}`;
};


export const startLocalServer = async (id: string, serverData: any) => {
  const serverPath = path.join(process.cwd(), ".data", "servers", id);
  await fs.ensureDir(serverPath);
  const type = (serverData.type || "paper").toLowerCase();

  const logPath = path.join(serverPath, "panel.log");
  try {
    await fs.writeFile(logPath, "");
  } catch (e) {}
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });

  const emitLog = (msg: string) => {
    panelEvents.emit("log", id, msg);
  };

  const logMessage = (msg: string) => {
    const formatted = `[Panel] ${msg}\n`;
    if (logStream.writable) {
      logStream.write(formatted);
    }
    emitLog(formatted);
  };

  let child: any;

  if (type === "nodejs" || type === "node") {
    let entry = "index.js";
    for (const testFile of ["index.js", "app.js", "server.js", "main.js", "bot.js"]) {
      if (await fs.pathExists(path.join(serverPath, testFile))) {
        entry = testFile;
        break;
      }
    }
    await installDependencies(serverPath, type, logMessage);
    child = spawn("node", [entry], {
      cwd: serverPath,
      env: {
        ...process.env,
        PORT: String(serverData.port || 3000),
        SERVER_PORT: String(serverData.port || 3000),
        NODE_ENV: "production"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
  } else if (type === "python" || type === "python3") {
    let entry = "main.py";
    for (const testFile of ["main.py", "app.py", "bot.py", "index.py", "server.py"]) {
      if (await fs.pathExists(path.join(serverPath, testFile))) {
        entry = testFile;
        break;
      }
    }
    await installDependencies(serverPath, type, logMessage);
    child = spawn("python3", ["-u", entry], {
      cwd: serverPath,
      env: {
        ...process.env,
        PORT: String(serverData.port || 8000),
        SERVER_PORT: String(serverData.port || 8000),
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
  } else {
    const jarPath = path.join(serverPath, "server.jar");

    let needDownload = false;
    if (!await fs.pathExists(jarPath)) {
      needDownload = true;
    } else {
      const stat = await fs.stat(jarPath);
      if (stat.size < 500 * 1024) {
        needDownload = true;
      }
    }

    if (needDownload) {
      logMessage(`Server JAR missing or incomplete. Downloading ${type} (${serverData.version || "latest"})...`);
      try {
        await downloadJar(type, serverData.version || "latest", jarPath);
        logMessage("Server JAR downloaded successfully.");
      } catch (dlErr: any) {
        logMessage(`Failed to download JAR: ${dlErr.message}`);
        throw new Error(`Failed to download server.jar: ${dlErr.message}`);
      }
    }

    // Ensure EULA is accepted
    const eulaPath = path.join(serverPath, "eula.txt");
    await fs.writeFile(eulaPath, "eula=true\n");

    const memory = serverData.ram || 1;
    const effectiveJava = serverData.javaVersion || getJavaVersionForMinecraft(serverData.version || "26.2", serverData.type);
    const javaBin = await resolveJavaBinary(effectiveJava);
    if (!javaBin) {
      const errMessage = "Java (JDK/JRE) was not found on this system. Please install Java 21 (e.g. 'sudo apt update && sudo apt install -y openjdk-21-jre-headless') or select Docker runtime.";
      logMessage(errMessage);
      throw new Error(errMessage);
    }

    if (serverData.startupCommand && serverData.startupCommand.trim()) {
      const parts = serverData.startupCommand.trim().split(/\s+/);
      const bin = parts[0];
      const args = parts.slice(1);
      child = spawn(bin, args, {
        cwd: serverPath,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } else {
      child = spawn(javaBin, [`-Xms${memory}G`, `-Xmx${memory}G`, "-Djline.terminal=jline.UnsupportedTerminal", "-jar", "server.jar", "nogui", "--nojline"], {
        cwd: serverPath,
        stdio: ["pipe", "pipe", "pipe"]
      });
    }
  }

  processes.set(id, child);

  child.on("spawn", () => {
    localStartedAt.set(id, new Date().toISOString());
    logMessage(`Server process started with PID ${child.pid} for ${serverData.name || id} (${type})`);
  });

  child.on("error", (err: Error) => {
    localStartedAt.delete(id);
    logMessage(`Failed to start server process: ${err.message}`);
    if (err.message.includes("ENOENT")) {
        logMessage("---- RUNTIME NOTICE ----");
        logMessage(`Required executable or binary is missing or not in PATH for runtime (${type})!`);
        logMessage("If running Minecraft with the Node.js / Local Process runtime on a Linux VPS, ensure OpenJDK 21 is installed:");
        logMessage("  sudo apt update && sudo apt install -y openjdk-21-jre-headless");
        logMessage("Alternatively, you can switch to the Docker Container runtime in Settings.");
        logMessage("------------------------");
    }
  });

  child.on("close", (code: number | null) => {
    logMessage(`Server process exited with code ${code}`);
    processes.delete(id);
    localStartedAt.delete(id);
    activeStreams.delete(id);
  });

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (logStream.writable) logStream.write(text);
    emitLog(text);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (logStream.writable) logStream.write(text);
    emitLog(text);
  });

  // Verify process does not immediately crash on startup
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const errorHandler = (err: Error) => {
      if (!settled) {
        settled = true;
        processes.delete(id);
        localStartedAt.delete(id);
        reject(new Error(`Server failed to start: ${err.message}`));
      }
    };
    const exitHandler = (code: number | null) => {
      if (!settled && code !== 0 && code !== null) {
        settled = true;
        processes.delete(id);
        localStartedAt.delete(id);
        reject(new Error(`Server process exited immediately with code ${code}`));
      }
    };
    child.once("error", errorHandler);
    child.once("close", exitHandler);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.removeListener("error", errorHandler);
        child.removeListener("close", exitHandler);
        resolve();
      }
    }, 450);
  });
};


export const stopLocalServer = async (id: string): Promise<boolean> => {
  localStartedAt.delete(id);
  const child = processes.get(id);
  if (!child) return true;

  if (child.stdin && child.stdin.writable) {
    try {
      child.stdin.write("stop\nend\nexit\n");
    } catch (e) {}
  }
  try {
    child.kill("SIGTERM");
  } catch (e) {}

  const start = Date.now();
  while (processes.has(id) && Date.now() - start < 4000) {
    await new Promise(r => setTimeout(r, 100));
  }

  if (processes.has(id)) {
    try {
      child.kill("SIGKILL");
    } catch (e) {}
    processes.delete(id);
  }

  activeStreams.delete(id);
  return true;
};

export const killLocalServer = async (id: string): Promise<void> => {
  localStartedAt.delete(id);
  const child = processes.get(id);
  if (child) {
    try {
      child.kill("SIGKILL");
    } catch (e) {}
    processes.delete(id);
    activeStreams.delete(id);
    panelEvents.emit("log", id, `[Panel] Process forcefully killed (SIGKILL).\n`);
  }
};

export const restartLocalServer = async (id: string, serverData: any): Promise<void> => {
  await stopLocalServer(id);
  if (processes.has(id)) {
    throw new Error("Failed to stop previous process before restarting.");
  }
  await startLocalServer(id, serverData);
  const status = await getLocalServerStatus(id);
  if (!status.State.Running) {
    throw new Error("Server process failed to start during restart.");
  }
};

export const deleteLocalServer = async (id: string) => {
  await stopLocalServer(id);
  localStartedAt.delete(id);
  const serverPath = path.join(process.cwd(), ".data", "servers", id);
  await fs.remove(serverPath);
};

export const getLocalServerStatus = async (id: string) => {
  const isRunning = processes.has(id);
  return {
    State: {
      Running: isRunning,
      Status: isRunning ? "running" : "exited",
      StartedAt: isRunning ? localStartedAt.get(id) || null : null
    }
  };
};

/** Last CPU tick sample per server, used to derive an instantaneous load. */
const cpuSamples = new Map<string, { ticks: number; at: number }>();

/**
 * Instantaneous CPU percentage for a process, from /proc/<pid>/stat.
 *
 * `ps -o %cpu` reports an average across the whole process lifetime, so a
 * server that was busy at boot and idle afterwards reads a flat 0.00% forever —
 * which is what made the CPU graph look dead. Differencing two samples of the
 * process's CPU ticks shows the load that is happening now.
 */
async function sampleCpu(id: string, pid: number): Promise<number> {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, "utf-8");
    // The second field is the executable name in parentheses and may itself
    // contain spaces, so the fields after it are read from the last ")".
    const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = (parseInt(tail[11], 10) || 0) + (parseInt(tail[12], 10) || 0);

    const now = Date.now();
    const previous = cpuSamples.get(id);
    cpuSamples.set(id, { ticks, at: now });

    if (!previous || now <= previous.at) return 0;

    const USER_HZ = 100;
    const cores = os.cpus()?.length || 1;
    const elapsed = (now - previous.at) / 1000;
    const usedSeconds = Math.max(0, ticks - previous.ticks) / USER_HZ;
    return Math.max(0, Math.min(100, (usedSeconds / elapsed) * (100 / cores)));
  } catch {
    return 0;
  }
}

export const getLocalServerStats = async (id: string) => {
  const child = processes.get(id);
  if (!child || !child.pid || !processes.has(id)) {
    cpuSamples.delete(id);
    // netIn/netOut are null rather than 0: a host process has no network
    // namespace of its own, so its bytes cannot be attributed, and reporting 0
    // would draw a plausible-looking but fabricated flat line.
    return { cpu: 0, ram: 0, disk: 0, netIn: null, netOut: null };
  }

  let ram = 0;
  let disk = 0;
  const cpu = await sampleCpu(id, child.pid);

  try {
    const { stdout } = await execAsync(`ps -p ${child.pid} -o rss`);
    const lines = stdout.trim().split("\n");
    if (lines.length > 1) {
      const rssKb = parseInt(lines[1].trim().split(/\s+/)[0]) || 0;
      ram = Math.round((rssKb / 1024) * 10) / 10;
    }
  } catch (e) {}

  try {
    const serverPath = path.join(process.cwd(), ".data", "servers", id);
    const { stdout } = await execAsync(`du -sm "${serverPath}"`);
    const parts = stdout.trim().split(/\s+/);
    const diskMB = parseInt(parts[0]) || 0;
    disk = Math.round((diskMB / 1024) * 100) / 100;
  } catch (e) {
    disk = 0.05;
  }

  return {
    cpu,
    ram,
    disk,
    netIn: null,
    netOut: null,
  };
};

export const getLocalServerLogs = async (id: string) => {
  const logPath = path.join(process.cwd(), ".data", "servers", id, "panel.log");
  if (await fs.pathExists(logPath)) {
    const logs = await fs.readFile(logPath, "utf8");
    return logs.split("\n").slice(-100).join("\n");
  }
  return "";
};

export const attachLocalServerSocket = (id: string, serverId: string) => {
  // handled natively by startLocalServer now to capture all output reliably
};

export const sendLocalServerCommand = async (id: string, command: string) => {
  const child = processes.get(id);
  if (child && child.stdin) {
    child.stdin.write(command + "\n");
  }
};

export const getLocalProcessInfo = (id: string) => {
  const child = processes.get(id);
  const serverPath = path.join(process.cwd(), ".data", "servers", id);
  if (child) {
    return {
      pid: child.pid,
      jarPath: path.join(serverPath, "server.jar"),
      logPath: path.join(serverPath, "panel.log")
    };
  }
  return null;
};
