# IVM Panel — Changelog

## Per-server quotas: databases & backups

### 1. The wizard's step-4 limits were being thrown away
- Step 4 now lets you pick how many **databases** and **backups** a server may have. The wizard sent both values on create, but `createServer` never destructured or stored them, so every server silently fell back to the built-in defaults no matter what was chosen.
- Both limits are now persisted on the server record. Values arriving from the browser are clamped (`clampLimit`): unparseable → default (5 / 10), negative → default, and anything above 500 → 500. `0` means *none allowed*, matching the "None" label in the wizard.

### 2. The backup quota is now actually enforced
- `backupLimit` was stored but never applied — a tenant could create unlimited archives and fill the disk. `createBackup` now counts the existing `.zip` files and refuses with `403 BACKUP_LIMIT_REACHED` once the limit is reached (with `limit` and `count` in the body so the UI can explain it). `0` reports *"Backups are disabled for this server."*
- The database quota was already enforced in `routes/databases.ts`; the two now agree on what `0` means.

### 3. Three bugs surfaced while verifying
- **A docker→local fallback stranded its container.** When a host blocks container starts, the panel falls back to the local runtime — but the container `docker create` had already made was abandoned in `created` state, holding its name and writable layer forever. The fallback now releases it (`releaseStrandedContainer`) before switching, the same fix already applied to the container-driver path.
- **The runtime switch was not persisted if the fallback also failed.** `startServer` only wrote the record after a *successful* start, so a failed fallback left the record claiming `runtimeType: docker` with a `containerId` that no longer existed. The switch is now written as soon as the runtime changes.
- **Deleting a local-runtime server leaked its process.** The teardown was gated on `if (server.containerId)`, which is `null` for the local runtime and for anything that fell back to it — so the record vanished and the JVM kept running (confirmed: the process outlived its deleted directory). The guard now keys off the runtime instead of the container id.

## Link previews, engine logos, VPS ports & the Virtual Machine category

### 1. The pasted-URL text was the meta description, not a footer
- Pasting the panel URL into Discord/WhatsApp/Telegram showed *"A web-based game server management panel with file manager, terminal access, and playit.gg integration"* because that was the hard-coded `<meta name="description">`. Messengers build their preview from the page's `<title>` plus that tag — no footer is involved.
- `index.html` now carries **Open Graph and Twitter tags** with placeholder tokens, and the server fills them per request from the panel settings: name, description, URL and logo. The copy, `og:image` and the favicon all follow whatever the admin configures.
- New **Link Preview Description** field in Admin Settings → Branding, so the blurb is editable and falls back to a built-in default.
- **Two bugs found and fixed here:** `express.static` was serving `index.html` for `/` before the handler could run, so the tokens arrived unsubstituted; it is now mounted with `index: false`. And the old panel-rename handler **rewrote `index.html` and `dist/index.html` on disk** — a runtime build mutating its own source, which would also have destroyed the new tokens. That block is gone; the title is rendered per request instead.

### 2. Minecraft engine logos
- Bundled `public/icons/`: `minecraft.svg`, `paper.png`, `spigot.png`, `fabric.png`, `forge.jpg` and `velocity.svg`, taken from the projects' own published marks.
- The deploy wizard's engine cards now show the real logos, and the **MINECRAFT ENGINES** header carries the Minecraft mark. The lucide glyph remains as the fallback, and is the only mark for **BungeeCord**, which publishes no standalone badge.
- Sourcing was verified, not guessed: the first avatar URLs I tried resolved to unrelated personal accounts, so the correct `PaperMC` / `SpigotMC` / `FabricMC` / `MinecraftForge` / `Velocity` orgs were looked up. Forge's avatar is served as JPEG despite the extension, so it is stored as `forge.jpg`, and the two monochrome SVGs ship with an explicit white fill — the originals have no `fill`, which renders black on a dark theme.

### 3. VPS port ranges and an SSH port forward
- New **NETWORK & PORTS** section in the deploy wizard: a **port range** (from/to, 1024–65535, max 100 ports) and an **SSH port forward** that publishes a host port onto TCP 22 inside the VPS. Both default to auto-allocation of the first free ports, and both are validated live in the wizard before submit.
- The allocator avoids collisions with other VPS ranges, existing SSH forwards and game server ports. Reversed, half-specified, over-wide and already-used ranges are all rejected with specific messages.
- The forward is published as a runtime proxy device (`lxc config device add … proxy`); classic container tools have no equivalent, so those report why instead of silently doing nothing. A failure to publish **does not lose the VPS** — the result is recorded and surfaced.
- The SSH panel now shows the published route — e.g. `ssh root@5.189.132.216 -p 30222` — alongside the private address, which is the only way in from outside since the VPS has no public IPv4.
- Port range and SSH port are shown on the VPS list cards and in the deploy REVIEW step.

