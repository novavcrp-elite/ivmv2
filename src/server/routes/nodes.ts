import { Router } from "express";
import { readJSON, writeJSON } from "../services/db.js";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const wingsNodes = (await readJSON("wings_nodes.json")) || [];
    const customNodes = (await readJSON("nodes.json")) || [];
    const settings = (await readJSON("settings.json")) || {};

    const localNode = {
      id: "local",
      name: settings.localNodeName || "Built-in Node (Local)",
      ip: "127.0.0.1",
      hostname: "localhost",
      apiPort: 3000,
      memory: 8192,
      disk: 50000,
      isLocal: true,
      countryCode: settings.localNodeCountry || "",
      location: settings.localNodeLocation || "",
      status: "online"
    };

    const safeWings = wingsNodes.map((n: any) => ({ ...n, token: undefined, ip: n.hostname || n.ip }));
    const safeCustom = customNodes.map((n: any) => ({ ...n, key: undefined }));

    res.json([localNode, ...safeCustom, ...safeWings]);
  } catch (err) {
    console.error("Error loading nodes:", err);
    res.status(500).json({ error: "Failed to load nodes" });
  }
});

router.post("/", async (req, res) => {
  const user = (req as any).user;
  if (!user || (user.role !== "admin" && user.role !== "owner")) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  
  try {
    const nodes = (await readJSON("wings_nodes.json")) || [];
    const newNode = {
      id: uuidv4(),
      ...req.body,
      createdAt: new Date().toISOString()
    };
    nodes.push(newNode);
    await writeJSON("wings_nodes.json", nodes);
    res.json({ success: true, node: { ...newNode, token: undefined } });
  } catch (err) {
    console.error("Error creating node:", err);
    res.status(500).json({ error: "Failed to save node" });
  }
});

// The built-in node runs on the panel host itself, so only its display name is editable.
router.put("/local", async (req, res) => {
  const user = (req as any).user;
  if (!user || (user.role !== "admin" && user.role !== "owner")) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const countryCode = typeof req.body?.countryCode === "string" ? req.body.countryCode.trim().toUpperCase() : undefined;
  const location = typeof req.body?.location === "string" ? req.body.location.trim() : undefined;

  if (!name && countryCode === undefined && location === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (name.length > 60) return res.status(400).json({ error: "Node name must be 60 characters or fewer" });
  if (countryCode !== undefined && countryCode !== "" && !/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({ error: "Country code must be a two-letter ISO code" });
  }

  try {
    const settings = (await readJSON("settings.json")) || {};
    if (name) settings.localNodeName = name;
    if (countryCode !== undefined) settings.localNodeCountry = countryCode;
    if (location !== undefined) settings.localNodeLocation = location;
    await writeJSON("settings.json", settings);
    res.json({ success: true, name, countryCode, location });
  } catch (err) {
    console.error("Error renaming local node:", err);
    res.status(500).json({ error: "Failed to rename node" });
  }
});

router.get("/:id/health", async (req, res) => {
  res.json({ status: "healthy", message: "Node online" });
});

export default router;
