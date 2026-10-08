// =========================
// PDF Generation & Print Preview
// =========================
function setPrintMode(mode) {
  let style = document.getElementById("dynamicPrintStyle");
  if (!style) { style = document.createElement("style"); style.id = "dynamicPrintStyle"; document.head.appendChild(style); }

  const commonPreviewCss = `
    #printArea { background: #fff; max-width: 1150px; margin: 15px auto; padding: 15px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); box-sizing: border-box; overflow-x: auto; }
    .preview-toolbar { display: flex; justify-content: space-between; align-items: center; background: #263238; color: #fff; padding: 12px 18px; border-radius: 6px; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }
    .preview-toolbar button { width: auto; margin: 0; padding: 10px 20px; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .btn-close-preview { background: #607D8B; color: white; }
    .btn-do-print { background: #4CAF50; color: white; }
    .print-table { width: 100%; border-collapse: collapse; }
    .print-table th, .print-table td { border: 1px solid #000; text-align: center; }
    .rotate-text { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
    @media print {
      #printArea { margin: 0; padding: 0; box-shadow: none; max-width: 100%; overflow: visible; }
      .no-print { display: none !important; }
    }
  `;

  if (mode === "cashbook") {
    style.textContent = commonPreviewCss + `
      .print-wrap { width: 100%; }
      .print-title { font-size: 16px; margin: 0 0 6px; text-align: center; color:#000; }
      .print-meta { display:flex; justify-content:space-between; margin: 4px 0 8px; font-size: 12px; font-weight: 700; }
      .print-table { font-size: 11px; }
      .print-table th, .print-table td { padding: 4px; }
      .print-table th { background:#eee !important; -webkit-print-color-adjust: exact; color:#000; }
      @media print {
        @page { size: A4 portrait; margin: 4mm; }
        .print-title { font-size: 15px; }
        .print-meta { font-size: 11px; }
        .print-table { font-size: 10px; }
        .print-table th, .print-table td { padding: 3px 4px; }
      }
    `;
  } else {
    style.textContent = commonPreviewCss + `
      .print-wrap { width: 100%; overflow-x: auto; }
      .print-title { font-size: 15px; margin: 0 0 4px; text-align: center; color:#000; }
      .print-sub { font-size: 11px; margin: 0 0 8px; text-align: center; color:#000; }
      .print-table { font-size: 9px; }
      .print-table th, .print-table td { padding: 2px; }
      .print-table th { background:#E8F5E9 !important; -webkit-print-color-adjust: exact; color:#000; }
      .rotate-text { height: 65px; }
      @media print {
        @page { size: A4 landscape; margin: 3mm; }
        .print-wrap { overflow: visible; }
        .print-title { font-size: 13px; }
        .print-sub { font-size: 9.5px; }
        .print-table { font-size: 7px; }
        .print-table th, .print-table td { padding: 1px; }
        tr { page-break-inside: avoid; }
      }
    `;
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
}

function closePrintPreview() {
  const s = document.getElementById("dynamicPrintStyle");
  if (s) s.remove();
  const printArea = document.getElementById("printArea");
  printArea.style.display = "none";
  printArea.innerHTML = "";
  document.getElementById("appSection").style.display = "block";
}

function printAdminPdf() {
  const rows = document.querySelectorAll("#cashBookBody tr");
  if (rows.length === 0) { alert("ആദ്യം LOAD ബട്ടൺ അമർത്തുക!"); return; }
  let html = `<div class="print-wrap"><h2 class="print-title">Peppara Vanasree Cash Book (${document.getElementById("adminMonth").value}/${document.getElementById("adminYear").value})</h2><div class="print-meta"><div>Opening: <span style="color:#D32F2F;">${document.getElementById("abOpening").innerText}</span><br>Income: <span style="color:#2E7D32;">${document.getElementById("abIncome").innerText}</span></div><div style="text-align:right;">Remit: <span style="color:#1976D2;">${document.getElementById("abRemit").innerText}</span><br>Closing: <span>${document.getElementById("abClosing").innerText}</span></div></div><table class="print-table"><thead><tr><th>Date</th><th>Income</th><th>Remitted</th><th>Remarks</th></tr></thead><tbody>`;
  rows.forEach(r => { const c = r.querySelectorAll("td"); if (c.length >= 4) html += `<tr><td>${c[0].innerText}</td><td>${c[1].innerText}</td><td>${c[2].innerText}</td><td style="text-align:left;">${c[3].innerText}</td></tr>`; });
  html += `</tbody></table></div>`;
  showPrintPreview(html, "cashbook");
}

async function printWebPdf() {
  const m = document.getElementById("pdfMonth").value, y = document.getElementById("pdfYear").value;
  const targetMonthKey = `${y}-${m}`;

  try {
    const [sSnap, iSnap, rAllSnap, pAllSnap] = await Promise.all([
      db.ref("Sales").once("value"),
      db.ref("Items").once("value"),
      db.ref("Returns").once("value"),
      db.ref("Purchases").once("value")
    ]);

    let iList = [];
    const salesMap = {}; // { itemName: { dayNum: { qty, amt } } }
    const retMap = {}, purMap = {};
    const futureSalesByItem = {}, futureReturnsByItem = {}, futurePurchasesByItem = {};

    sSnap.forEach(c => {
      const v = c.val();
      if (!v || !v.date || !v.itemName) return;
      const parts = v.date.split("/");
      if (parts.length === 3) {
        const saleMonthKey = `${parts[2]}-${parts[1]}`;
        const q = parseInt(v.quantity, 10) || 0;
        const a = parseFloat(v.amount) || 0;
        if (saleMonthKey === targetMonthKey) {
          const dayNum = parseInt(parts[0], 10);
          salesMap[v.itemName] = salesMap[v.itemName] || {};
          salesMap[v.itemName][dayNum] = salesMap[v.itemName][dayNum] || { qty: 0, amt: 0 };
          salesMap[v.itemName][dayNum].qty += q;
          salesMap[v.itemName][dayNum].amt += a;
        } else if (saleMonthKey > targetMonthKey) {
          futureSalesByItem[v.itemName] = (futureSalesByItem[v.itemName] || 0) + q;
        }
      }
    });

    iSnap.forEach(c => iList.push(c.val()));

    rAllSnap.forEach(monthNode => {
      const mKey = monthNode.key;
      monthNode.forEach(c => {
        const v = c.val();
        if (!v || !v.itemName) return;
        const q = parseInt(v.quantity, 10) || 0;
        if (mKey === targetMonthKey) retMap[v.itemName] = (retMap[v.itemName] || 0) + q;
        else if (mKey > targetMonthKey) futureReturnsByItem[v.itemName] = (futureReturnsByItem[v.itemName] || 0) + q;
      });
    });

    pAllSnap.forEach(monthNode => {
      const mKey = monthNode.key;
      monthNode.forEach(c => {
        const v = c.val();
        if (!v || !v.itemName) return;
        const q = parseInt(v.quantity, 10) || 0;
        if (mKey === targetMonthKey) purMap[v.itemName] = (purMap[v.itemName] || 0) + q;
        else if (mKey > targetMonthKey) futurePurchasesByItem[v.itemName] = (futurePurchasesByItem[v.itemName] || 0) + q;
      });
    });

    if (iList.length === 0) { alert("ഡാറ്റ ലഭ്യമല്ല!"); return; }
    iList.sort((a,b) => (a.itemName||"").localeCompare(b.itemName||""));
    const days = new Date(parseInt(y,10), parseInt(m,10), 0).getDate();
    let html = `<div class="print-wrap"><h2 class="print-title">Peppara Eco tourism EDC</h2><h3 class="print-sub">Vanasree Stock cum sales register for the month of ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m,10)-1]} ${y}</h3><table class="print-table"><thead><tr><th>Sl<br>No</th><th style="width:200px;">Item Name</th><th>Rate/<br>Unit</th><th>Opening<br>stock</th><th>Purchase</th><th>Total<br>stock</th>`;
    const shortY = y.toString().slice(-2);
    for (let i=1; i<=days; i++) html += `<th class="rotate-text"><span>${String(i).padStart(2,'0')}/${m}/${shortY}</span></th>`;
    html += `<th>Total<br>Sale</th><th>Total<br>amount</th><th>Closing<br>stock</th><th>Stock<br>returned</th><th>Balance<br>stock</th><th>Remarks</th></tr></thead><tbody>`;
    let sl=1, gTot=0, dTot=new Array(days).fill(0);

    iList.forEach(it => {
      if(!it||!it.itemName) return;
      let iTotQ=0, iTotA=0, dHtml="";
      const itemSales = salesMap[it.itemName] || {};

      for(let i=1; i<=days; i++) {
        const dayEntry = itemSales[i];
        const dq = dayEntry ? dayEntry.qty : 0;
        const da = dayEntry ? dayEntry.amt : 0;
        iTotQ+=dq; iTotA+=da; dTot[i-1]+=da;
        dHtml+=`<td>${dq>0?dq:""}</td>`;
      }
      const retQ = retMap[it.itemName] || 0;
      const purQ = purMap[it.itemName] || 0;
      gTot+=iTotA;

      const currentLiveStock = parseInt(it.stock, 10) || 0;
      const fSales = futureSalesByItem[it.itemName] || 0;
      const fRet   = futureReturnsByItem[it.itemName] || 0;
      const fPur   = futurePurchasesByItem[it.itemName] || 0;

      const cl = Math.max(0, currentLiveStock + fSales + fRet - fPur);
      const clBfRet = cl + retQ;
      const tot = clBfRet + iTotQ;
      const openingStock = Math.max(0, tot - purQ);

      html += `<tr><td>${sl++}</td><td style="text-align:left;">${it.itemName}</td><td>${parseFloat(it.mrp||0).toFixed(2)}</td><td>${openingStock}</td><td>${purQ>0?purQ:""}</td><td>${tot}</td>${dHtml}<td>${iTotQ>0?iTotQ:"0"}</td><td>${iTotA>0?iTotA.toFixed(2):"0.00"}</td><td>${clBfRet}</td><td>${retQ>0?retQ:""}</td><td>${cl}</td><td></td></tr>`;
    });

    html += `<tr><td colspan="6" style="text-align:right; font-weight:bold; padding-right:4px;">Total</td>`;
    for(let i=0; i<days; i++) html += `<td class="rotate-text" style="font-weight:bold; color:#D32F2F;"><span>${dTot[i]>0?('₹'+dTot[i].toFixed(2)):""}</span></td>`;
    html += `<td style="font-weight:bold;"></td><td style="font-weight:bold; color:#D32F2F;">₹${gTot.toFixed(2)}</td><td colspan="4"></td></tr></tbody></table></div>`;
    showPrintPreview(html, "monthly");
  } catch (err) {
    console.error("PDF generation error:", err);
    showToast("Failed to generate PDF", "error");
  }
}