### 4. New VIRTUAL MACHINE sidebar category
- Reserved for QEMU-backed machines, admin-only, rendered as a category heading with a muted placeholder ("QEMU machines — coming soon") so an empty section reads as *not built yet* rather than as a rendering glitch. Future buttons drop straight into its `items` array.

### 5. MariaDB installed and wired up as a database host
- Installed **MariaDB 10.11** on this host at your request; it is running on `127.0.0.1:3306`.
- Created a dedicated `ivm_panel` account for the panel and registered it as the **Local MariaDB** database host (linked to the built-in node), verified through the panel's own connection test.

### 6. The database feature is now proven end to end
- Created a database through the panel API: it provisioned schema `ssurvival_survival` and user `usurvival_survival` with a generated password.
- Verified against the live server: the schema existed, the user existed at `%`, and **the created user connected over TCP, created a table, inserted and read the value back** — so the grant really works, not just the DDL.
- Also verified: wrong credentials rejected before saving (`502`), no password ever leaves the server, duplicate names rejected (`409`), per-server quota tracked (`1/5` used), and deletion removed both the schema and the user.
- A **Demo VPS** was created and started so the whole Overview → VPS flow can be inspected in the UI, with an auto-assigned range of 30000–30009 and SSH published on 30222.

## Database category (Pterodactyl-style MySQL) & Share/Invite block

### 1. New DATABASE sidebar category
- Added between **Servers** and **Account**:

| Category | Buttons |
|---|---|
| **DATABASE** | Databases (everyone) · Database Hosts (admin/owner only) |

- Routes `/databases` (ProtectedRoute) and `/databases/hosts` (AdminRoute).

### 2. Database Hosts — admin page
- New `src/pages/DatabaseHosts.tsx` with the form you asked for: **Database nickname**, **Host**, **Port**, **Username**, **Password**, and a **Linked node** dropdown populated from `/api/nodes` ("Any node" plus the built-in node and every Wings node).
- Credentials are verified against the MySQL server *before* they are saved, so a typo cannot silently sit in the panel. Each host card shows its nickname, `host:port`, username, linked node and database count, with **Test connection**, **View schemas** (live `SHOW DATABASES`), **Edit** and **Delete**.
- Editing leaves the password blank by default — submitting empty keeps the stored one, so the form can be saved without re-typing the secret. Passwords are never returned to the browser.
- A host with databases on it refuses to delete until those databases are removed.

### 3. Databases — user page
- New `src/pages/Databases.tsx`. A user picks one of **their own** servers and a name, and the panel creates the schema, a dedicated user, the grant and a strong 20-character password in one step ("auto create user db etc").
- Names are derived from the server's short id, so `survival` on server `b3f1a2c4…` becomes database `sb3f1a2c4_survival` and user `ub3f1a2c4_survival`.
- Each card shows host, database, username and password with per-field copy buttons plus a full connection string. Deleting removes the schema and its user together.
- A per-server limit (default 5, overridable with `databaseLimit` on a server or in `settings.json`) is enforced, and the create dialog shows remaining slots.
- The host is chosen automatically: the host linked to the server's node first, then an unlinked host.

### 4. MySQL driver
- Added **`mysql2`** as a project dependency — without it the panel could not talk to MySQL at all. `src/server/services/mysql.ts` wraps connection, `CREATE DATABASE`/`CREATE USER`/`GRANT`, `DROP`, `SHOW DATABASES` and `SELECT VERSION()`.
- MySQL cannot parameterise identifiers, so every generated name is validated against `^[A-Za-z0-9_]{1,64}$` and backtick-quoted, while passwords and user hosts use escaped literals. An injection attempt (`'; DROP DATABASE mysql; --`) reduces to the identifier `sdropdata_drop_database_mysql`; generated passwords contain no quotes, backslashes, semicolons, backticks or dollar signs.
- A failed create rolls back the schema and the user it may have made, and an existing user has its password rotated rather than the whole operation failing — so a retry after a partial failure works.

### 5. Share / Invite block
- New **Share** tab in Admin Settings (`src/components/SharePanel.tsx`) holding the promo block —
  `🎮 A WEB-BASED GAME & VPS SERVER MANAGEMENT PANEL` … `🚀 POWERFUL • MODERN • FAST • ALL-IN-ONE` —
  followed by the panel name, the panel URL and the logo URL.
