// =========================
// Cashbook & Remittance
// =========================
async function loadAdminData() {
  const month = document.getElementById("adminMonth").value;
  const year = document.getElementById("adminYear").value;
  const tbody = document.getElementById("cashBookBody");
  tbody.innerHTML = "";

  const days = new Date(parseInt(year,10), parseInt(month,10), 0).getDate();
  const summary = await getPendingSummary();

  let totalIncome = 0, totalRemit = 0;
  let totalPendingIncome = 0, pendingRemitCount = 0;

  const salesSnap = await db.ref("DailySales").once("value");
  const remitSnap = await db.ref("Remittances").once("value");

  for (let i=1; i<=days; i++) {
    const dayStr = String(i).padStart(2, "0");
    const dateKey = `${dayStr}-${month}-${year}`;
    const displayDate = `${dayStr}/${month}/${year}`;

    const incomeServer = parseFloat(salesSnap.child(dateKey).val()) || 0;
    const incomePending = summary.pendingIncomeByDateKey[dateKey] || 0;
    const incomeTotal = incomeServer + incomePending;

    const remitNode = remitSnap.child(dateKey).val() || {};
    let remitAmt = parseFloat(remitNode.amount) || 0;
    let remitRemarks = remitNode.remarks || "";
    let remitBadge = "";

    if (summary.pendingRemitByDateKey[dateKey]) {
      remitAmt = parseFloat(summary.pendingRemitByDateKey[dateKey].amount) || 0;
      remitRemarks = summary.pendingRemitByDateKey[dateKey].remarks || "";
      remitBadge = ` <span class="badge-pending">PENDING</span>`;
      pendingRemitCount++;
    }

    totalIncome += incomeTotal;
    totalRemit += remitAmt;
    totalPendingIncome += incomePending;

    tbody.innerHTML += `<tr>
      <td>${displayDate}</td>
      <td style="color:#2E7D32; font-weight:bold;">${incomeTotal > 0 ? incomeTotal.toFixed(2) : "-"}${incomePending !== 0 ? ` <span class="badge-pending">+pending</span>` : ``}</td>
      <td style="color:#1976D2; font-weight:bold;">${remitAmt > 0 ? remitAmt.toFixed(2) : "-" }${remitBadge}</td>
      <td>${remitRemarks || "-"}</td>
      <td><span onclick='editRemittance(${js(dateKey)}, ${remitAmt}, ${js(remitRemarks)})' style="color:#2196F3; cursor:pointer; text-decoration:underline; font-weight:bold;">Edit</span></td>
    </tr>`;
  }
  document.getElementById("abIncome").innerText = `₹ ${totalIncome.toFixed(2)}`;
  document.getElementById("abRemit").innerText = `₹ ${totalRemit.toFixed(2)}`;

  const note = document.getElementById("pendingNote");
  note.innerText = pendingCount > 0 ? `Note: ${pendingCount} pending ops (Income: ₹${totalPendingIncome.toFixed(2)}, Remit: ${pendingRemitCount})` : "";

  await calculateAbstractBalance(month, year, totalIncome, totalRemit);
}

async function calculateAbstractBalance(month, year, income, remit) {
  const m = parseInt(month, 10), y = parseInt(year, 10);
  const prevKey = `${String((m===1)?12:m-1).padStart(2,"0")}-${(m===1)?y-1:y}`;
  const curKey  = `${String(m).padStart(2,"0")}-${y}`;

  const snap = await db.ref("Balances/" + prevKey + "/closingBalance").once("value");
  const opening = parseFloat(snap.val()) || 0;
  const closing = (opening + income) - remit;

  document.getElementById("abOpening").innerText = `₹ ${opening.toFixed(2)}`;
  document.getElementById("abClosing").innerText = `₹ ${closing.toFixed(2)}`;
  if (isConnected && pendingCount === 0) db.ref("Balances/" + curKey + "/closingBalance").set(closing);
}

async function editRemittance(dateKey, oldAmt, oldRemarks) {
  const amtStr = prompt(`ബാങ്കിൽ അടച്ച തുക നൽകുക (${dateKey}):`, oldAmt > 0 ? oldAmt : "");
  if (amtStr === null) return;
  const data = { amount: parseFloat(amtStr) || 0, remarks: prompt("Remarks:", oldRemarks || "") ?? "" };
  await queuePut({ opId: "remit:" + dateKey, type: "remit", dateKey, data });
  showToast("Remittance saved", "success");
  loadAdminData();
  syncPendingOps();
}