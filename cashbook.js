// cashbook.js

const _num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};


function _cashBookEscapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[char];
  });
}


function _cashBookNormalizeCount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}


function _cashBookCollectionCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length;
  }

  return 0;
}


function _cashBookGetPendingCount(summary) {
  const data = summary && typeof summary === "object" ? summary : {};

  const countFields = [
    "pendingCount",
    "pendingOpsCount",
    "pendingOperationCount",
    "totalPendingOps",
    "totalPendingOperations"
  ];

  let reportedCount = null;

  for (const key of countFields) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      continue;
    }

    const count = _cashBookNormalizeCount(data[key]);

    if (count !== null) {
      reportedCount = count;
      break;
    }
  }

  let globalPendingCount = null;

  // pendingCount may be supplied by app.js as a global variable.
  if (typeof pendingCount !== "undefined") {
    globalPendingCount = _cashBookNormalizeCount(pendingCount);
  }

  const collectionNames = [
    "pendingOps",
    "pendingOperations",
    "ops",
    "operations"
  ];

  let collectionCount = 0;

  for (const key of collectionNames) {
    const value = data[key];
    const numericCount = _cashBookNormalizeCount(value);

    if (numericCount !== null) {
      collectionCount = Math.max(collectionCount, numericCount);
    }

    collectionCount = Math.max(
      collectionCount,
      _cashBookCollectionCount(value)
    );
  }

  const pendingIncomeCount = _cashBookCollectionCount(
    data.pendingIncomeByDateKey
  );

  const pendingRemitCount = _cashBookCollectionCount(
    data.pendingRemitByDateKey
  );

  return Math.max(
    reportedCount === null ? 0 : reportedCount,
    globalPendingCount === null ? 0 : globalPendingCount,
    collectionCount,
    pendingIncomeCount + pendingRemitCount
  );
}


function _cashBookBindRemittanceEdit(tbody) {
  if (!tbody || tbody._cashBookRemitHandlerBound) {
    return;
  }

  tbody.addEventListener("click", (event) => {
    const target = event.target;

    if (!target || typeof target.closest !== "function") {
      return;
    }

    const button = target.closest(
      "[data-cashbook-action='edit-remittance']"
    );

    if (!button || !tbody.contains(button)) {
      return;
    }

    editRemittance(
      button.getAttribute("data-date-key") || "",
      _num(button.getAttribute("data-amount")),
      button.getAttribute("data-remarks") || ""
    );
  });

  tbody._cashBookRemitHandlerBound = true;
}


async function loadAdminData() {
  const monthInput = document.getElementById("adminMonth");
  const yearInput = document.getElementById("adminYear");
  const tbody = document.getElementById("cashBookBody");

  if (!monthInput || !yearInput || !tbody) {
    return;
  }

  let monthNumber = parseInt(monthInput.value, 10);
  let yearNumber = parseInt(yearInput.value, 10);

  if (
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    !Number.isInteger(yearNumber) ||
    yearNumber < 1
  ) {
    const now = new Date();

    monthNumber = now.getMonth() + 1;
    yearNumber = now.getFullYear();

    monthInput.value = String(monthNumber).padStart(2, "0");
    yearInput.value = String(yearNumber);
  }

  const month = String(monthNumber).padStart(2, "0");
  const year = String(yearNumber);

  tbody.innerHTML = "";
  _cashBookBindRemittanceEdit(tbody);

  const days = new Date(yearNumber, monthNumber, 0).getDate();

  await queueReady;

  const summary = (await getPendingSummary()) || {};

  const pendingIncomeByDateKey =
    summary.pendingIncomeByDateKey &&
    typeof summary.pendingIncomeByDateKey === "object"
      ? summary.pendingIncomeByDateKey
      : {};

  const pendingRemitByDateKey =
    summary.pendingRemitByDateKey &&
    typeof summary.pendingRemitByDateKey === "object"
      ? summary.pendingRemitByDateKey
      : {};

  const pendingOpsCount = _cashBookGetPendingCount(summary);

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
    const incomePending = _num(pendingIncomeByDateKey[dateKey]);
    const incomeTotal = incomeServer + incomePending;

    const serverNode = remitSnap.child(dateKey).val() || {};

    let remitAmt = _num(serverNode.amount);
    let remitRemarks =
      serverNode.remarks == null ? "" : String(serverNode.remarks);
    let remitBadge = "";

    const hasPendingRemittance = Object.prototype.hasOwnProperty.call(
      pendingRemitByDateKey,
      dateKey
    );

    if (hasPendingRemittance) {
      const pendingRemit = pendingRemitByDateKey[dateKey] || {};

      remitAmt = _num(pendingRemit.amount);
      remitRemarks =
        pendingRemit.remarks == null
          ? ""
          : String(pendingRemit.remarks);

      remitBadge = ` <span class="badge-pending">PENDING</span>`;
      pendingRemitCount++;
    }

    totalIncome += incomeTotal;
    totalRemit += remitAmt;
    totalPendingIncome += incomePending;

    const safeRemarksHtml = remitRemarks
      ? _cashBookEscapeHtml(remitRemarks)
      : "-";

    html += `<tr>
      <td>${_cashBookEscapeHtml(displayDate)}</td>
      <td style="color:#2E7D32; font-weight:bold;">
        ${incomeTotal > 0 ? incomeTotal.toFixed(2) : "-"}
        ${
          incomePending !== 0
            ? ` <span class="badge-pending">+pending</span>`
            : ""
        }
      </td>
      <td style="color:#1976D2; font-weight:bold;">
        ${remitAmt > 0 ? remitAmt.toFixed(2) : "-"}${remitBadge}
      </td>
      <td>${safeRemarksHtml}</td>
      <td>
        <button
          type="button"
          data-cashbook-action="edit-remittance"
          data-date-key="${_cashBookEscapeHtml(dateKey)}"
          data-amount="${_cashBookEscapeHtml(remitAmt)}"
          data-remarks="${_cashBookEscapeHtml(remitRemarks)}"
          style="
            color:#2196F3;
            cursor:pointer;
            text-decoration:underline;
            font-weight:bold;
            border:0;
            background:transparent;
            padding:0;
            font:inherit;
          "
        >Edit</button>
      </td>
    </tr>`;
  }

  tbody.innerHTML = html;

  const incomeElement = document.getElementById("abIncome");
  const remitElement = document.getElementById("abRemit");

  if (incomeElement) {
    incomeElement.innerText = `₹ ${totalIncome.toFixed(2)}`;
  }

  if (remitElement) {
    remitElement.innerText = `₹ ${totalRemit.toFixed(2)}`;
  }

  const note = document.getElementById("pendingNote");

  if (note) {
    note.innerText =
      pendingOpsCount > 0
        ? `Note: ${pendingOpsCount} pending ops (Income pending: ₹${totalPendingIncome.toFixed(
            2
          )}, Remit pending edits: ${pendingRemitCount})`
        : "";
  }

  await calculateAbstractBalance(
    month,
    year,
    totalIncome,
    totalRemit,
    pendingOpsCount
  );
}