- The **Copy promo text** button puts it on the clipboard; the block is also a read-only textarea that selects itself on click, because the clipboard API is blocked on plain-http installs.
- The logo appears beside it as a live preview, and its URL is appended on the last line so Discord/WhatsApp/Telegram render it as the preview image. An uploaded (data-URL) logo cannot be fetched by a messenger, so the panel explains that instead of pasting base64.

## VPS control on Overview, per-VPS tooling & runtime-name hygiene

### 1. VPS controls on the Overview page
- The dashboard's **VPS Instances** section now uses the same card language as the game-server rows: a 12-column `article` grid with a rank numeral, the container name in a themed chip, a sparkline, a vCPU/RAM/DISK readout, the private address and a status dot, plus the arrow affordance.
- Stop / Start / Restart and a **Manage** button sit in the card footer, and each card embeds the shared `VpsTools` panel, so Overview offers the same management UI as `/vps`.

### 1b. Node location completed on the built-in node
- The built-in node card already stored a country but had no way to set the free-text **City / region**, even though `PUT /api/nodes/local` accepted it and the card's tooltip displayed it. A small inline input now sits beside the country select, saving on Enter or blur (Esc reverts), so both halves of a node's location are editable.

### 2. Per-VPS tools (shared component)
- New `src/components/VpsTools.tsx` adds **SSH**, **Files**, **Reinstall OS** and **Mining** to every VPS card. SSH reveals host/port/user/password and a copyable `ssh` command backed by `GET /api/vps/:id/ssh` (one credential set per container, generated on first read). Files lists, uploads (`multer`, `.data/vps-files/`) and deletes `GET|POST|DELETE /api/vps/:id/files` with a download route.
- Reinstall destroys and recreates the container from a chosen image (`POST /api/vps/:id/reinstall`) and rotates the SSH password. Mining reads a XMRig-style summary API from inside the container (`GET /api/vps/:id/mining`) and reports hashrate, shares, pool and uptime.

### 3. Runtime names no longer reach the UI
- `execFileAsync` in the container driver now scrubs engine names from every error string it raises, so raw tool output can never surface in the panel. Failing operations report **"The container operation failed"** plus a scrubbed detail.
- The literal bridge name was removed from all user-facing copy, the INSTALL NOW status text now says **"Installing the container runtime"**, and the deploy wizard no longer ships the bridge value from the browser — the server applies its own default.
- The mining endpoint checks whether the VPS is actually running first and returns plain-language guidance instead of a command trace.

### 4. Creation failures no longer strand containers
- A failed `createContainer` now discards the half-built container before rethrowing. Previously a failed start (for example when the panel host is itself a container, so nested start is impossible) left a STOPPED rootfs on the node.
- Deleting a VPS whose container is already gone is now treated as success: the "gone" match also covers classic LXC's *"Container is not defined"* wording, not just *"not found"*.

### 5. Containerised hosts no longer offer a deploy button that cannot work
- A runtime being installed is not the same as provisioning being possible: a host that is itself containerised cannot create nested containers. The status now reports **`nestedBlocked`**, and both VPS pages show an amber **NESTED VIRTUALISATION UNAVAILABLE** notice explaining that the panel must run on a VM or dedicated host.
- When simulation is enabled the category deliberately keeps a usable management UI (records are marked **SIMULATED**), so the feature can still be exercised without misleading anyone about what is real. With `IVM_VPS_SIMULATE=false`, `canProvision` is `false` and the Deploy button is disabled instead of failing mid-provision.

### 6. Post-deploy verification fixes
- The running server had been a **stale build** (started before the tooling routes existed) while static assets were read fresh from disk, so `/api/vps/:id/*` silently fell through to the SPA. Restarting the process on the current bundle restored every route; the new start-up path uses `setsid` so the process survives the launching shell.
- Added the `nodeId`, `nodeName`, `cpuModel`, `motherboard`, `bridge` and `hostname` fields to the list page's `Vps` type, which the card already rendered.

## VPS images, editable resources, Docker access & simulation mode

### 1. OS images limited to four current releases
- `LXC_TEMPLATES` is now Ubuntu 22.04 (Jammy), Ubuntu 24.04 (Noble), Debian 12 (Bookworm) and Debian 13 (Trixie). The Alpine/Rocky/CentOS/Arch entries were dropped.
- Each template carries a `logo`; the official distro marks were bundled as `public/icons/ubuntu.svg` (Ubuntu orange `#E95420`) and `public/icons/debian.svg` (Debian red `#A80030`), and the wizard's image cards now render them instead of a generic box glyph.

