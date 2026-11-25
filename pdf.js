// pdf.js
// =========================
// PDF Generation & Print Preview
// =========================

let _pdfStyleEl = null;
let _pdfPreviewMode = null;

function pdfEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function pdfCleanName(value) {
  return String(value ?? "").trim();
}

function pdfItemName(item) {
  return pdfCleanName(item && (item.itemName || item.name));
}

function pdfNormalizeDate(value) {
  const text = String(value ?? "").trim();
  let year;
  let month;
  let day;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    // Supports the sales date format DD/MM/YYYY and DD-MM-YYYY.
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return "";

    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return "";
  }

  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return "";
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function pdfIsAfterCutoff(dateValue, monthKey, cutoffIso) {
  const transactionDate = pdfNormalizeDate(dateValue);

  if (transactionDate) {
    return transactionDate > cutoffIso;
  }

  // For legacy purchase/return records without a day, a later month is
  // definitely after the cutoff. A missing day in the cutoff month is
  // ambiguous and is not treated as a future transaction.
  const validMonthKey = String(monthKey || "").match(/^(\d{4}-\d{2})$/);
  return Boolean(
    validMonthKey &&
    validMonthKey[1] > cutoffIso.slice(0, 7)
  );
}

function pdfDisplayDate(isoDate) {
  const parts = isoDate.split("-");
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function pdfQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function pdfFormatQuantity(value) {
  const quantity = Number(value) || 0;
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toFixed(2).replace(/\.?0+$/, "");
}

// =========================
// Print Styles
// =========================
function setPrintMode(mode) {
  _pdfPreviewMode = mode;

  if (!_pdfStyleEl) {
    _pdfStyleEl = document.createElement("style");
    _pdfStyleEl.id = "dynamicPrintStyle";
    document.head.appendChild(_pdfStyleEl);
  }

  const commonPreviewCss = `
    #printArea {
      background: #fff;
      margin: 15px auto;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.15);
      box-sizing: border-box;
      overflow-x: auto;
    }
    .preview-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #263238;
      color: #fff;
      padding: 12px 18px;
      border-radius: 6px;
      margin-bottom: 15px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .preview-toolbar button {
      width: auto;
      margin: 0;
      padding: 10px 20px;
      font-weight: bold;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-family: 'Anek Malayalam', sans-serif;
    }
    .btn-close-preview {
      background: #607D8B;
      color: white;
    }
    .btn-do-print {
      background: #4CAF50;
      color: white;
    }
    .print-wrap {
      width: 100%;
    }
    .print-table {
      width: 100%;
      border-collapse: collapse;
    }
    .print-table th,
    .print-table td {
      border: 1px solid #000;
      text-align: center;
    }
    .rotate-text {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
    }
    .fit-scale {
      transform-origin: top left;
    }

    @media print {
      #printArea {
        margin: 0;
        padding: 0;
        box-shadow: none;
        max-width: 100% !important;
        overflow: visible;
      }
      .no-print {
        display: none !important;
      }
    }
  `;

  if (mode === "cashbook") {
    _pdfStyleEl.textContent = commonPreviewCss + `
      #printArea {
        max-width: 800px;
      }
      .print-title {
        font-size: 18px;
        margin: 0 0 10px;
        text-align: center;
        color: #000;
      }
      .print-meta {
        display: flex;
        justify-content: space-between;
        margin: 4px auto 12px;
        width: 90%;
        font-size: 13px;
        font-weight: 700;
      }
      .print-table {
        font-size: 13px;
        width: 90%;
        margin: 0 auto;
      }
      .print-table th,
      .print-table td {
        padding: 8px;
      }
      .print-table th {
        background: #eee !important;
        -webkit-print-color-adjust: exact;
        color: #000;
      }

      @media print {
        @page {
          size: A4 portrait;
          margin: 0mm;
        }
        #printArea {
          padding: 0;
        }
        .print-wrap {
          padding: 15mm 0;
          box-sizing: border-box;
        }
        .print-title {
          font-size: 16px;
        }
        .print-meta {
          font-size: 12px;
          width: 90%;
          margin: 4px auto 12px;
        }
        .print-table {
          font-size: 12px;
          width: 90%;
          margin: 0 auto;
        }
        .print-table th,
        .print-table td {
          padding: 6px;
        }
        tr {
          page-break-inside: avoid;
        }
      }
    `;
    return;
  }

  if (mode === "stock") {
    _pdfStyleEl.textContent = commonPreviewCss + `
      #printArea {
        max-width: 850px;
      }
      .print-title {
        font-size: 19px;
        margin: 0 0 5px;
        text-align: center;
        color: #000;
      }
      .print-sub {
        font-size: 13px;
        margin: 0 0 8px;
        text-align: center;
        color: #000;
      }
      .stock-report-note {
        width: 95%;
        margin: 0 auto 12px;
        font-size: 10px;
        text-align: center;
        color: #444;
      }
      .print-table {
        width: 95%;
        margin: 0 auto;
        font-size: 12px;
        table-layout: fixed;
      }
      .print-table th,
      .print-table td {
        padding: 6px;
        overflow-wrap: anywhere;
      }
      .print-table th {
        background: #E8F5E9 !important;
        -webkit-print-color-adjust: exact;
        color: #000;
      }

      @media print {
        @page {
          size: A4 portrait;
          margin: 0mm;
        }
        #printArea {
          padding: 0;
        }
        .print-wrap {
          padding: 12mm 0;
          box-sizing: border-box;
        }
        .print-title {
          font-size: 17px;
        }
        .print-sub {
          font-size: 12px;
        }
        .stock-report-note {
          font-size: 9px;
        }
        .print-table {
          width: 95%;
          font-size: 11px;
        }
        .print-table th,
        .print-table td {
          padding: 5px;
        }
        tr {
          page-break-inside: avoid;
        }
      }
    `;
    return;
  }

  // Monthly register: A4 landscape.
  _pdfStyleEl.textContent = commonPreviewCss + `
    #printArea {
      max-width: 1150px;
    }
    .print-title {
      font-size: 15px;
      margin: 0 0 4px;
      text-align: center;
      color: #000;
    }
    .print-sub {
      font-size: 11px;
      margin: 0 0 8px;
      text-align: center;
      color: #000;
    }
    .print-table {
      font-size: 9px;
      table-layout: auto;
    }
    .print-table th,
    .print-table td {
      padding: 2px;
    }
    .print-table th {
      background: #E8F5E9 !important;
      -webkit-print-color-adjust: exact;
      color: #000;
    }
    .rotate-text {
      height: 65px;
    }

    @media print {
      @page {
        size: A4 landscape;
        margin: 0mm;
      }
      #printArea {
        padding: 0;
      }
      .print-wrap {
        padding: 3mm;
        box-sizing: border-box;
      }
      .print-title {
        font-size: 13px;
      }
      .print-sub {
        font-size: 9.5px;
      }
      .print-table {
        font-size: 7px;
      }
      .print-table th,
      .print-table td {
        padding: 1px;
      }
      .rotate-text {
        height: 58px;
      }
      tr {
        page-break-inside: avoid;
      }
    }
  `;
}

function applyPrintAutoFit(mode) {
  const wrap = document.querySelector("#printArea .print-wrap");
  if (!wrap) return;

  wrap.classList.remove("fit-scale");
  wrap.style.transform = "";
  wrap.style.zoom = "";

  const portraitWidth = 794;
  const landscapeWidth = 1123;
  const contentWidth = wrap.scrollWidth || 1;

  const maximumWidth =
    mode === "cashbook" || mode === "stock"
      ? portraitWidth - 20
      : landscapeWidth - 20;

  const scale = Math.min(1, maximumWidth / contentWidth);

  try {
    wrap.style.zoom = scale.toFixed(3);
  } catch {
    wrap.classList.add("fit-scale");
    wrap.style.transform = `scale(${scale.toFixed(3)})`;
  }
}

function showPrintPreview(contentHtml, mode) {
  const printArea = document.getElementById("printArea");
  if (!printArea) {
    console.error("Print area element was not found.");
    return;
  }

  setPrintMode(mode);

  const toolbarHtml = `
    <div class="preview-toolbar no-print">
      <button class="btn-close-preview" onclick="closePrintPreview()">⬅ Back to App</button>
      <span style="font-size:16px; font-weight:bold;">📄 Print Preview</span>
      <button class="btn-do-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>
  `;

  printArea.innerHTML = toolbarHtml + contentHtml;

  const appSection = document.getElementById("appSection");
  if (appSection) appSection.style.display = "none";

  printArea.style.display = "block";

  window.scrollTo(0, 0);
  applyPrintAutoFit(mode);
}

function closePrintPreview() {
  const printArea = document.getElementById("printArea");
  if (printArea) {
    printArea.style.display = "none";
    printArea.innerHTML = "";
  }

  const appSection = document.getElementById("appSection");
  if (appSection) appSection.style.display = "block";

  if (_pdfStyleEl) {
    _pdfStyleEl.remove();
    _pdfStyleEl = null;
  }

  _pdfPreviewMode = null;
}

window.addEventListener("afterprint", () => {
  if (_pdfPreviewMode) {
    applyPrintAutoFit(_pdfPreviewMode);
  }
});

// =========================
// Cashbook PDF (A4 Portrait)
// =========================
function printAdminPdf() {
  const tbody = document.getElementById("cashBookBody");
  const rows = tbody ? tbody.querySelectorAll("tr") : [];

  if (rows.length === 0) {
    alert("ആദ്യം LOAD ബട്ടൺ അമർത്തുക!");
    return;
  }

  const month = document.getElementById("adminMonth")?.value || "";
  const year = document.getElementById("adminYear")?.value || "";

  const opening = pdfEscapeHtml(
    document.getElementById("abOpening")?.innerText || "₹ 0.00"
  );
  const income = pdfEscapeHtml(
    document.getElementById("abIncome")?.innerText || "₹ 0.00"
  );
  const remit = pdfEscapeHtml(
    document.getElementById("abRemit")?.innerText || "₹ 0.00"
  );
  const closing = pdfEscapeHtml(
    document.getElementById("abClosing")?.innerText || "₹ 0.00"
  );

  let html = `
    <div class="print-wrap">
      <h2 class="print-title">Peppara Vanasree Cash Book (${pdfEscapeHtml(month)}/${pdfEscapeHtml(year)})</h2>

      <div class="print-meta">
        <div>
          Opening: <span style="color:#D32F2F;">${opening}</span>
          Income: <span style="color:#2E7D32;">${income}</span>
        </div>
        <div style="text-align:right;">
          Remit: <span style="color:#1976D2;">${remit}</span>
          Closing: <span>${closing}</span>
        </div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th style="width:20%;">Date</th>
            <th style="width:20%;">Income</th>
            <th style="width:20%;">Remitted</th>
            <th style="width:40%;">Remarks</th>
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach((row) => {
    const cells = row.querySelectorAll("td");

    if (cells.length >= 4) {
      html += `
        <tr>
          <td>${pdfEscapeHtml(cells[0].innerText)}</td>
          <td>${pdfEscapeHtml(cells[1].innerText)}</td>
          <td>${pdfEscapeHtml(cells[2].innerText)}</td>
          <td>${pdfEscapeHtml(cells[3].innerText)}</td>
        </tr>
      `;
    }
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  showPrintPreview(html, "cashbook");
}

// =========================
// Monthly Sales Register (A4 Landscape)
// =========================
async function printWebPdf() {
  await queueReady;

  // Do not generate the official register while offline operations remain.
  if (pendingCount > 0) {
    if (isConnected) {
      await syncPendingOps();
    }

    if (pendingCount > 0) {
      alert(
        "ശ്രദ്ധിക്കുക: ഓഫ്‌ലൈനിൽ സേവ് ചെയ്ത വിവരങ്ങൾ സിങ്ക് ആകാൻ ബാക്കിയുണ്ട്! " +
        "ഇന്റർനെറ്റ് ഓൺ ആക്കി Sync പൂർത്തിയായ ശേഷം PDF എടുക്കുക."
      );
      return;
    }
  }

  const month = document.getElementById("pdfMonth")?.value || "";
  const year = (document.getElementById("pdfYear")?.value || "").trim();

  if (!/^(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}$/.test(year)) {
    alert("ദയവായി ശരിയായ മാസം, വർഷം തിരഞ്ഞെടുക്കുക!");
    return;
  }

  const targetMonthKey = `${year}-${month}`;
  const normalizeName = (value) => String(value ?? "").trim();

  try {
    const [salesSnap, itemsSnap, returnsSnap, purchasesSnap] =
      await Promise.all([
        db.ref("Sales").once("value"),
        db.ref("Items").once("value"),
        db.ref("Returns").once("value"),
        db.ref("Purchases").once("value")
      ]);

    const uniqueItemsMap = {};
    const salesMap = {};
    const returnsMap = {};
    const purchasesMap = {};

    const futureSalesByItem = {};
    const futureReturnsByItem = {};
    const futurePurchasesByItem = {};

    // Sales
    salesSnap.forEach((child) => {
      const sale = child.val();
      if (!sale) return;

      const name = normalizeName(sale.itemName || sale.name);
      const saleIsoDate = pdfNormalizeDate(sale.date);
      if (!name || !saleIsoDate) return;

      const [saleYear, saleMonth, saleDay] = saleIsoDate.split("-");
      const saleMonthKey = `${saleYear}-${saleMonth}`;
      const quantity = parseInt(sale.quantity, 10) || 0;
      const amount = parseFloat(sale.amount) || 0;

      if (saleMonthKey === targetMonthKey) {
        const dayNumber = parseInt(saleDay, 10);

        salesMap[name] = salesMap[name] || {};
        salesMap[name][dayNumber] =
          salesMap[name][dayNumber] || { qty: 0, amt: 0 };

        salesMap[name][dayNumber].qty += quantity;
        salesMap[name][dayNumber].amt += amount;
      } else if (saleMonthKey > targetMonthKey) {
        futureSalesByItem[name] =
          (futureSalesByItem[name] || 0) + quantity;
      }
    });

    // Items
    itemsSnap.forEach((child) => {
      const item = child.val();
      const name = pdfItemName(item);
      if (!item || !name) return;

      item.itemName = name;
      uniqueItemsMap[name] = item;
    });

    const itemList = Object.values(uniqueItemsMap);

    // Returns
    returnsSnap.forEach((monthNode) => {
      const monthKey = String(monthNode.key || "");

      monthNode.forEach((child) => {
        const transaction = child.val();
        const name = normalizeName(
          transaction && (transaction.itemName || transaction.name)
        );
        if (!transaction || !name) return;

        const quantity = parseInt(transaction.quantity, 10) || 0;

        if (monthKey === targetMonthKey) {
          returnsMap[name] = (returnsMap[name] || 0) + quantity;
        } else if (monthKey > targetMonthKey) {
          futureReturnsByItem[name] =
            (futureReturnsByItem[name] || 0) + quantity;
        }
      });
    });

    // Purchases
    purchasesSnap.forEach((monthNode) => {
      const monthKey = String(monthNode.key || "");

      monthNode.forEach((child) => {
        const transaction = child.val();
        const name = normalizeName(
          transaction && (transaction.itemName || transaction.name)
        );
        if (!transaction || !name) return;

        const quantity = parseInt(transaction.quantity, 10) || 0;

        if (monthKey === targetMonthKey) {
          purchasesMap[name] = (purchasesMap[name] || 0) + quantity;
        } else if (monthKey > targetMonthKey) {
          futurePurchasesByItem[name] =
            (futurePurchasesByItem[name] || 0) + quantity;
        }
      });
    });

    if (itemList.length === 0) {
      alert("ഡാറ്റ ലഭ്യമല്ല!");
      return;
    }

    itemList.sort((a, b) =>
      (a.itemName || "").localeCompare(b.itemName || "")
    );

    const monthNumber = parseInt(month, 10);
    const yearNumber = parseInt(year, 10);
    const daysInMonth = new Date(yearNumber, monthNumber, 0).getDate();
    const shortYear = year.slice(-2);

    const monthName = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ][monthNumber - 1];

    let html = `
      <div class="print-wrap">
        <h2 class="print-title">Peppara Eco tourism EDC</h2>
        <h3 class="print-sub">Vanasree Stock cum sales register for the month of ${pdfEscapeHtml(monthName)} ${pdfEscapeHtml(year)}</h3>

        <table class="print-table">
          <thead>
            <tr>
              <th>Sl No</th>
              <th style="width:200px;">Item Name</th>
              <th>Rate/Unit</th>
              <th>Opening stock</th>
              <th>Purchase</th>
              <th>Total stock</th>
    `;

    for (let day = 1; day <= daysInMonth; day++) {
      html += `
        <th class="rotate-text">
          <span>${String(day).padStart(2, "0")}/${month}/${shortYear}</span>
        </th>
      `;
    }

    html += `
              <th>Total Sale</th>
              <th>Total amount</th>
              <th>Closing stock</th>
              <th>Stock returned</th>
              <th>Balance stock</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
    `;

    let serialNumber = 1;
    let grandTotalAmount = 0;
    const dailyTotals = new Array(daysInMonth).fill(0);

    itemList.forEach((item) => {
      if (!item || !item.itemName) return;

      let itemTotalQuantity = 0;
      let itemTotalAmount = 0;
      let dailyCellsHtml = "";

      const itemSales = salesMap[item.itemName] || {};

      for (let day = 1; day <= daysInMonth; day++) {
        const entry = itemSales[day];
        const dayQuantity = entry ? entry.qty : 0;
        const dayAmount = entry ? entry.amt : 0;

        itemTotalQuantity += dayQuantity;
        itemTotalAmount += dayAmount;
        dailyTotals[day - 1] += dayAmount;

        dailyCellsHtml += `<td>${dayQuantity > 0 ? dayQuantity : ""}</td>`;
      }

      const returnedQuantity = returnsMap[item.itemName] || 0;
      const purchasedQuantity = purchasesMap[item.itemName] || 0;

      grandTotalAmount += itemTotalAmount;

      const currentLiveStock = parseInt(item.stock, 10) || 0;
      const futureSales = futureSalesByItem[item.itemName] || 0;
      const futureReturns = futureReturnsByItem[item.itemName] || 0;
      const futurePurchases = futurePurchasesByItem[item.itemName] || 0;

      const closingAfterMonth = Math.max(
        0,
        currentLiveStock + futureSales + futureReturns - futurePurchases
      );
      const closingBeforeReturns = closingAfterMonth + returnedQuantity;
      const totalStockAvailable = closingBeforeReturns + itemTotalQuantity;
      const openingStock = Math.max(
        0,
        totalStockAvailable - purchasedQuantity
      );

      // Skip items with no activity or stock for the selected month.
      if (
        openingStock === 0 &&
        purchasedQuantity === 0 &&
        itemTotalQuantity === 0 &&
        returnedQuantity === 0 &&
        closingAfterMonth === 0
      ) {
        return;
      }

      html += `
        <tr>
          <td>${serialNumber++}</td>
          <td style="text-align:left;">${pdfEscapeHtml(item.itemName)}</td>
          <td>${(parseFloat(item.mrp) || 0).toFixed(2)}</td>
          <td>${openingStock}</td>
          <td>${purchasedQuantity > 0 ? purchasedQuantity : ""}</td>
          <td>${totalStockAvailable}</td>
          ${dailyCellsHtml}
          <td>${itemTotalQuantity > 0 ? itemTotalQuantity : "0"}</td>
          <td>${itemTotalAmount > 0 ? itemTotalAmount.toFixed(2) : "0.00"}</td>
          <td>${closingBeforeReturns}</td>
          <td>${returnedQuantity > 0 ? returnedQuantity : ""}</td>
          <td>${closingAfterMonth}</td>
          <td></td>
        </tr>
      `;
    });

    // Totals row
    html += `
      <tr>
        <td colspan="6"
            style="text-align:right; font-weight:bold; padding-right:4px;">
          Total
        </td>
    `;

    for (let index = 0; index < daysInMonth; index++) {
      html += `
        <td class="rotate-text" style="font-weight:bold; color:#D32F2F;">
          <span>${dailyTotals[index] > 0
            ? "₹" + dailyTotals[index].toFixed(2)
            : ""}</span>
        </td>
      `;
    }

    html += `
        <td style="font-weight:bold;"></td>
        <td style="font-weight:bold; color:#D32F2F;">
          ₹${grandTotalAmount.toFixed(2)}
        </td>
        <td colspan="4"></td>
      </tr>
      </tbody>
      </table>
      </div>
    `;

    showPrintPreview(html, "monthly");
  } catch (err) {
    console.error("PDF generation error:", err);
    showToast("Failed to generate PDF", "error", 2500);
  }
}

// =========================
// Stock Details as of Selected Date (A4 Portrait)
// =========================
async function printStockPdf() {
  await queueReady;

  const dateInput = document.getElementById("stockReportDate");
  const cutoffIso = pdfNormalizeDate(dateInput?.value);

  if (!cutoffIso) {
    alert("ദയവായി Stock Details റിപ്പോർട്ടിനായി ഒരു തീയതി തിരഞ്ഞെടുക്കുക!");
    return;
  }

  try {
    const [itemsSnap, salesSnap, returnsSnap, purchasesSnap, summary] =
      await Promise.all([
        db.ref("Items").once("value"),
        db.ref("Sales").once("value"),
        db.ref("Returns").once("value"),
        db.ref("Purchases").once("value"),
        getPendingSummary()
      ]);

    const itemsById = new Map();
    const itemIdByName = new Map();
    const itemList = [];

    itemsSnap.forEach((child) => {
      const item = child.val();
      const name = pdfItemName(item);
      if (!item || !name) return;

      const id = String(item.id || child.key);
      const serverStock = Number(item.stock) || 0;
      const pendingDelta =
        Number(summary.stockDeltaByItemId?.[id]) || 0;

      const reportItem = {
        id,
        name,
        mrp: Number(item.mrp) || 0,
        serverStock,
        currentLiveStock: Math.max(0, serverStock + pendingDelta),
        futureSales: 0,
        futureReturns: 0,
        futurePurchases: 0
      };

      itemsById.set(id, reportItem);
      itemIdByName.set(name, id);
      itemList.push(reportItem);
    });

    if (itemList.length === 0) {
      alert("സ്റ്റോക്കിൽ ഉൽപ്പന്നങ്ങൾ ഒന്നുമില്ല!");
      return;
    }

    function resolveItemId(record) {
      if (!record) return null;

      if (record.itemId !== undefined && record.itemId !== null) {
        const id = String(record.itemId);
        if (itemsById.has(id)) return id;
      }

      const name = pdfCleanName(record.itemName || record.name);
      return itemIdByName.get(name) || null;
    }

    function addFutureQuantity(itemId, fieldName, quantity) {
      const item = itemId ? itemsById.get(String(itemId)) : null;
      const amount = pdfQuantity(quantity);

      if (item && amount > 0) {
        item[fieldName] += amount;
      }
    }

    const operations = Array.isArray(summary.ops) ? summary.ops : [];
    const pendingEditsBySaleId = new Map();
    const pendingDeletedSaleIds = new Set();

    for (const saleId of summary.pendingDeleteSaleIds || []) {
      pendingDeletedSaleIds.add(String(saleId));
    }

    for (const op of operations) {
      if (op.type === "editSale") {
        const saleId = String(
          op.saleId ||
          String(op.opId || "").replace(/^editSale:/, "")
        );
        pendingEditsBySaleId.set(saleId, op);
      } else if (op.type === "deleteSale") {
        pendingDeletedSaleIds.add(String(op.saleId));
      }
    }

    // Roll back server sales dated after the selected date.
    const serverSaleIds = new Set();

    salesSnap.forEach((child) => {
      const sale = child.val();
      if (!sale) return;

      const saleId = String(sale.id || child.key);
      serverSaleIds.add(saleId);

      // A pending deletion reverses this sale in the current live stock.
      // Therefore, do not count the deleted sale as a future stock decrease.
      if (pendingDeletedSaleIds.has(saleId)) return;

      if (!pdfIsAfterCutoff(sale.date, "", cutoffIso)) return;

      const itemId = resolveItemId(sale);
      const pendingEdit = pendingEditsBySaleId.get(saleId);

      const quantity = pendingEdit
        ? pdfQuantity(pendingEdit.newQty)
        : pdfQuantity(sale.quantity);

      addFutureQuantity(itemId, "futureSales", quantity);
    });

    // Roll back future purchases and future returns recorded in Firebase.
    function processStockTransactionSnapshot(
      snapshot,
      quantityFieldName,
      parentMonthKey
    ) {
      snapshot.forEach((monthNode) => {
        const monthKey = String(monthNode.key || parentMonthKey || "");

        monthNode.forEach((child) => {
          const transaction = child.val();
          if (!transaction) return;

          if (
            !pdfIsAfterCutoff(
              transaction.date,
              monthKey,
              cutoffIso
            )
          ) {
            return;
          }

          const itemId = resolveItemId(transaction);
          const quantity = pdfQuantity(
            transaction.quantity ?? transaction.qty
          );

          addFutureQuantity(itemId, quantityFieldName, quantity);
        });
      });
    }

    processStockTransactionSnapshot(
      purchasesSnap,
      "futurePurchases",
      ""
    );

    processStockTransactionSnapshot(
      returnsSnap,
      "futureReturns",
      ""
    );

    // Include queued operations that have not yet been written to Firebase.
    // Queued edit/delete operations are handled by the server-sale overlay above.
    for (const op of operations) {
      if (op.type === "sale") {
        const saleId = String(
          op.saleId ||
          (op.saleData && op.saleData.id) ||
          ""
        );

        // Avoid counting a queued sale again if its server row already exists.
        if (saleId && serverSaleIds.has(saleId)) continue;

        const saleData = op.saleData || {};
        const dateValue =
          op.formattedDate || saleData.date || op.date;

        if (!pdfIsAfterCutoff(dateValue, op.monthKey, cutoffIso)) {
          continue;
        }

        const itemId = resolveItemId({
          itemId: op.itemId || saleData.itemId,
          itemName: op.itemName || saleData.itemName
        });

        const quantity = pdfQuantity(
          op.qty ?? saleData.quantity
        );

        addFutureQuantity(itemId, "futureSales", quantity);
      } else if (op.type === "purchase" || op.type === "return") {
        const transaction = op.data || {};
        const dateValue = transaction.date || op.date;

        if (!pdfIsAfterCutoff(dateValue, op.monthKey, cutoffIso)) {
          continue;
        }

        const itemId = resolveItemId({
          itemId: op.itemId || transaction.itemId,
          itemName: op.itemName || transaction.itemName
        });

        const quantity = pdfQuantity(
          op.qty ?? transaction.quantity
        );

        const targetField =
          op.type === "purchase"
            ? "futurePurchases"
            : "futureReturns";

        addFutureQuantity(itemId, targetField, quantity);
      }
    }

    itemList.sort((a, b) => a.name.localeCompare(b.name));

    const displayDate = pdfDisplayDate(cutoffIso);

    let html = `
      <div class="print-wrap">
        <h2 class="print-title">Peppara Eco tourism EDC</h2>
        <h3 class="print-sub">
          Vanasree - Stock Details (as on ${pdfEscapeHtml(displayDate)})
        </h3>
        <p class="stock-report-note">
          Stock is calculated through the selected date, including queued offline stock operations.
        </p>

        <table class="print-table">
          <thead>
            <tr>
              <th style="width:10%;">Sl No</th>
              <th style="width:50%; text-align:left; padding-left:10px;">Item Name</th>
              <th style="width:20%;">MRP (₹)</th>
              <th style="width:20%;">Balance Stock</th>
            </tr>
          </thead>
          <tbody>
    `;

    let serialNumber = 1;

    itemList.forEach((item) => {
      // Current stock includes all recorded movements. Reverse movements
      // dated after the selected cutoff to reconstruct stock on that date.
      const stockAsOfDate = Math.max(
        0,
        item.currentLiveStock +
          item.futureSales +
          item.futureReturns -
          item.futurePurchases
      );

      html += `
        <tr>
          <td>${serialNumber++}</td>
          <td style="text-align:left; padding-left:10px;">
            ${pdfEscapeHtml(item.name)}
          </td>
          <td>${item.mrp.toFixed(2)}</td>
          <td style="font-weight:bold; ${stockAsOfDate <= 0 ? "color:red;" : ""}">
            ${pdfFormatQuantity(stockAsOfDate)}
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    showPrintPreview(html, "stock");
  } catch (err) {
    console.error("Stock Details PDF generation error:", err);
    showToast("Failed to generate Stock Details", "error", 2500);
  }
}