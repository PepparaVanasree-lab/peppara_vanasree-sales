// cashbook.js
const _num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function loadAdminData() {
  const month = document.getElementById("adminMonth").value;
  const year = document.getElementById("adminYear").value;

  const tbody = document.getElementById("cashBookBody");
  tbody.innerHTML = "";

  const days = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
  await queueReady;
  const summary = await getPendingSummary();

  let totalIncome = 0;
  let totalRemit = 0;
  let totalPendingIncome = 0;
  let pendingRemitCount = 0;

  const [salesSnap, remitSnap] = await Promise.all([
    db.ref("DailySales").once("value"),
    db.ref("Remittances").once("value")
  ]);

  let html = "";

  for (let i = 1; i <= days; i++) {
    const dayStr = String(i).padStart(2, "0");
    const dateKey = `${dayStr}-${month}-${year}`;
    const displayDate = `${dayStr}/${month}/${year}`;

    const incomeServer = _num(salesSnap.child(dateKey).val());
    const incomePending = _num(summary.pendingIncomeByDateKey[dateKey]);
    const incomeTotal = incomeServer + incomePending;

    const serverNode = remitSnap.child(dateKey).val() || {};
    let remitAmt = _num(serverNode.amount);
    let remitRemarks = (serverNode.remarks || "");
    let remitBadge = "";

    if (summary.pendingRemitByDateKey[dateKey]) {
      const pend = summary.pendingRemitByDateKey[dateKey];
      remitAmt = _num(pend.amount);
      remitRemarks = pend.remarks || "";
      remitBadge = ` <span class="badge-pending">PENDING</span>`;
      pendingRemitCount++;
    }

    totalIncome += incomeTotal;
    totalRemit += remitAmt;
    totalPendingIncome += incomePending;

    html += `<tr>
      <td>${displayDate}</td>
      <td style="color:#2E7D32; font-weight:bold;">
        ${incomeTotal > 0 ? incomeTotal.toFixed(2) : "-"}
        ${incomePending !== 0 ? ` <span class="badge-pending">+pending</span>` : ``}
      </td>
      <td style="color:#1976D2; font-weight:bold;">
        ${remitAmt > 0 ? remitAmt.toFixed(2) : "-"}${remitBadge}
      </td>
      <td>${remitRemarks || "-"}</td>
      <td>
        <span onclick='editRemittance(${js(dateKey)}, ${remitAmt}, ${js(remitRemarks)})'
              style="color:#2196F3; cursor:pointer; text-decoration:underline; font-weight:bold;">
          Edit
        </span>
      </td>
    </tr>`;
  }

  tbody.innerHTML = html;

  document.getElementById("abIncome").innerText = `₹ ${totalIncome.toFixed(2)}`;
  document.getElementById("abRemit").innerText = `₹ ${totalRemit.toFixed(2)}`;

  const note = document.getElementById("pendingNote");
  note.innerText =
    pendingCount > 0
      ? `Note: ${pendingCount} pending ops (Income pending: ₹${totalPendingIncome.toFixed(2)}, Remit pending edits: ${pendingRemitCount})`
      : "";

  await calculateAbstractBalance(month, year, totalIncome, totalRemit);
}

async function calculateAbstractBalance(month, year, income, remit) {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);

  const prevMonth = (m === 1) ? 12 : (m - 1);
  const prevYear  = (m === 1) ? (y - 1) : y;

  const prevKey = `${String(prevMonth).padStart(2, "0")}-${prevYear}`;
  const curKey  = `${String(m).padStart(2, "0")}-${y}`;

  const snap = await db.ref("Balances/" + prevKey + "/closingBalance").once("value");
  const opening = _num(snap.val());
  const closing = (opening + _num(income)) - _num(remit);

  document.getElementById("abOpening").innerText = `₹ ${opening.toFixed(2)}`;
  document.getElementById("abClosing").innerText = `₹ ${closing.toFixed(2)}`;

  if (isConnected && pendingCount === 0) {
    db.ref("Balances/" + curKey + "/closingBalance").set(closing);
  }
}

let currentRemitDateKey = "";

function editRemittance(dateKey, oldAmt, oldRemarks) {
  currentRemitDateKey = dateKey;
  
  document.getElementById("remitModalDate").innerText = "Date: " + dateKey;
  document.getElementById("remitModalAmt").value = oldAmt > 0 ? oldAmt : "";
  document.getElementById("remitModalRemarks").value = oldRemarks || "";
  
  document.getElementById("remitModal").style.display = "flex";
  
  setTimeout(() => document.getElementById("remitModalAmt").focus(), 100);
}

function closeRemitModal() {
  document.getElementById("remitModal").style.display = "none";
}

async function submitRemitModal() {
  const amtStr = document.getElementById("remitModalAmt").value;
  const remarks = document.getElementById("remitModalRemarks").value;
  
  const data = { amount: _num(amtStr), remarks: remarks || "" };

  await queuePut({ opId: "remit:" + currentRemitDateKey, type: "remit", dateKey: currentRemitDateKey, data });

  closeRemitModal();
  showToast("Remittance saved (sync pending if offline)", "success", 2200);
  loadAdminData();
  syncPendingOps();
}