### 2. Editable resources with GB quick-select
- The RESOURCES step keeps its preset buttons but each resource now has a **numeric input** beside them, so exact values can be typed: vCPU 1–64, Memory 1–128 GB, Disk 1–2000 GB. Values are clamped on entry and stored in GB (memory converts to MiB for the runtime).
- Presets are GB-graded (1/2/4/8/16 GB memory, 10/25/50/100 GB disk) and highlight when the current value matches.

### 3. Docker access for containers
- New **ENABLE DOCKER** toggle (plus the existing KVM and all-devices ones). On LXD it adds `security.nesting` and `security.syscalls.intercept.mknod/setxattr` at launch and attaches `/dev/fuse` when present (fuse-overlayfs); on classic LXC it writes the apparmor/cap-drop/cgroup equivalents. Stored on the record and shown as a **DOCKER** badge on the VPS cards.

### 4. Simulation mode — management UI without LXC
- **This host is itself an LXC container** (`systemd-detect-virt` → `lxc`), so nested containers cannot be created and the snap LXD install cannot work here.
- New `src/server/services/lxcSim.ts` keeps `.data/vps-sim.json`, and `detectLxc()` now reports `simulated` / `canProvision`. When no real runtime exists, the panel falls back to the simulator so the **whole VPS management UI stays usable** — deploy, list, start, stop, restart, delete — with simulated addresses (`10.77.0.x`). Set `IVM_VPS_SIMULATE=false` to disable and keep the old hard `503`.
- Simulated VPS are clearly labelled: a sky-blue **SIMULATION MODE** banner on both pages and a **SIMULATED** badge on each card. `GET /api/vps/status` also returns `hostVirt`, and when it is `lxc` the runtime warning adds a note that nested containers cannot be created on this host.
- The INSTALL NOW banner is keyed off the *real* runtime (`available`), not `canProvision`, so it stays visible in simulation mode.

### 5. Verified end to end
- Created a test VPS through the API (`test-check-01`, Ubuntu 24.04, 2 vCPU / 4 GB / 25 GB, Docker + all-devices on): listed as `RUNNING` at `10.77.0.75`, then `stop` → `STOPPED`, `start` → `RUNNING`, `restart` → `RUNNING`, and a duplicate name was rejected with `409`.

## Button polish & clearer runtime error

### 1. Global button polish (`src/index.css`)
- Added a **components-layer** block that gives every button in the panel the same behaviour: pointer/`not-allowed` cursors, a themed `:focus-visible` ring (`rgba(var(--theme-rgb-500), .55)`), smooth transitions, and icons that never squash (an icon without an explicit size defaults to `1rem`).
- It lives in `@layer components`, which Tailwind orders **before** `@layer utilities`, so any per-button utility (size, font, colour, ring) still wins. Verified in the built CSS: `@layer components{` at byte 27325 vs `@layer utilities` at 28838.
- Defined the previously **missing** `--btn-primary` / `.btn-outline` / `.btn-ghost` / `.btn-danger` utilities (they were referenced in `ServerList` but never defined). They now supply the display face, uppercase tracking, icon sizing, hover lift and disabled opacity.

### 2. Icons on buttons that lacked them
- `AdminServers`: Cancel (`X`), Save Changes (`Save`), Apply (`Check`), Yes-Delete (`Trash2`) — previously plain text buttons with ad-hoc colours.
- `AdminSettingsPage`: Save Firebase Credentials (`Save`), Test Connection (`Zap`), panel-name Save (`Save`).
- `Nodes`: "Save Node Configuration" (`Save`), and the "Add Wings Node" action moved to the display face with a rotating `Plus`.
- `ServerList`: delete-dialog Cancel (`X`), Delete permanently now uses `.btn-danger`.

### 3. Runtime error copy
- The VPS warning now reads as a headline + instruction instead of a paragraph: **"LXC NOT FOUND ON NODES"**, the driver detail, then **"CLICK THE BUTTON BELOW TO INSTALL"** with the INSTALL NOW button directly beneath. Applied on both `/vps` and `/vps/deploy`.

## Virtual Private Servers (LXC)

### 1. VPS category now has buttons
- The **VIRTUAL PRIVATE SERVERS** category gained **VPS SERVERS** (`/vps`) and **DEPLOY VPS** (`/vps/deploy`), both admin/owner only. The old placeholder scaffold page was removed.
- Sidebar active-state matching was fixed at the same time: it now picks the single best match (exact path first, then the longest prefix), so `/vps/deploy` no longer also highlights `/vps` — and `/servers/create` no longer also highlights `/servers`.

