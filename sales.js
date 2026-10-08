// =========================
// Billing & Sales Management
// =========================
function updateSalesStockDetails() {
  const name = document.getElementById("salesItemSelect").value;
  const it = itemsData[name];
  document.getElementById("lblSalesAvailableStock").innerText = "Stock: " + (it ? it.stock : 0);
  calculateTotalAmount();
}

function calculateTotalAmount() {
  const name = document.getElementById("salesItemSelect").value;
  const qty = parseFloat(document.getElementById("saleQty").value) || 0;
  const it = itemsData[name];
  if (!it) { document.getElementById("saleTotalAmt").innerText = "₹ 0.00"; return; }
  document.getElementById("saleTotalAmt").innerText = "₹ " + (qty * (parseFloat(it.mrp) || 0)).toFixed(2);
}

function getFormattedDate(dateString) {
  if (!dateString) return "";
  const p = dateString.split("-");
  return `${p[2]}/${p[1]}/${p[0]}`;
}

async function saveBill(btn) {
  const dateRaw = document.getElementById("saleDate").value;
  const formattedDate = getFormattedDate(dateRaw);
  const name = document.getElementById("salesItemSelect").value;
  const item = itemsData[name];

  if (!formattedDate) { alert("Date തിരഞ്ഞെടുക്കുക!"); return; }
  if (!item) { alert("Item select ചെയ്യുക!"); return; }

  const qtyNum = parseInt(document.getElementById("saleQty").value, 10);
  if (!qtyNum || qtyNum <= 0) { alert("ശരിയായ എണ്ണം നൽകുക!"); return; }
  if (qtyNum > item.stock) { alert("സ്റ്റോക്ക് ലഭ്യമല്ല!"); return; }

  const totalAmt = qtyNum * parseFloat(item.mrp);

  flashButton(btn, { state: "success", text: "✔ ബിൽ സേവ് ചെയ്തു!" });
  document.getElementById("saleQty").value = "";
  document.getElementById("saleTotalAmt").innerText = "₹ 0.00";

  const saleId = db.ref("Sales").push().key;
  const dateKey = formattedDate.replaceAll("/", "-");

  const saleData = {
    id: saleId, date: formattedDate, itemName: name,
    quantity: qtyNum, amount: Number(totalAmt.toFixed(2))
  };

  await queuePut({
    opId: "sale:" + saleId, type: "sale", saleId, dateKey,
    itemId: item.id, itemName: name, qty: qtyNum,
    amount: Number(totalAmt.toFixed(2)), saleData
  });

  item.stock = Math.max(0, item.stock - qtyNum);
  updateSalesStockDetails();
  syncPendingOps();
}

async function loadSalesList() {
  const formattedDate = getFormattedDate(document.getElementById("filterSaleDate").value);
  const tbody = document.getElementById("salesListBody");
  if (!formattedDate) { tbody.innerHTML = "<tr><td colspan='4'>Date തിരഞ്ഞെടുക്കുക</td></tr>"; return; }

  const summary = await getPendingSummary();
  const pendingAdds = summary.pendingSalesByDate[formattedDate] || [];
  const deletedIds = summary.pendingDeleteSaleIds;

  db.ref("Sales").orderByChild("date").equalTo(formattedDate).once("value", snap => {
    tbody.innerHTML = "";
    for (const op of pendingAdds) {
      const s = op.saleData;
      tbody.innerHTML += `<tr style="background:#FFFDE7;">
        <td style="text-align:left;">${s.itemName} <span class="badge-pending">PENDING</span></td>
        <td>${s.quantity}</td><td>₹ ${Number(s.amount).toFixed(2)}</td>
        <td><button class="delete-btn" onclick='cancelPendingSale(${js(op.opId)})'>Cancel</button></td>
      </tr>`;
    }

    let anyServer = false;
    snap.forEach(child => {
      const sale = child.val();
      if (deletedIds.has(sale.id)) return;
      anyServer = true;
      const q = Number(sale.quantity) || 0;
      const a = Number(sale.amount) || 0;
      tbody.innerHTML += `<tr>
        <td style="text-align:left;">${sale.itemName}</td><td>${q}</td><td>₹ ${a.toFixed(2)}</td>
        <td><button class="delete-btn" onclick='deleteSale(${js(sale.id)}, ${js(sale.itemName)}, ${q}, ${a}, ${js(sale.date)})'>Delete</button></td>
      </tr>`;
    });
    if (!anyServer && pendingAdds.length === 0) tbody.innerHTML = "<tr><td colspan='4'>ബില്ലുകൾ ലഭ്യമല്ല</td></tr>";
  });
}

async function cancelPendingSale(opId) {
  const op = await queueGet(opId);
  if (!op || op.type !== "sale") return;
  if (itemsData[op.itemName]) itemsData[op.itemName].stock += op.qty;
  await queueDelete(opId);
  showToast("Sale cancelled", "success");
  updateSalesStockDetails();
  loadSalesList();
}

async function deleteSale(saleId, itemName, qty, amt, saleDateStr) {
  if (!confirm("ഈ ബിൽ ഡിലീറ്റ് ചെയ്യണോ?")) return;
  const pendingAddOp = await queueGet("sale:" + saleId);
  if (pendingAddOp) { await cancelPendingSale("sale:" + saleId); return; }

  const item = itemsData[itemName];
  if (!item) return;

  const dateKey = saleDateStr.replaceAll("/", "-");
  await queuePut({
    opId: "delSale:" + saleId, type: "deleteSale", saleId, dateKey,
    itemId: item.id, itemName, qty: parseInt(qty,10)||0, amount: Number(amt)||0
  });

  item.stock += parseInt(qty,10)||0;
  updateSalesStockDetails();
  showToast("Delete queued", "success");
  loadSalesList();
  syncPendingOps();
}