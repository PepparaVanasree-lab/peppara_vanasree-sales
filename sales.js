// sales.js
// =========================
// Billing & Sales Management (with Edit & Delete support)
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
  if (!it) {
    document.getElementById("saleTotalAmt").innerText = "₹ 0.00";
    return;
  }
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

  // Map any pending edits so UI shows updated quantity/amount immediately
  const pendingEditsMap = {};
  for (const op of summary.ops) {
    if (op.type === "editSale") {
      pendingEditsMap[op.saleId] = op;
    }
  }

  db.ref("Sales").orderByChild("date").equalTo(formattedDate).once("value", snap => {
    tbody.innerHTML = "";
    for (const op of pendingAdds) {
      const s = op.saleData;
      tbody.innerHTML += `<tr style="background:#FFFDE7;">
        <td style="text-align:left;">${s.itemName} <span class="badge-pending">PENDING</span></td>
        <td>${s.quantity}</td><td>₹ ${Number(s.amount).toFixed(2)}</td>
        <td>
          <button class="edit-btn" onclick='editSale(${js(s.id)}, ${js(s.itemName)}, ${s.quantity}, ${s.amount}, ${js(s.date)})'>Edit</button>
          <button class="delete-btn" onclick='cancelPendingSale(${js(op.opId)})'>Cancel</button>
        </td>
      </tr>`;
    }

    let anyServer = false;
    snap.forEach(child => {
      const sale = child.val();
      if (!sale || deletedIds.has(sale.id)) return;
      anyServer = true;

      let q = Number(sale.quantity) || 0;
      let a = Number(sale.amount) || 0;
      let badge = "";

      if (pendingEditsMap[sale.id]) {
        q = pendingEditsMap[sale.id].newQty;
        a = pendingEditsMap[sale.id].newAmt;
        badge = ` <span class="badge-pending">EDITED</span>`;
      }

      tbody.innerHTML += `<tr>
        <td style="text-align:left;">${sale.itemName}${badge}</td>
        <td>${q}</td>
        <td>₹ ${a.toFixed(2)}</td>
        <td>
          <button class="edit-btn" onclick='editSale(${js(sale.id)}, ${js(sale.itemName)}, ${q}, ${a}, ${js(sale.date)})'>Edit</button>
          <button class="delete-btn" onclick='deleteSale(${js(sale.id)}, ${js(sale.itemName)}, ${q}, ${a}, ${js(sale.date)})'>Delete</button>
        </td>
      </tr>`;
    });
    if (!anyServer && pendingAdds.length === 0) {
      tbody.innerHTML = "<tr><td colspan='4'>ബില്ലുകൾ ലഭ്യമല്ല</td></tr>";
    }
  });
}

async function editSale(saleId, itemName, oldQty, oldAmt, saleDateStr) {
  const item = itemsData[itemName];
  if (!item) { alert("ഈ ഐറ്റം സ്റ്റോക്ക് ലിസ്റ്റിൽ കണ്ടെത്താനായില്ല!"); return; }

  const maxAllowedQty = item.stock + oldQty;
  const newQtyStr = prompt(
    `'${itemName}'\nനിലവിലെ ബില്ലിലെ എണ്ണം: ${oldQty}\nപുതിയ ശരിയായ എണ്ണം (Qty) നൽകുക (പരമാവധി ലഭ്യമായത്: ${maxAllowedQty}):`,
    oldQty
  );
  if (newQtyStr === null) return;

  const newQty = parseInt(newQtyStr, 10);
  if (isNaN(newQty) || newQty <= 0) {
    alert("ശരിയായ എണ്ണം നൽകുക! (മുഴുവനായി ഒഴിവാക്കാനാണെങ്കിൽ Delete ബട്ടൺ ഉപയോഗിക്കുക)");
    return;
  }
  if (newQty === oldQty) return;
  if (newQty > maxAllowedQty) {
    alert(`അത്രയും സ്റ്റോക്ക് ലഭ്യമല്ല! പരമാവധി ${maxAllowedQty} എണ്ണം വരെ നൽകാം.`);
    return;
  }

  const unitPrice = parseFloat(item.mrp) || (oldQty > 0 ? (oldAmt / oldQty) : 0);
  const newAmt = Number((newQty * unitPrice).toFixed(2));
  const qtyDiff = newQty - oldQty; // positive if increased, negative if reduced
  const amtDiff = Number((newAmt - oldAmt).toFixed(2));
  const dateKey = saleDateStr.replaceAll("/", "-");

  // If this sale is still sitting in offline queue (not yet synced), update it directly
  const pendingAddOp = await queueGet("sale:" + saleId);
  if (pendingAddOp) {
    pendingAddOp.qty = newQty;
    pendingAddOp.amount = newAmt;
    pendingAddOp.saleData.quantity = newQty;
    pendingAddOp.saleData.amount = newAmt;
    await queuePut(pendingAddOp);
  } else {
    // If another edit was already queued for this saleId, merge with original values
    const existingEditOp = await queueGet("editSale:" + saleId);
    const baseOldQty = existingEditOp ? existingEditOp.oldQty : oldQty;
    const baseOldAmt = existingEditOp ? existingEditOp.oldAmt : oldAmt;

    await queuePut({
      opId: "editSale:" + saleId,
      type: "editSale",
      saleId,
      dateKey,
      itemId: item.id,
      itemName,
      oldQty: baseOldQty,
      newQty,
      qtyDiff: newQty - baseOldQty,
      oldAmt: baseOldAmt,
      newAmt,
      amtDiff: Number((newAmt - baseOldAmt).toFixed(2))
    });
  }

  item.stock = Math.max(0, item.stock - qtyDiff);
  updateSalesStockDetails();
  showToast("ബിൽ വിവരങ്ങൾ അപ്ഡേറ്റ് ചെയ്തു!", "success");
  loadSalesList();
  syncPendingOps();
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

  // Remove any pending edit for this sale before deleting
  const existingEditOp = await queueGet("editSale:" + saleId);
  if (existingEditOp) {
    await queueDelete("editSale:" + saleId);
  }

  const item = itemsData[itemName];
  if (!item) return;

  const origQty = existingEditOp ? existingEditOp.oldQty : (parseInt(qty, 10) || 0);
  const origAmt = existingEditOp ? existingEditOp.oldAmt : (Number(amt) || 0);

  const dateKey = saleDateStr.replaceAll("/", "-");
  await queuePut({
    opId: "delSale:" + saleId, type: "deleteSale", saleId, dateKey,
    itemId: item.id, itemName, qty: origQty, amount: origAmt
  });

  item.stock += parseInt(qty, 10) || 0;
  updateSalesStockDetails();
  showToast("ബിൽ ഡിലീറ്റ് ചെയ്തു", "success");
  loadSalesList();
  syncPendingOps();
}