### 2. Container driver (`src/server/services/lxc.ts`)
- Supports **two runtimes**, dispatched per operation:
  - **LXD** (the snap): `lxc launch/list/start/stop/restart/delete`, candidate parsed from `lxc list --format json` (state, PID, IPv4/IPv6, memory, CPU). This is what the panel's INSTALL NOW button sets up.
  - **classic LXC** (Ubuntu's `lxc` package): `lxc-create -t download` with cgroup v2/v1 memory + CPU limits appended to the container config, plus `lxc-info` parsing.
- Binary lookup checks `/snap/bin` explicitly, since snap-installed tools are not always on the panel process's PATH.
- `detectLxc()` probes both (cached 15s) and, when neither is present, returns an actionable reason instead of a raw spawn error.
- Disk size is tracked by the panel; it is only enforced with classic LXC when `IVM_LXC_STORAGE=loop` is set (a directory rootfs has no quota, and LXD's `-d root,size=` fails on the dir pool `lxd init --auto` creates).

### 2b. One-click LXD install (`POST /api/vps/install`)
- Adds an **INSTALL NOW** button (amber alert icon) beside the "runtime unavailable" warning on both VPS pages. It runs `apt-get update && apt-get upgrade -y && apt-get install -y snapd && snap install lxd && lxd init --auto` detached, logging to `/tmp/ivm-lxd-install.log`.
- `GET /api/vps/install-status` reports progress (running flag, exit code, log tail, and whether the driver is now ready), and the button polls it every 4s with a collapsible log.
- **`snap` was corrected to `snapd`:** on Ubuntu `apt-get install -y snap` installs a package that provides no `snap` binary (`snap` was already present at version `2013-11-29-11`), so the requested sequence would have failed at that step. `snapd` is the real prerequisite, and `lxd` is not in apt at all, so the snap path is required.

### 3. API (`src/server/routes/vps.ts`, mounted at `/api/vps`)
- All routes require admin/owner. `GET /status` (driver availability + image catalog), `GET /` (stored records joined with live container state), `POST /` (create), `POST /:id/start|stop|restart`, `DELETE /:id`.
- Records persist in `.data/vps.json`. When LXC is unavailable the API answers `503` with `code: "LXC_UNAVAILABLE"` and the reason; a delete of an already-gone container still clears the record.

### 4. UI
- `src/pages/VpsServers.tsx`: cards per VPS with status badge, template, vCPU / RAM / disk / address, and Start / Stop / Restart / Delete actions (delete is confirmed). Shows a banner when the runtime is unavailable.
- `src/pages/DeployVps.tsx`: rebuilt to match the **game host creation** view (`deploy-theme` from `CreateServer.tsx` — black surfaces, grid/scanline/noise overlays, corner brackets, stepper `dot`/`conn-fill`, `inp` / `sel-card` / `btn-white` / `btn-ghost`). Five steps: IDENTITY, IMAGE, RESOURCES, DEVICES, REVIEW, with a live preview of the derived LXC container name and a review table before deploy.
- `src/components/VpsInstallButton.tsx`: the shared INSTALL NOW control (alert icon, spinner while installing, collapsible log, auto-retry on failure).

### 5. Device access toggles at deploy time
- The wizard's **DEVICES** step adds two switch toggles (both off by default, with a warning that device access widens the attack surface):
  - **ENABLE KVM** — exposes `/dev/kvm` for nested virtualisation.
  - **ENABLE ALL DEVICES (NO KVM)** — full device access for container-in-container workloads: Docker, containerd, FUSE and the syscall interception Docker needs.
- **LXD**: nesting is passed at launch (`-c security.nesting=true`) so no restart is required; the “all devices” toggle also sets `security.syscalls.intercept.mknod/setxattr`, and `/dev/fuse` + `/dev/kvm` are attached with `lxc config device add … unix-char` (hot-pluggable).
- **Classic LXC**: the equivalents are appended to the container config before start — `lxc.apparmor.profile = unconfined`, cleared `lxc.cap.drop`, cgroup2 device allows for fuse (`c 10:229`) and kvm (`c 10:232`), and bind mounts for the two device nodes.
- Host capability is part of `GET /api/vps/status` (`hostKvm`, `hostFuse`). The KVM toggle is disabled with an "UNAVAILABLE — THIS HOST HAS NO /dev/kvm" note when the device is missing, and `POST /api/vps` returns `400` if `enableKvm` is requested on a host without it. Both flags are stored on the VPS record and shown as KVM / ALL DEVICES badges on the VPS Servers cards.

### 6. Button polish
- **Deploy VPS** now uses the display face (Chakra Petch) in uppercase with wider tracking, a `Rocket` icon that lifts on hover, a themed glow shadow and a focus ring.
- **INSTALL NOW** uses mono uppercase bold tracking, a slightly larger `AlertTriangle` icon, and an amber-tinged surface with a soft shadow that brightens on hover. The dark variant (deploy wizard) inverts to a solid white fill on hover. The SHOW/HIDE LOG toggle was restyled to match.

## Sidebar categories

### 1. MANAGEMENT and SERVERS categories
- The sidebar is now organised into categories, each with its own uppercase heading: **MANAGEMENT**, **SERVERS**, **ACCOUNT**, **VIRTUAL PRIVATE SERVERS**.
- **MANAGEMENT** (new) collects **Overview**, **Nodes**, **Fleet**, **API Keys** and **Admin Settings**. Overview is visible to everyone; the other four are admin/owner only. It replaces the old catch-all "Menu" label and the separate "Admin" group.
- **SERVERS** holds the **SERVERS** and **DEPLOY** buttons, grouped together instead of Deploy sitting in the admin block.
- Admin-only **VIRTUAL PRIVATE SERVERS** is hidden from regular users, and Deploy stays admin-only inside SERVERS.
- Empty categories keep their heading with a muted hint (VPS shows "No services yet"). In collapsed mode the headings are replaced by hairline dividers between the groups.

## Virtual Private Servers category

### 1. New admin sidebar category (not a nav button)
- The sidebar now renders a **VIRTUAL PRIVATE SERVERS** category heading for admins/owners, below the regular menu items. It is a section label only — there is deliberately no clickable nav button on it yet, because the per-service buttons will be added under this heading later.
- While empty it shows a muted "No services yet" line; collapsed mode shows a hairline divider instead of the label. No new route is exposed from the sidebar.

### 2. Placeholder page (`src/pages/VirtualPrivateServers.tsx`)
- Scaffold landing page for the category's future buttons. It is still routed at `/vps` behind `AdminRoute` but is intentionally not linked from the sidebar yet; it states that no hypervisor is wired up, shows a disabled `New VPS` action and an empty state, and lists the planned capabilities (OS templates, dedicated vCPU/RAM, block storage, public IPv4/rDNS, SSH console, lifecycle controls).

## Node Naming, Server Deletion & Admin Console Styling

### 1. Local node can be renamed
- The built-in node's card now has an inline rename control (pencil) for admins/owners: click to edit, Enter/Save to commit, Escape to cancel, with a 60-character limit and inline error text.
- New `PUT /api/nodes/local` endpoint (admin/owner only) persists the name to `settings.json` as `localNodeName`; `GET /api/nodes` falls back to `Built-in Node (Local)` when unset. Only the display name is editable — the node still runs on the panel host.

### 2. Server deletion from the server list
- Each server card in `ServerList` now shows a red (destructive) Delete button with the `Trash2` icon, rendered only for admins/owners and only when deletion is permitted. It opens a confirmation dialog; `DELETE /api/servers/:id` still enforces admin/owner server-side.

### 3. Admin console styling (black + white outlines)
- The admin settings console uses a `.admin-convoy` scope: pure black background with hairline white borders on cards, inputs and buttons (hover brightens to full white), over the single blue accent palette.

## Admin UX, Avatars & Host Networking

### 1. Admin Settings: one pane per tab
- The page used to stack Branding, Features, Runtime, Appearance, Authentication, Users and System in one long scroll, and the sidebar buttons scrolled to a section instead of switching content.
- Panes now render one at a time: the wrapper carries `data-active-tab` and `.admin-panes` in `index.css` reveals only the matching pane. The IntersectionObserver that tracked scroll position was removed, and selecting a tab resets the scroll to the top (mobile drawer still closes).

### 2. User avatar
- New `src/components/UserAvatar.tsx`: renders the account picture when one exists (Google sign-in), otherwise a neutral human glyph instead of the username's first letter. Wired into the sidebar user card.

### 3. Login screen
- Removed the duplicated small brand text: the card's small "<panel name> Login" title and the "Welcome to the panel" subtitle, plus the small "PANEL" line under the giant backdrop title. The panel name now appears once, large, as the backdrop; the card keeps an `sr-only` heading for screen readers.

### 4. Deploy wizard: disk in GB
- The Disk Limit control in the deploy wizard is now an explicit GB control: 10 / 25 / 50 / 100 GB presets, a numeric box with a `GB` suffix, and clamping to 1–500 GB on blur. Stored and displayed in GB (matching `server.disk` and the server list).

### 5. Python & Node.js logos
- Bundled the official marks as `public/icons/nodejs.svg` and `public/icons/python.svg` (devicon originals).
- Used in the deploy wizard's application runtime cards (with the previous lucide glyph as fallback) and in the server settings runtime header for standalone Node.js/Python servers.

### 6. Local node public IPv4
- New `src/server/services/publicIp.ts` resolves the host's public IPv4 through ipify → icanhazip → ifconfig.me, validates it as IPv4, caches it for 10 minutes and keeps serving the last known address if every lookup fails.
- Exposed as `GET /api/system/public-ip` (auth required, `?refresh=true` bypasses the cache) and shown on the built-in local node card with copy-to-clipboard and a refresh button.

## Branding: Panel Logo & Single Blue Theme

### 1. Panel Logo
- Added the IVM logo artwork as `public/ivm-logo.png` (512×512): the supplied 1280×853 image downscaled and centred on a square canvas filled with its own border colour, so nothing is cropped in the square logo slots.
- `GET /api/settings` now returns `/ivm-logo.png` when `settings.json` has no `panelLogo` key, so fresh installs are branded out of the box. An explicit empty value still means "no logo", keeping the admin Remove action working.
- Logo sizing tuned per surface: header `h-8 w-8` rounded with a themed glow, register card `h-12 w-12`, login card logo added above the title (`.login-logo`), and a brand mark added to the sidebar header. The favicon falls back to the bundled logo instead of the missing `/vite.svg`.

### 2. Single Blue Accent Theme
- Removed the accent-colour theme selector from Admin Settings (and the orphaned theme state in the Account page); the `data-theme` attribute, `theme` context value, and the `theme` field in the settings API (GET and PUT) are gone.
- `src/index.css` now defines one `:root` palette only (red/blue/orange/white/green blocks deleted): sky blue highlights (`#0ea5e9` / `#0284c7`) over deep blue shadows (`#0c4a6e` / `#082f49`).

## Rebrand, Node Permissions & River Login Scene

### 1. Node Management Permissions
- **Nodes page (`src/pages/Nodes.tsx`)**: the "Add Wings Node" button and its modal now render only for `admin`/`owner`, and `handleAddNode` refuses to submit for anyone else. Previously every signed-in user could open the page and the node form, even though `POST /api/nodes` already answered 403.
- **Route guard (`src/App.tsx`)**: added an `AdminRoute` wrapper (redirects non-admins to `/`) and applied it to `/nodes`, `/servers/create`, `/admin/settings`, `/api-keys` and `/admin/servers` so admin-only screens can no longer be reached by URL.
- **Sidebar (`src/components/Sidebar.tsx`)**: "Nodes" moved into the admin/owner link block.

### 2. Login Scene: Desert → River / Beach
- Added `public/river/` (replacing `public/desert/`) with the parallax layers recoloured from the pink/purple desert palette to a sunset-over-water palette (sand, teal and sky tones).
- Added a new `img-water.svg` layer drawn in front of the foreground: fine→coarse ripples for depth, shoreline surf lines, a sun glitter trail and a depth vignette.
- `Login.tsx` / `Login.css`: renamed `.desert-wrapper` → `.river-wrapper`, repointed every layer to `/river/*.svg`, retuned the GSAP intro backdrop, and added a slow `waterDrift` animation plus horizontal parallax for the water layer.

### 3. Rebrand: JTG Panel → IVM Panel
- User-visible branding renamed everywhere: page title, sidebar label, page header (`IVM.CORE`), default panel name, installer/uninstaller banners (including the block-letter ASCII art), User-Agent strings, generated server files/motd and log prefixes.
- Internal identifiers renamed: `ivm-panel-super-secret` as the default JWT secret, `ivm-`/`ivm_` API key prefixes, `ivm_token` / `ivm_notifications` / `ivm_simulate_dev_panel` storage keys, `IVM_OWNER_USER` / `IVM_OWNER_PASS` / `IVM_OWNER_EMAIL` / `IVM_HOST_DATA_PATH` env vars, and `ivm-main` / `ivm-admin` / `ivm-panel` / `ivm-server-*` / `ivm-node` process, container and pm2 names.
- `install.sh`, `uninstall.sh` and `update.sh` regenerated from `works/tools/generate_scripts.py`.
- Kept the upstream clone URL (`github.com/JishnuTheGamer/Jtg`) working and added legacy `Jtg`/`jtg` directory detection to `install.sh`, `uninstall.sh` and the installer generator so existing installs still update and uninstall cleanly. Existing JWT sessions and `jtg-` API keys are invalidated by the secret/prefix change.

### 4. Authentication & Role Fixes
- **Login identifier (`src/server/controllers/auth.ts`)**: usernames are now trimmed and compared case-insensitively, the account email is accepted as a login identifier, and accounts without a password hash return 401 instead of throwing.
- **Role source of truth (`src/server/middleware/auth.ts`)**: `requireAuth`/`requireAdmin` read the role from `users.json` instead of the JWT, so promotions and demotions take effect immediately and `/api/auth/me` no longer reports a stale role.
- **Owner provisioning (`scripts/createuser.ts`)**: supports CLI flags (`username … password … mail|email …`) alongside the interactive prompts and the `IVM_OWNER_*` env vars.

## v3.0.0 Release (Master Production Update)
- **Version Upgrade to v3.0.0**:
  - Full project upgrade across `package.json`, `update.sh`, `generate_scripts.py`, backend routes (`/api/health`, `/api/settings`, `/api/system/version`), and frontend dashboards.
- **Docker Container Runtime & Lifecycle Hardening**:
  - Solved `ECONNREFUSED` / `EACCES` socket connection errors with active socket self-repair and permissions handling.
  - Eliminated premature Sandbox fallback on Linux systems when the Docker daemon is accessible.
  - Refactored container creation, start, stop, kill, restart, status, stats, and logs methods in `src/server/services/docker.ts` to seamlessly handle both real Docker containers and local simulation fallbacks.
  - Added host data directory path resolution (`resolveHostDataDir`) for Docker-in-Docker / volume mapping on production hosts.
- **Uninstaller & Cleanup Enhancements**:
  - Added comprehensive `delete_ivm_directory` routine in `uninstall.sh` and `generate_scripts.py` to recursively and cleanly remove the `Ivm` working directory upon panel uninstallation.
- **System Update Automation**:
  - Updated `update.sh` with seamless v3.0.0 migration logic and pre-update status validation.

## Session Changes & Master Stability Audit

### 1. Role Hierarchy & Authorization Fixes
- **Frontend API Keys Access (`src/pages/ApiKeysPage.tsx`)**:
  - Fixed permission gate from `user?.role !== "admin"` to `user?.role !== "admin" && user?.role !== "owner"`.
  - Owners now have full access to view, create, and revoke API keys.
- **Frontend User Management in Account Page (`src/pages/AccountPage.tsx`)**:
  - Fixed `fetchUsers` condition from `if (user.role !== "admin")` to `if (user.role !== "admin" && user.role !== "owner")`.
  - Updated default admin account checks from username-based comparison (`user.username === "admin"`) to immutable ID check (`user.id === "temp-admin"`), ensuring owners named "admin" are not blocked from updating their passwords.
- **Admin Controls Component (`src/components/AdminControls.tsx`)**:
  - Added visual Owner badge with gold shield (`Shield` icon with `text-amber-500`).
  - Allowed Owners to manage roles, reset passwords, and delete users regardless of their username (protecting only the fallback `temp-admin` ID).
  - Maintained strict RBAC: Admins cannot change roles or delete other admins or the owner.
- **Admin Settings Page (`src/pages/AdminSettingsPage.tsx`)**:
  - Explicitly grouped access condition `!user || (user.role !== "admin" && user.role !== "owner")`.
- **Sub-users & SFTP Route Authorization (`src/server/routes/servers.ts`)**:
  - Added authorization guards across subuser endpoints (`GET`, `POST`, `DELETE`) and SFTP endpoints (`GET`, `POST /create`, `POST /reset-password`, `DELETE`).
  - Ensured Owners and Admins have administrative oversight on all server subusers and SFTP configurations, while normal users can only manage their own servers.
- **Plugin & Mod Installation Endpoints (`src/server/controllers/servers.ts`)**:
  - Added server ownership checks on `installPlugin` and `installMod` allowing Owners and Admins to manage any server, and regular users only their assigned servers.
- **Initial Dev Login Role Assignment (`src/server/controllers/auth.ts`)**:
  - Updated auto-creation logic in dev mode to assign `role: "owner"` to the initial user if no owner exists in `users.json`, ensuring immediate administrative authority.
  - Promoted existing single dev user in `.data/users.json` to `"owner"`.

### 2. Works System Implementation
- Created `/works/README.md` with complete architectural documentation, port usage rules, role hierarchy matrix, runtime switching guard, and installer instructions.
- Created `/works/CHANGELOG.md` tracking all changes.
- Added comprehensive verification test suite in `/works/tests/`:
  - `owner_permissions.test.ts`
  - `admin_permissions.test.ts`
  - `user_permissions.test.ts`
  - `runtime_management.test.ts`
  - `port_isolation.test.ts`
