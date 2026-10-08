// pdf.js
// =========================
// PDF Generation & Print Preview (Cashbook A4 Portrait + Monthly A4 Landscape)
// =========================

let _pdfStyleEl = null;
let _pdfPreviewMode = null;

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
      max-width: 1150px;
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
    .btn-close-preview { background: #607D8B; color: white; }
    .btn-do-print { background: #4CAF50; color: white; }
    .print-wrap { width: 100%; }
    .print-table { width: 100%; border-collapse: collapse; }
    .print-table th, .print-table td { border: 1px solid #000; text-align: center; }
    .rotate-text { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
    .fit-scale { transform-origin: top left; }

    @media print {
      #printArea {
        margin: 0;
        padding: 0;
        box-shadow: none;
        max-width: 100%;
        overflow: visible;
      }
      .no-print { display: none !important; }
    }
  `;

  if (mode === "cashbook") {
    _pdfStyleEl.textContent =
      commonPreviewCss +
      `
      .print-title { font-size: 16px; margin: 0 0 6px; text-align: center; color:#000; }
      .print-meta { display:flex; justify-content:space-between; margin: 4px 0 8px; font-size: 12px; font-weight: 700; }
      .print-table { font-size: 11px; }
      .print-table th, .print-table td { padding: 4px; }
      .print-table th { background:#eee !important; -webkit-print-color-adjust: exact; color:#000; }

      @media print {
        @page { size: A4 portrait; margin: 0mm; }
        #printArea { padding: 0; }
        .print-wrap { padding: 4mm; box-sizing: border-box; }
        .print-title { font-size: 15px; }
        .print-meta { font-size: 11px; }
        .print-table { font-size: 10px; }
        .print-table th, .print-table td { padding: 3px 4px; }
        tr { page-break-inside: avoid; }
      }
    `;
  } else {
    _pdfStyleEl.textContent =
      commonPreviewCss +
      `
      .print-title { font-size: 15px; margin: 0 0 4px; text-align: center; color:#000; }
      .print-sub { font-size: 11px; margin: 0 0 8px; text-align: center; color:#000; }
      .print-table { font-size: 9px; table-layout: auto; }
      .print-table th, .print-table td { padding: 2px; }
      .print-table th { background:#E8F5E9 !important; -webkit-print-color-adjust: exact; color:#000; }
      .rotate-text { height: 65px; }

      @media print {
        @page { size: A4 landscape; margin: 0mm; }
        #printArea { padding: 0; }
        .print-wrap { padding: 3mm; box-sizing: border-box; }
        .print-title { font-size: 13px; }
        .print-sub { font-size: 9.5px; }
        .print-table { font-size: 7px; }
        .print-table th, .print-table td { padding: 1px; }
        .rotate-text { height: 58px; }
        tr { page-break-inside: avoid; }
      }
    `;
  }
}

/**
 * Auto-fit content on preview/print area:
 * - cashbook: fit both width & height to single A4 portrait page
 * - monthly: fit width ONLY to A4 landscape (so 189 rows don't shrink into unreadable tiny text)
 */
function _applyAutoFit(mode) {
  const wrap = document.querySelector("#printArea .print-wrap");
  if (!wrap) return;

  wrap.classList.remove("fit-scale");
  wrap.style.transform = "";
  wrap.style.zoom = "";

  const A4_PORTRAIT_W = 794, A4_PORTRAIT_H = 1123;
  const A4_LAND_W = 1123;

  const contentW = wrap.scrollWidth || 1;
  const contentH = wrap.scrollHeight || 1;

  let scale = 1;
  if (mode === "cashbook") {
    const maxW = A4_PORTRAIT_W - 20;
    const maxH = A4_PORTRAIT_H - 20;
    scale = Math.min(1, maxW / contentW, maxH / contentH);
  } else {
    const maxW = A4_LAND_W - 20;
    scale = Math.min(1, maxW / contentW); // Fit width only for 189 items
  }

  try {
    wrap.style.zoom = scale.toFixed(3);
  } catch {
    wrap.classList.add("fit-scale");
    wrap.style.transform = `scale(${scale.toFixed(3)})`;
  }
}

function showPrintPreview(contentHtml, mode) {
  setPrintMode(mode);

  const toolbarHtml = `
    <div class="preview-toolbar no-print">
      <button class="btn-close-preview" onclick="closePrintPreview()">🔙 Back to App</button>
      <span style="font-size:16px; font-weight:bold;">📄 Print Preview</span>
      <button class="btn-do-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>
  `;

  const printArea = document.getElementById("printArea");
  printArea.innerHTML = toolbarHtml + contentHtml;

  document.getElementById("appSection").style.display = "none";
  printArea.style.display = "block";

  window.scrollTo(0, 0);
  _applyAutoFit(mode);
}

function closePrintPreview() {
  const printArea = document.getElementById("printArea");
  printArea.style.display = "none";
  printArea.innerHTML = "";

  document.getElementById("appSection").style.display = "block";

  if (_pdfStyleEl) {
    _pdfStyleEl.remove();
    _pdfStyleEl = null;
  }
  _pdfPreviewMode = null;
}

window.addEventListener("afterprint", () => {
  if (_pdfPreviewMode) _applyAutoFit(_pdfPreviewMode);
});

// =========================
// Cashbook PDF (A4 Portrait)
// =========================
function printAdminPdf() {
  const rows = document.querySelectorAll("#cashBookBody tr");
  if (rows.length === 0) {
    alert("ആദ്യം LOAD ബട്ടൺ അമർത്തുക!");
    return;
  }

  let html = `
    <div class="print-wrap">
      <h2 class="print-title">Peppara Vanasree Cash Book (${document.getElementById("adminMonth").value}/${document.getElementById("adminYear").value})</h2>

      <div class="print-meta">
        <div>
          Opening: <span style="color:#D32F2F;">${document.getElementById("abOpening").innerText}</span><br>
          Income: <span style="color:#2E7D32;">${document.getElementById("abIncome").innerText}</span>
        </div>
        <div style="text-align:right;">
          Remit: <span style="color:#1976D2;">${document.getElementById("abRemit").innerText}</span><br>
          Closing: <span>${document.getElementById("abClosing").innerText}</span>
        </div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th>Date</th><th>Income</th><th>Remitted</th><th>Remarks</th>
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach((r) => {
    const c = r.querySelectorAll("td");
    if (c.length >= 4) {
      html += `
        <tr>
          <td>${c[0].innerText}</td>
          <td>${c[1].innerText}</td>
          <td>${c[2].innerText}</td>
          <td style="text-align:left;">${c[3].innerText}</td>
        </tr>
      `;
    }
  });

  html += `</tbody></table></div>`;

  showPrintPreview(html, "cashbook");
}

// =========================
// Monthly PDF (A4 Landscape)
// =========================
async function printWebPdf() {
  const m = document.getElementById("pdfMonth").value;
  const y = document.getElementById("pdfYear").value;
  const targetMonthKey = `${y}-${m}`;
  const norm = (s) => (s || "").trim();

  try {
    const [sSnap, iSnap, rAllSnap, pAllSnap] = await Promise.all([
      db.ref("Sales").once("value"),
      db.ref("Items").once("value"),
      db.ref("Returns").once("value"),
      db.ref("Purchases").once("value")
    ]);

    const uniqueItemsMap = {};
    const salesMap = {};
    const retMap = {};
    const purMap = {};

    const futureSalesByItem = {};
    const futureReturnsByItem = {};
    const futurePurchasesByItem = {};

    // Sales
    sSnap.forEach((c) => {
      const v = c.val();
      if (!v || !v.date || !v.itemName) return;

      const name = norm(v.itemName);
      const parts = v.date.split("/");
      if (parts.length !== 3) return;

      const saleMonthKey = `${parts[2]}-${parts[1]}`;
      const q = parseInt(v.quantity, 10) || 0;
      const a = parseFloat(v.amount) || 0;

      if (saleMonthKey === targetMonthKey) {
        const dayNum = parseInt(parts[0], 10);
        salesMap[name] = salesMap[name] || {};
        salesMap[name][dayNum] = salesMap[name][dayNum] || { qty: 0, amt: 0 };
        salesMap[name][dayNum].qty += q;
        salesMap[name][dayNum].amt += a;
      } else if (saleMonthKey > targetMonthKey) {
        futureSalesByItem[name] = (futureSalesByItem[name] || 0) + q;
      }
    });

    // Items (unique by trimmed name)
    iSnap.forEach((c) => {
      const it = c.val();
      if (it && it.itemName) {
        const clean = norm(it.itemName);
        it.itemName = clean;
        uniqueItemsMap[clean] = it;
      }
    });
    const iList = Object.values(uniqueItemsMap);

    // Returns
    rAllSnap.forEach((monthNode) => {
      const mKey = monthNode.key;
      monthNode.forEach((c) => {
        const v = c.val();
        if (!v || !v.itemName) return;
        const name = norm(v.itemName);
        const q = parseInt(v.quantity, 10) || 0;

        if (mKey === targetMonthKey) retMap[name] = (retMap[name] || 0) + q;
        else if (mKey > targetMonthKey) futureReturnsByItem[name] = (futureReturnsByItem[name] || 0) + q;
      });
    });

    // Purchases
    pAllSnap.forEach((monthNode) => {
      const mKey = monthNode.key;
      monthNode.forEach((c) => {
        const v = c.val();
        if (!v || !v.itemName) return;
        const name = norm(v.itemName);
        const q = parseInt(v.quantity, 10) || 0;

        if (mKey === targetMonthKey) purMap[name] = (purMap[name] || 0) + q;
        else if (mKey > targetMonthKey) futurePurchasesByItem[name] = (futurePurchasesByItem[name] || 0) + q;
      });
    });

    if (iList.length === 0) {
      alert("ഡാറ്റ ലഭ്യമല്ല!");
      return;
    }

    iList.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));

    const days = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
    const shortY = y.toString().slice(-2);
    const monthName =
      ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m, 10) - 1];

    let html = `
      <div class="print-wrap">
        <h2 class="print-title">Peppara Eco tourism EDC</h2>
        <h3 class="print-sub">Vanasree Stock cum sales register for the month of ${monthName} ${y}</h3>

        <table class="print-table">
          <thead>
            <tr>
              <th>Sl<br>No</th>
              <th style="width:200px;">Item Name</th>
              <th>Rate/<br>Unit</th>
              <th>Opening<br>stock</th>
              <th>Purchase</th>
              <th>Total<br>stock</th>
    `;

    for (let i = 1; i <= days; i++) {
      html += `<th class="rotate-text"><span>${String(i).padStart(2, "0")}/${m}/${shortY}</span></th>`;
    }

    html += `
              <th>Total<br>Sale</th>
              <th>Total<br>amount</th>
              <th>Closing<br>stock</th>
              <th>Stock<br>returned</th>
              <th>Balance<br>stock</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
    `;

    let sl = 1;
    let gTot = 0;
    let dTot = new Array(days).fill(0);

    iList.forEach((it) => {
      if (!it || !it.itemName) return;

      let iTotQ = 0;
      let iTotA = 0;
      let dHtml = "";

      const itemSales = salesMap[it.itemName] || {};

      for (let d = 1; d <= days; d++) {
        const dayEntry = itemSales[d];
        const dq = dayEntry ? dayEntry.qty : 0;
        const da = dayEntry ? dayEntry.amt : 0;

        iTotQ += dq;
        iTotA += da;
        dTot[d - 1] += da;

        dHtml += `<td>${dq > 0 ? dq : ""}</td>`;
      }

      const retQ = retMap[it.itemName] || 0;
      const purQ = purMap[it.itemName] || 0;

      gTot += iTotA;

      const currentLiveStock = parseInt(it.stock, 10) || 0;
      const fSales = futureSalesByItem[it.itemName] || 0;
      const fRet = futureReturnsByItem[it.itemName] || 0;
      const fPur = futurePurchasesByItem[it.itemName] || 0;

      const cl = Math.max(0, currentLiveStock + fSales + fRet - fPur);
      const clBfRet = cl + retQ;
      const tot = clBfRet + iTotQ;
      const openingStock = Math.max(0, tot - purQ);

      html += `
        <tr>
          <td>${sl++}</td>
          <td style="text-align:left;">${it.itemName}</td>
          <td>${parseFloat(it.mrp || 0).toFixed(2)}</td>
          <td>${openingStock}</td>
          <td>${purQ > 0 ? purQ : ""}</td>
          <td>${tot}</td>
          ${dHtml}
          <td>${iTotQ > 0 ? iTotQ : "0"}</td>
          <td>${iTotA > 0 ? iTotA.toFixed(2) : "0.00"}</td>
          <td>${clBfRet}</td>
          <td>${retQ > 0 ? retQ : ""}</td>
          <td>${cl}</td>
          <td></td>
        </tr>
      `;
    });

    html += `<tr>
      <td colspan="6" style="text-align:right; font-weight:bold; padding-right:4px;">Total</td>`;

    for (let i = 0; i < days; i++) {
      html += `<td class="rotate-text" style="font-weight:bold; color:#D32F2F;">
        <span>${dTot[i] > 0 ? ("₹" + dTot[i].toFixed(2)) : ""}</span>
      </td>`;
    }

    html += `
      <td style="font-weight:bold;"></td>
      <td style="font-weight:bold; color:#D32F2F;">₹${gTot.toFixed(2)}</td>
      <td colspan="4"></td>
    </tr>`;

    html += `</tbody></table></div>`;

    showPrintPreview(html, "monthly");

  } catch (err) {
    console.error("PDF generation error:", err);
    showToast("Failed to generate PDF", "error", 2500);
  }
}