import express from "express";
import { readJSON } from "../services/db.js";

const router = express.Router();
import authRoutes from "./auth.js";
import serverRoutes from "./servers.js";
import systemRoutes from "./system.js";
import apiKeyRoutes from "./api-keys.js";
import nodeRoutes from "./nodes.js";
import vpsRoutes from "./vps.js";
import { databaseRoutes, databaseHostRoutes } from "./databases.js";

router.use("/auth", authRoutes);
router.use("/servers", serverRoutes);
router.use("/system", systemRoutes);
router.use("/admin/api-keys", apiKeyRoutes);
router.use("/nodes", nodeRoutes);
router.use("/vps", vpsRoutes);
// Admin-managed MySQL hosts, then the per-server databases created on them.
router.use("/database-hosts", databaseHostRoutes);
router.use("/databases", databaseRoutes);

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    panel: "IVM Panel",
    version: "3.0.0",
    timestamp: Date.now(),
    nodeEnv: process.env.NODE_ENV || "development"
  });
});

router.get("/settings", async (req, res) => {
  const settings = await readJSON("settings.json") || {};
  res.json({ 
    version: "3.0.0",
    panelName: settings.panelName || "IVM Panel",
    // Falls back to the bundled IVM logo until an admin uploads their own.
    // An explicit empty string means "no logo", so the panel's Remove action works.
    panelLogo: settings.panelLogo !== undefined ? settings.panelLogo : "/ivm-logo.png",
    // Used for the link-preview blurb messengers show when the URL is pasted.
    panelDescription: settings.panelDescription || "",
    panelBackgroundImage: settings.panelBackgroundImage || "",
    panelBackgroundBlur: settings.panelBackgroundBlur !== undefined ? settings.panelBackgroundBlur : 10,
    enablePlayit: settings.enablePlayit !== undefined ? settings.enablePlayit : false,
    enableTutorial: settings.enableTutorial !== undefined ? settings.enableTutorial : true,
    enableLoginAnimation: settings.enableLoginAnimation !== undefined ? settings.enableLoginAnimation : true,
    enableRegistration: settings.enableRegistration !== undefined ? settings.enableRegistration : true,

    enableGoogleLogin: settings.enableGoogleLogin !== undefined ? settings.enableGoogleLogin : false,
    firebaseApiKey: settings.firebaseApiKey || "",
    firebaseAuthDomain: settings.firebaseAuthDomain || "",
    firebaseProjectId: settings.firebaseProjectId || "",
    firebaseStorageBucket: settings.firebaseStorageBucket || "",
    firebaseMessagingSenderId: settings.firebaseMessagingSenderId || "",
    firebaseAppId: settings.firebaseAppId || "",
    defaultRuntime: settings.defaultRuntime || process.env.DEFAULT_RUNTIME || "docker",
    isDevPanel: (process.env.PANEL_TYPE === "dev" || process.env.PORT === "3000") && !process.env.FORCE_MAIN_PANEL,
    panelPort: process.env.PORT || "6767"
  });
});

export default router;
