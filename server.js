const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const path = require("path");

const app = express();

const GOOGLE_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyWYGwb5vR4uJZIS8EOCD0sWwsaGz0_D-R0Ce9mtzhqbVh31uwzyk-2ghZ1TC1FPutI/exec";

const DEFAULT_FROM_NAME = "CR FASHIONS";
const DEFAULT_FROM_PHONE = "7032208265";

app.use(express.static("templates"));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "templates", "new_index.html"));
});

function drawLabel(doc, x, y, label) {
    const width = 260;
    const height = 250;

    const toName = label.toName || "";
    const toAddress = label.toAddress || "";
    const fromName = label.fromName || DEFAULT_FROM_NAME;
    const fromPhone = label.fromPhone || DEFAULT_FROM_PHONE;

    doc.rect(x, y, width, height).stroke();

    let cursorY = y + 10;

    // TO (Bold only this)
    doc.font("Helvetica-Bold").fontSize(12).text("TO:", x + 12, cursorY, { underline: true });

    // Reset font
    doc.font("Helvetica");
    cursorY += 20;

    doc.fontSize(11).text(`Name: ${toName}`, x + 10, cursorY);
    cursorY += 20;

    doc.text("Address:", x + 10, cursorY);
    cursorY += 15;

    doc.text(toAddress, x + 10, cursorY, { width: width - 20 });

    cursorY += 80;

    // FROM (Bold only this)
    doc.font("Helvetica-Bold").fontSize(12).text("FROM:", x + 12, cursorY, { underline: true });

    // Reset font again
    doc.font("Helvetica");
    cursorY += 20;

    doc.text(`Name: ${fromName}`, x + 10, cursorY);
    cursorY += 20;

    doc.text(`Phone: ${fromPhone}`, x + 10, cursorY);

    cursorY += 25;

    doc.font("Helvetica-Bold")
        .text("UNBOX VIDEO IS MANDATORY", x + 20, cursorY);
}

app.get("/get_orders", async (req, res) => {

    try {

        const selectedDate = req.query.date;

        const response = await axios.get(GOOGLE_SCRIPT_URL);
        const data = response.data;

        const filteredOrders = data.filter((r) => {

            if (!r.date) return false;

            const dateObj = new Date(r.date);

            const dd = String(dateObj.getDate()).padStart(2, '0');
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const yyyy = dateObj.getFullYear();

            const formattedDate = `${mm}-${dd}-${yyyy}`;

            return formattedDate === selectedDate;
        });

        res.json(filteredOrders);

    } catch (error) {

        res.status(500).json({ error: error.message });

    }

});

app.get("/generate_labels", async (req, res) => {
    try {
        const selectedDate = req.query.date;

        if (!selectedDate) {
            return res.status(400).json({ error: "Date parameter required" });
        }

        const response = await axios.get(GOOGLE_SCRIPT_URL);
        const data = response.data;

        const filteredOrders = data.filter((r) => {
            if (!r.date) return false;

            // 1. Convert the Sheet's ISO date to a local Date object
            const dateObj = new Date(r.date);

            // 2. Extract parts (Local Time)
            const dd = String(dateObj.getDate()).padStart(2, '0');      // Day (07)
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0'); // Month (03)
            const yyyy = dateObj.getFullYear();                         // Year (2026)

            // 3. Match the UI Format: DD-MM-YYYY
            const formattedDate = `${mm}-${dd}-${yyyy}`;
            return formattedDate === selectedDate;
        });
        if (filteredOrders.length === 0) {
            return res
                .status(404)
                .json({ message: `No orders found for ${selectedDate}` });
        }

        const doc = new PDFDocument({
            size: "A4",
            margin: 30
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=shipping_labels.pdf"
        );

        doc.pipe(res);

        const labelsPerPage = 6;
        const cols = 2;

        filteredOrders.forEach((label, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols) % 3;

            const x = 30 + col * 270;
            const y = 30 + row * 260;

            drawLabel(doc, x, y, label);

            if ((index + 1) % labelsPerPage === 0) {
                doc.addPage();
            }
        });

        doc.end();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 4000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});