# CR Fashions — Unified Shipping Manager

A single Express.js app combining the order submission form and the label generator.

## Project Structure

```
cr-fashions/
├── server.js          ← Unified backend (all routes)
├── package.json
├── data/
│   └── orders.xlsx    ← Auto-created on first order submission
└── public/
    └── index.html     ← Single-page frontend (both tabs)
```

## Setup & Run

```bash
npm install
npm start
# Open http://localhost:4000
```