async function calculateAbstractBalance(
  month,
  year,
  income,
  remit,
  pendingOperationsCount
) {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);

  if (
    !Number.isInteger(m) ||
    m < 1 ||
    m > 12 ||
    !Number.isInteger(y) ||
    y < 1
  ) {
    return;
  }

  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;

  const prevKey = `${String(prevMonth).padStart(2, "0")}-${prevYear}`;
  const curKey = `${String(m).padStart(2, "0")}-${y}`;

  const snap = await db
    .ref("Balances/" + prevKey + "/closingBalance")
    .once("value");

  const opening = _num(snap.val());
  const closing = opening + _num(income) - _num(remit);

  const openingElement = document.getElementById("abOpening");
  const closingElement = document.getElementById("abClosing");

  if (openingElement) {
    openingElement.innerText = `₹ ${opening.toFixed(2)}`;
  }

  if (closingElement) {
    closingElement.innerText = `₹ ${closing.toFixed(2)}`;
  }

  const suppliedPendingCount = _cashBookNormalizeCount(
    pendingOperationsCount
  );

  const safePendingCount = Math.max(
    suppliedPendingCount === null ? 0 : suppliedPendingCount,
    _cashBookGetPendingCount({})
  );

  if (
    typeof isConnected !== "undefined" &&
    isConnected &&
    safePendingCount === 0
  ) {
    try {
      await db.ref("Balances/" + curKey + "/closingBalance").set(closing);
    } catch (error) {
      console.error("Unable to save closing balance:", error);
    }
  }
}


let currentRemitDateKey = "";


function editRemittance(dateKey, oldAmt, oldRemarks) {
  currentRemitDateKey = String(dateKey || "");

  const dateElement = document.getElementById("remitModalDate");
  const amountElement = document.getElementById("remitModalAmt");
  const remarksElement = document.getElementById("remitModalRemarks");
  const modal = document.getElementById("remitModal");

  if (dateElement) {
    dateElement.innerText = "Date: " + currentRemitDateKey;
  }

  if (amountElement) {
    amountElement.value = oldAmt > 0 ? oldAmt : "";
  }

  if (remarksElement) {
    remarksElement.value = oldRemarks || "";
  }

  if (!modal) {
    return;
  }

  modal.style.display = "flex";

  setTimeout(() => {
    const amountInput = document.getElementById("remitModalAmt");

    if (amountInput) {
      amountInput.focus();
    }
  }, 100);
}


function closeRemitModal() {
  const modal = document.getElementById("remitModal");

  if (modal) {
    modal.style.display = "none";
  }
}


async function submitRemitModal() {
  const amountElement = document.getElementById("remitModalAmt");
  const remarksElement = document.getElementById("remitModalRemarks");

  if (!amountElement || !remarksElement || !currentRemitDateKey) {
    return;
  }

  const amtStr = amountElement.value;
  const remarks = remarksElement.value;

  const data = {
    amount: _num(amtStr),
    remarks: remarks || ""
  };

  await queuePut({
    opId: "remit:" + currentRemitDateKey,
    type: "remit",
    dateKey: currentRemitDateKey,
    data
  });

  closeRemitModal();
  showToast("Remittance saved (sync pending if offline)", "success", 2200);
  loadAdminData();
  syncPendingOps();
}