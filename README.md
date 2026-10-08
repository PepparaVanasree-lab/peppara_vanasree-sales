# 🌿 Peppara Vanasree Eco Shop — Inventory & Sales Management System

An offline-first web application built for **Peppara Eco Tourism EDC (Vanasree Eco Shop)** to manage daily billing, inventory stock, purchases, returns, cashbook remittances, and official A4 register printing.

---

## ✨ Key Features

- **Offline-First Architecture:** Works seamlessly even without an internet connection using **IndexedDB** (`vanasree_pending_db_v1`) with an automatic `localStorage` fallback. All pending operations automatically sync when the internet returns.
- **Zero-Drift Deterministic Stock:** Live stock is always calculated deterministically (`baseStock + pendingDelta`), with pre-write queue deletion and automatic rollback on failure to prevent race conditions or double-subtraction.
- **Smart Billing & Auto-Merge:**
  - Automatically merges same-day, same-item sales into a single bill row.
  - Supports in-place **Edit** and **Delete** of bills with automatic stock and cashbook adjustments.
- **Inventory & Price-Variant Management:**
  - Pre-loaded with 189 Vanasree items for 1-click bulk import.
  - Searchable modal for **Add Purchase** and **Return Stock**.
  - Automatically creates a price-variant item (`Item Name (₹NewMRP)`) when new stock arrives at a different MRP, keeping old stock intact.
- **Automated Cash Book:**
  - Exact daily income recalculation (`DailySales`) paired with bank remittance tracking (`Remittances`).
  - Automatic monthly opening and closing balance carry-forward (`Balances`).
- **Official Print & PDF Engine:**
  - **Cash Book:** Auto-fitted to a single **A4 Portrait** page.
  - **Monthly Stock-cum-Sales Register:** Auto-fitted width for **A4 Landscape** with dynamic calendar days (28/29/30/31 days) and historical stock reconstruction.

---

## 🗂️ Project Structure & Script Load Order

```text
├── index.html      # Main UI layout (Login, Sales, Inventory, Cashbook, Print Preview)
├── style.css       # Responsive styling & print media rules
├── data.js         # Master list of 189 Vanasree items (BULK_DATA)
├── app.js          # Firebase init, SHA-256 auth, IndexedDB queue & atomic sync engine
├── inventory.js    # Inventory CRUD, bulk import, purchase/return modal & MRP variants
├── sales.js        # Billing, auto-merge, edit/delete sales flows
├── cashbook.js     # Monthly cashbook, remittances & abstract balance calculation
└── pdf.js          # A4 Portrait (Cashbook) & A4 Landscape (Monthly Register) print engine