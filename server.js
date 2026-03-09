const express = require("express");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── ADMIN AUTH CONFIG ────────────────────────────────────────────────────────
const ADMIN_PASSWORD = "crfashions@2026"; // 🔐 Change this to your own password
const activeSessions = new Set();         // In-memory session tokens

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}
function isAdmin(req) {
  const token = req.headers["x-admin-token"] || req.query.adminToken;
  return token && activeSessions.has(token);
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Unauthorized. Admin access required." });
  }
  next();
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DEFAULT_FROM_NAME  = "CR FASHIONS";
const DEFAULT_FROM_PHONE = "7032208265";
const EXCEL_FILE = path.join(__dirname, "data", "orders.xlsx");

if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getOrCreateWorkbook() {
  if (fs.existsSync(EXCEL_FILE)) return XLSX.readFile(EXCEL_FILE);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["S.No", "To Name", "Address", "From", "Phone", "Date", "Time"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  XLSX.writeFile(wb, EXCEL_FILE);
  return wb;
}

function saveOrderToExcel(order) {
  const wb = getOrCreateWorkbook();
  const ws = wb.Sheets["Orders"];
  const existingData = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const sNo = existingData.length;

  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, "0");
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const dateStr = `${mm}-${dd}-${yyyy}`;
  const timeStr = now.toLocaleTimeString("en-IN", { hour12: true });

  XLSX.utils.sheet_add_aoa(ws, [[
    sNo,
    order.toName,
    order.toAddress,
    order.fromName  || DEFAULT_FROM_NAME,
    order.fromPhone || DEFAULT_FROM_PHONE,
    dateStr,
    timeStr,
  ]], { origin: -1 });

  XLSX.writeFile(wb, EXCEL_FILE);
  return { sNo, dateStr, timeStr };
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

// Anyone can submit an order
app.post("/submit_order", (req, res) => {
  try {
    const { toName, toAddress, fromName, fromPhone } = req.body;
    if (!toName || !toAddress)
      return res.status(400).json({ error: "Name and address are required" });
    const result = saveOrderToExcel({ toName, toAddress, fromName, fromPhone });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN-ONLY ROUTES ────────────────────────────────────────────────────────
app.get("/get_orders", requireAdmin, (req, res) => {
  try {
    const selectedDate = req.query.date;
    if (!fs.existsSync(EXCEL_FILE)) return res.json([]);

    const wb   = XLSX.readFile(EXCEL_FILE);
    const ws   = wb.Sheets["Orders"];
    const rows = XLSX.utils.sheet_to_json(ws);

    const filtered = selectedDate
      ? rows.filter((r) => r["Date"] === selectedDate)
      : rows;

    res.json(filtered.map((r) => ({
      toName:    r["To Name"],
      toAddress: r["Address"],
      fromName:  r["From"],
      fromPhone: r["Phone"],
      date:      r["Date"],
      time:      r["Time"],
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/download_excel", requireAdmin, (req, res) => {
  if (!fs.existsSync(EXCEL_FILE))
    return res.status(404).json({ error: "No data yet" });
  res.download(EXCEL_FILE, "CR_Fashions_Orders.xlsx");
});

app.get("/generate_labels", requireAdmin, async (req, res) => {
  try {
    const selectedDate = req.query.date;
    if (!selectedDate)
      return res.status(400).json({ error: "Date parameter required" });
    if (!fs.existsSync(EXCEL_FILE))
      return res.status(404).json({ error: "No orders found" });

    const wb   = XLSX.readFile(EXCEL_FILE);
    const ws   = wb.Sheets["Orders"];
    const rows = XLSX.utils.sheet_to_json(ws);
    const filteredOrders = rows.filter((r) => r["Date"] === selectedDate);

    if (filteredOrders.length === 0)
      return res.status(404).json({ message: `No orders found for ${selectedDate}` });

    const doc = new PDFDocument({ size: "A4", margin: 30 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=shipping_labels_${selectedDate}.pdf`);
    doc.pipe(res);

    const cols = 2;
    filteredOrders.forEach((row, index) => {
      const col = index % cols;
      const r   = Math.floor(index / cols) % 3;
      drawLabel(doc, 30 + col * 270, 30 + r * 260, {
        toName:    row["To Name"],
        toAddress: row["Address"],
        fromName:  row["From"]   || DEFAULT_FROM_NAME,
        fromPhone: row["Phone"]  || DEFAULT_FROM_PHONE,
      });
      if ((index + 1) % 6 === 0 && index + 1 < filteredOrders.length) doc.addPage();
    });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PDF DRAWING ──────────────────────────────────────────────────────────────
function drawLabel(doc, x, y, label) {
  const width = 260, height = 250;
  doc.rect(x, y, width, height).stroke();

  let cy = y + 10;
  doc.font("Helvetica-Bold").fontSize(12).text("TO:", x + 12, cy, { underline: true });
  doc.font("Helvetica"); cy += 20;
  doc.fontSize(11).text(`Name: ${label.toName || ""}`, x + 10, cy); cy += 20;
  doc.text("Address:", x + 10, cy); cy += 15;
  doc.text(label.toAddress || "", x + 10, cy, { width: width - 20 }); cy += 80;
  doc.font("Helvetica-Bold").fontSize(12).text("FROM:", x + 12, cy, { underline: true });
  doc.font("Helvetica"); cy += 20;
  doc.text(`Name: ${label.fromName || DEFAULT_FROM_NAME}`, x + 10, cy); cy += 20;
  doc.text(`Phone: ${label.fromPhone || DEFAULT_FROM_PHONE}`, x + 10, cy); cy += 25;
  doc.font("Helvetica-Bold").text("UNBOX VIDEO IS MANDATORY", x + 20, cy);
}

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ CR Fashions app running at http://localhost:${PORT}`);
});