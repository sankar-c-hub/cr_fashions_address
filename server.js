const express = require("express");
const PDFDocument = require("pdfkit");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Load .env file if present (for local development)
try { require("dotenv").config(); } catch(e) {}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── GITHUB STORAGE ───────────────────────────────────────────────────────────
// Set these as environment variables (Render dashboard → Environment):
//
//   GITHUB_TOKEN  = ghp_xxxxxxxxxxxxxxxxxxxx   ← Personal Access Token (repo scope)
//   GITHUB_OWNER  = your-github-username
//   GITHUB_REPO   = cr-fashions-data           ← a private repo you create
//   GITHUB_FILE   = orders.json                ← file path inside that repo
//
const GH_TOKEN = "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";
const GH_OWNER = "sankar-c-hub";
const GH_REPO  = "cr-fashions-data";
const GH_FILE  = "data/orders.json";
const GH_API   = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;

function ghHeaders() {
  return {
    Authorization: `token ${GH_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "cr-fashions-app",
  };
}

// Read orders from GitHub → returns { orders[], sha }
async function readOrders() {
  try {
    const res = await fetch(GH_API, { headers: ghHeaders() });
    if (res.status === 404) return { orders: [], sha: null }; // file doesn't exist yet
    if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
    const data    = await res.json();
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return { orders: JSON.parse(content) || [], sha: data.sha };
  } catch (e) {
    console.error("readOrders error:", e.message);
    return { orders: [], sha: null };
  }
}

// Write orders to GitHub (creates file if new, updates if existing)
async function writeOrders(orders, sha) {
  const content = Buffer.from(JSON.stringify(orders, null, 2)).toString("base64");
  const body = {
    message: `update orders — ${new Date().toISOString()}`,
    content,
    ...(sha ? { sha } : {}), // sha required for updates, omitted for first create
  };
  const res = await fetch(GH_API, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub write failed: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return data.content.sha; // return new sha for next write
}

// ─── ADMIN AUTH ───────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "crfashions@2026";
const activeSessions = new Set();

function generateToken() { return crypto.randomBytes(32).toString("hex"); }

function isAdmin(req) {
  const token = req.headers["x-admin-token"] || req.query.adminToken;
  return token && activeSessions.has(token);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req))
    return res.status(403).json({ error: "Unauthorized. Admin access required." });
  next();
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DEFAULT_FROM_NAME  = "CR FASHIONS";
const DEFAULT_FROM_PHONE = "7032208265";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getTodayStr() {
  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, "0");
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

function getTimeStr() {
  return new Date().toLocaleTimeString("en-IN", { hour12: true });
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateToken();
    activeSessions.add(token);
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: "Incorrect password" });
});

app.post("/admin/logout", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token) activeSessions.delete(token);
  res.json({ success: true });
});

app.get("/admin/verify", (req, res) => {
  res.json({ admin: isAdmin(req) });
});

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Submit order → saved to GitHub
app.post("/submit_order", async (req, res) => {
  try {
    const { toName, toAddress, fromName, fromPhone } = req.body;
    if (!toName || !toAddress)
      return res.status(400).json({ error: "Name and address are required" });

    const { orders, sha } = await readOrders();
    const id      = orders.length + 1;
    const dateStr = getTodayStr();
    const timeStr = getTimeStr();

    orders.push({
      id,
      toName,
      toAddress,
      fromName:  fromName  || DEFAULT_FROM_NAME,
      fromPhone: fromPhone || DEFAULT_FROM_PHONE,
      date: dateStr,
      time: timeStr,
    });

    await writeOrders(orders, sha);
    res.json({ success: true, id, dateStr, timeStr });
  } catch (err) {
    console.error("submit_order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN-ONLY ROUTES ────────────────────────────────────────────────────────

// Get orders — optionally filtered by date (MM-DD-YYYY)
app.get("/get_orders", requireAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    const { orders } = await readOrders();
    const filtered = date ? orders.filter((o) => o.date === date) : orders;
    res.json(filtered);
  } catch (err) {
    console.error("get_orders error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Download all orders as JSON
app.get("/download_json", requireAdmin, async (req, res) => {
  try {
    const { orders } = await readOrders();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=CR_Fashions_Orders.json");
    res.send(JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error("download_json error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload JSON → append all to GitHub
app.post("/upload_json", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const incoming = JSON.parse(req.file.buffer.toString("utf8"));
    if (!Array.isArray(incoming))
      return res.status(400).json({ error: "JSON must be an array of orders" });

    const { orders: existing, sha } = await readOrders();
    const merged = [...existing, ...incoming].map((o, i) => ({ ...o, id: i + 1 }));
    await writeOrders(merged, sha);

    res.json({ success: true, added: incoming.length, total: merged.length });
  } catch (err) {
    console.error("upload_json error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate PDF shipping labels by date (MM-DD-YYYY)
app.get("/generate_labels", requireAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date parameter required" });

    const { orders } = await readOrders();
    const filtered   = orders.filter((o) => o.date === date);

    if (filtered.length === 0)
      return res.status(404).json({ message: `No orders found for ${date}` });

    const doc = new PDFDocument({ size: "A4", margin: 30 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=shipping_labels_${date}.pdf`);
    doc.pipe(res);

    const PAGE_HEIGHT = 841;
    const MARGIN      = 30;
    const COL_WIDTH   = 270;
    const GAP         = 12;
    const TEXT_WIDTH  = 260 - 12 * 2;
    const LINE_GAP    = 3;

    function measureLabelHeight(order) {
      doc.font("Helvetica").fontSize(11);
      const address   = (order.toAddress || "").replace(/\s*\n\s*/g, ", ").replace(/,\s*,/g, ",").trim();
      const nameH     = doc.heightOfString(`Name: ${order.toName || ""}`,   { width: TEXT_WIDTH, lineGap: LINE_GAP });
      const addrLblH  = doc.heightOfString("Address:",                       { width: TEXT_WIDTH, lineGap: LINE_GAP });
      const addrH     = doc.heightOfString(address,                          { width: TEXT_WIDTH, lineGap: LINE_GAP });
      const fromNameH = doc.heightOfString(`Name: ${order.fromName || ""}`,  { width: TEXT_WIDTH, lineGap: LINE_GAP });
      const phoneH    = doc.heightOfString(`Phone: ${order.fromPhone || ""}`,{ width: TEXT_WIDTH, lineGap: LINE_GAP });
      const unboxH    = doc.heightOfString("UNBOX VIDEO IS MANDATORY",       { width: TEXT_WIDTH, lineGap: LINE_GAP });
      return 10 + 16 + 6 + nameH + 6 + addrLblH + 4 + addrH + 12 + 16 + 6 + fromNameH + 6 + phoneH + 8 + unboxH + 14;
    }

    const rows = [];
    for (let i = 0; i < filtered.length; i += 2) rows.push(filtered.slice(i, i + 2));

    let rowY = MARGIN;
    rows.forEach((pair) => {
      const rowHeight = Math.max(...pair.map(measureLabelHeight));
      if (rowY + rowHeight > PAGE_HEIGHT - MARGIN) { doc.addPage(); rowY = MARGIN; }
      pair.forEach((order, colIndex) => {
        drawLabel(doc, MARGIN + colIndex * COL_WIDTH, rowY, {
          toName:    order.toName    || "",
          toAddress: order.toAddress || "",
          fromName:  order.fromName  || DEFAULT_FROM_NAME,
          fromPhone: order.fromPhone || DEFAULT_FROM_PHONE,
        });
      });
      rowY += rowHeight + GAP;
    });

    doc.end();
  } catch (err) {
    console.error("generate_labels error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate PDF label for a single order by id
app.get("/generate_label_single", requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id parameter required" });

    const { orders } = await readOrders();
    const order = orders.find((o) => String(o.id) === String(id));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const doc = new PDFDocument({ size: [300, 400], margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=label_${id}.pdf`);
    doc.pipe(res);

    drawLabel(doc, 20, 20, {
      toName:    order.toName    || "",
      toAddress: order.toAddress || "",
      fromName:  order.fromName  || DEFAULT_FROM_NAME,
      fromPhone: order.fromPhone || DEFAULT_FROM_PHONE,
    });

    doc.end();
  } catch (err) {
    console.error("generate_label_single error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PDF DRAWING ──────────────────────────────────────────────────────────────
function drawLabel(doc, x, y, label) {
  const width     = 260;
  const padding   = 12;
  const textWidth = width - padding * 2;
  const fontSize  = 11;
  const lineGap   = 3;

  doc.font("Helvetica").fontSize(fontSize);

  const address = (label.toAddress || "").replace(/\s*\n\s*/g, ", ").replace(/,\s*,/g, ",").trim();

  const nameHeight    = doc.heightOfString(`Name: ${label.toName}`,    { width: textWidth, lineGap });
  const addrLblHeight = doc.heightOfString("Address:",                  { width: textWidth, lineGap });
  const addrHeight    = doc.heightOfString(address,                     { width: textWidth, lineGap });
  const fromNameH     = doc.heightOfString(`Name: ${label.fromName}`,  { width: textWidth, lineGap });
  const phoneH        = doc.heightOfString(`Phone: ${label.fromPhone}`,{ width: textWidth, lineGap });
  const unboxH        = doc.heightOfString("UNBOX VIDEO IS MANDATORY", { width: textWidth, lineGap });

  const totalHeight =
    10 + 16 + 6 +
    nameHeight + 6 +
    addrLblHeight + 4 +
    addrHeight + 12 +
    16 + 6 +
    fromNameH + 6 +
    phoneH + 8 +
    unboxH + 14;

  doc.rect(x, y, width, totalHeight).stroke();
  let cy = y + 10;

  doc.font("Helvetica-Bold").fontSize(12).text("TO:", x + padding, cy, { underline: true });
  cy += 16 + 6;

  doc.font("Helvetica-Bold").text("Name: ", x + padding, cy, { continued: true, lineGap });
  doc.font("Helvetica").text(label.toName, { lineGap });
  cy += nameHeight + 6;

  doc.font("Helvetica-Bold").text("Address:", x + padding, cy, { width: textWidth, lineGap });
  cy += addrLblHeight + 4;

  doc.font("Helvetica").text(address, x + padding, cy, { width: textWidth, lineGap });
  cy += addrHeight + 12;

  doc.font("Helvetica-Bold").fontSize(12).text("FROM:", x + padding, cy, { underline: true });
  cy += 16 + 6;

  doc.font("Helvetica-Bold").text("Name: ", x + padding, cy, { continued: true, lineGap });
  doc.font("Helvetica").text(label.fromName, { lineGap });
  cy += fromNameH + 6;

  doc.font("Helvetica-Bold").text("Phone: ", x + padding, cy, { continued: true, lineGap });
  doc.font("Helvetica").text(label.fromPhone, { lineGap });
  cy += phoneH + 8;

  doc.font("Helvetica-Bold").fontSize(15)
    .text("UNBOX VIDEO IS MANDATORY", x + padding, cy, { width: textWidth, align: "center", lineGap });
}

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

async function initGitHubFile() {
  try {
    const res = await fetch(GH_API, { headers: ghHeaders() });
    if (res.status === 404) {
      // File doesn't exist — create empty one
      console.log("📁 orders.json not found — creating in GitHub...");
      await writeOrders([], null);
      console.log("✅ orders.json created in GitHub.");
    } else if (res.ok) {
      // File exists — just confirm token works
      const data = await res.json();
      console.log(`✅ GitHub connected. orders.json found (sha: ${data.sha.slice(0,7)})`);
    } else {
      const body = await res.text();
      console.error("⚠️  GitHub check failed:", res.status, body);
      if (res.status === 401) console.error("❌ Token is invalid or expired — check GITHUB_TOKEN in Render env vars.");
      if (res.status === 404) console.error("❌ Repo/file not found — check GH_OWNER, GH_REPO, GH_FILE values.");
    }
  } catch (e) {
    console.error("⚠️  GitHub init error:", e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`✅ CR Fashions running on port ${PORT}`);
  console.log(`📦 GitHub storage: ${GH_OWNER}/${GH_REPO}/${GH_FILE}`);
  await initGitHubFile();
});
