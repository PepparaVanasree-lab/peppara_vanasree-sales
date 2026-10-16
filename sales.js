// sales.js
// =========================
// Billing & Sales Management (Zero-Drift Deterministic Sync & Merge)
// =========================

function updateSalesStockDetails() {
  const sel = document.getElementById("salesItemSelect");
  const lbl = document.getElementById("lblSalesAvailableStock");
  if (!sel || !lbl) return;

  const name = sel.value;
  const it = itemsData ? itemsData[name] : null;
  lbl.innerText = "Stock: " + (it ? it.stock : 0);

  calculateTotalAmount();
}

function calculateTotalAmount() {
  const sel = document.getElementById("salesItemSelect");
  const qtyEl = document.getElementById("saleQty");
  const totalEl = document.getElementById("saleTotalAmt");
  if (!sel || !qtyEl || !totalEl) return;

  const name = sel.value;
  const qty = parseInt(qtyEl.value, 10) || 0;
  const it = itemsData ? itemsData[name] : null;

  if (!it || qty <= 0) {
    totalEl.innerText = "₹ 0.00";
    return;
  }

  const unitMrp = Number(it.mrp) || 0;
  totalEl.innerText = "₹ " + (qty * unitMrp).toFixed(2);
}

function getFormattedDate(dateString) {
  if (!dateString) return "";
  const p = dateString.split("-");
  if (p.length !== 3) return "";
  return `${p[2]}/${p[1]}/${p[0]}`;
}

// =========================
// Save Bill (auto-merge: pending → server editSale → new sale)
// =========================
async function saveBill(btn) {
  await queueReady;

  const dateRaw = document.getElementById("saleDate")?.value;
  const formattedDate = getFormattedDate(dateRaw);

  const sel = document.getElementById("salesItemSelect");
  const qtyEl = document.getElementById("saleQty");
  const totalEl = document.getElementById("saleTotalAmt");

  const name = (sel?.value || "").trim();
  const item = itemsData ? itemsData[name] : null;

  if (!formattedDate) {
    alert("Date തിരഞ്ഞെടുക്കുക!");
    return;
  }
  if (!item) {
    alert("Item select ചെയ്യുക!");
    return;
  }

  const qtyNum = parseInt(qtyEl?.value || "", 10);
  if (!qtyNum || qtyNum <= 0) {
    alert("ശരിയായ എണ്ണം നൽകുക!");
    return;
  }
  if (qtyNum > (Number(item.stock) || 0)) {
    alert("സ്റ്റോക്ക് ലഭ്യമല്ല!");
    return;
  }

  const unitMrp = Number(item.mrp) || 0;
  const addedAmt = Number((qtyNum * unitMrp).toFixed(2));
  const dateKey = formattedDate.replaceAll("/", "-");

  // UX: immediately reset input (queuePut persists operation anyway)
  flashButton(btn, { state: "success", text: "✔ ബിൽ സേവ് ചെയ്തു!" });
  if (qtyEl) qtyEl.value = "";
  if (totalEl) totalEl.innerText = "₹ 0.00";

  // 1) Same-day same-item already pending locally? Merge into the pending sale op.
  const summary = await getPendingSummary();
  const pendingAdds = summary.pendingSalesByDate[formattedDate] || [];
  const existingPendingAdd = pendingAdds.find((op) => (op.itemName || "").trim() === name);

  if (existingPendingAdd) {
    existingPendingAdd.qty = (Number(existingPendingAdd.qty) || 0) + qtyNum;
    existingPendingAdd.amount = Number(
      ((Number(existingPendingAdd.amount) || 0) + addedAmt).toFixed(2)
    );

    if (existingPendingAdd.saleData) {
      existingPendingAdd.saleData.quantity = existingPendingAdd.qty;
      existingPendingAdd.saleData.amount = existingPendingAdd.amount;
    }

    await queuePut(existingPendingAdd);

    showToast(
      `മുമ്പത്തെ ബില്ലിനൊപ്പം ചേർത്തു! (ആകെ എണ്ണം: ${existingPendingAdd.qty})`,
      "success",
      2500
    );
    syncPendingOps();
    return;
  }

  // 2) If online, check server for same-day same-item and queue an editSale instead of creating duplicate
  if (isConnected) {
    try {
      const snap = await db
        .ref("Sales")
        .orderByChild("date")
        .equalTo(formattedDate)
        .once("value");

      let matchedServerSale = null;
      let matchedServerSaleId = null;

      snap.forEach((child) => {
        const s = child.val();
        const sId = (s && s.id) || child.key;

        // Do not merge into something the user has already deleted locally (pending delete)
        if (
          s &&
          !summary.pendingDeleteSaleIds.has(sId) &&
          (s.itemName || "").trim() === name
        ) {
          if (!matchedServerSale) {
            matchedServerSale = s;
            matchedServerSaleId = sId;
          }
        }
      });

      if (matchedServerSale && matchedServerSaleId) {
        // If an editSale already exists locally for this saleId, extend it further.
        const existingEditOp = await queueGet("editSale:" + matchedServerSaleId);

        const baseOldQty = existingEditOp
          ? existingEditOp.oldQty
          : Number(matchedServerSale.quantity) || 0;
        const baseOldAmt = existingEditOp
          ? existingEditOp.oldAmt
          : Number(matchedServerSale.amount) || 0;

        const currentQty = existingEditOp ? existingEditOp.newQty : baseOldQty;
        const currentAmt = existingEditOp ? existingEditOp.newAmt : baseOldAmt;

        const newQty = currentQty + qtyNum;
        const newAmt = Number((currentAmt + addedAmt).toFixed(2));

        await queuePut({
          opId: "editSale:" + matchedServerSaleId,
          type: "editSale",
          saleId: matchedServerSaleId,
          dateKey,
          formattedDate,
          itemId: item.id,
          itemName: name,
          oldQty: baseOldQty,
          newQty,
          qtyDiff: newQty - baseOldQty,
          oldAmt: baseOldAmt,
          newAmt,
          amtDiff: Number((newAmt - baseOldAmt).toFixed(2))
        });

        showToast(
          `മുമ്പത്തെ ബില്ലിനൊപ്പം ചേർത്തു! (ആകെ എണ്ണം: ${newQty})`,
          "success",
          2500
        );
        syncPendingOps();
        return;
      }
    } catch (e) {
      console.warn("Could not check existing sales:", e);
    }
  }

  // 3) Otherwise create a new sale entry (queued)
  const saleId = db.ref("Sales").push().key;
  const saleData = {
    id: saleId,
    itemId: item.id,
    date: formattedDate,
    itemName: name,
    quantity: qtyNum,
    amount: addedAmt
  };

  await queuePut({
    opId: "sale:" + saleId,
    type: "sale",
    saleId,
    dateKey,
    formattedDate,
    itemId: item.id,
    itemName: name,
    qty: qtyNum,
    amount: addedAmt,
    saleData
  });

  syncPendingOps();
}

// =========================
// View / Edit Sales list (server + pending overlay)
// =========================
async function loadSalesList() {
  const dateRaw = document.getElementById("filterSaleDate")?.value;
  const formattedDate = getFormattedDate(dateRaw);
  const tbody = document.getElementById("salesListBody");

  if (!tbody) return;

  if (!formattedDate) {
    tbody.innerHTML = "<tr><td colspan='4'>Date തിരഞ്ഞെടുക്കുക</td></tr>";
    return;
  }

  await queueReady;
  const summary = await getPendingSummary();
  const pendingAdds = summary.pendingSalesByDate[formattedDate] || [];
  const deletedIds = summary.pendingDeleteSaleIds;

  const pendingEditsMap = {};
  for (const op of summary.ops) {
    if (op.type === "editSale") pendingEditsMap[op.saleId] = op;
  }

  db.ref("Sales")
    .orderByChild("date")
    .equalTo(formattedDate)
    .once("value", (snap) => {
      tbody.innerHTML = "";

      // Pending new sales first
      for (const op of pendingAdds) {
        const s = op.saleData;
        if (!s) continue;

        const safeName = escHtml(s.itemName);

        tbody.innerHTML += `<tr style="background:#FFFDE7;">
          <td style="text-align:left;">${safeName} <span class="badge-pending">PENDING</span></td>
          <td>${s.quantity}</td>
          <td>₹ ${Number(s.amount).toFixed(2)}</td>
          <td>
            <button class="edit-btn" onclick='editSale(${js(
              s.id
            )}, ${js(s.itemName)}, ${s.quantity}, ${s.amount}, ${js(
          s.date
        )})'>Edit</button>
            <button class="delete-btn" onclick='cancelPendingSale(${js(
              op.opId
            )})'>Cancel</button>
          </td>
        </tr>`;
      }

      // Server sales (excluding pending deletes), overlay pending edits
      const serverSales = [];
      snap.forEach((child) => {
        const sale = child.val();
        if (!sale) return;
        sale.id = sale.id || child.key;
        if (deletedIds.has(sale.id)) return;
        serverSales.push(sale);
      });

      serverSales.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));

      for (const sale of serverSales) {
        let q = Number(sale.quantity) || 0;
        let a = Number(sale.amount) || 0;
        let badge = "";

        if (pendingEditsMap[sale.id]) {
          q = pendingEditsMap[sale.id].newQty;
          a = pendingEditsMap[sale.id].newAmt;
          badge = ` <span class="badge-pending">EDITED</span>`;
        }

        const safeName = escHtml(sale.itemName);

        tbody.innerHTML += `<tr>
          <td style="text-align:left;">${safeName}${badge}</td>
          <td>${q}</td>
          <td>₹ ${a.toFixed(2)}</td>
          <td>
            <button class="edit-btn" onclick='editSale(${js(
              sale.id
            )}, ${js(sale.itemName)}, ${q}, ${a}, ${js(
          sale.date
        )})'>Edit</button>
            <button class="delete-btn" onclick='deleteSale(${js(
              sale.id
            )}, ${js(sale.itemName)}, ${q}, ${a}, ${js(
          sale.date
        )})'>Delete</button>
          </td>
        </tr>`;
      }

      if (serverSales.length === 0 && pendingAdds.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4'>ബില്ലുകൾ ലഭ്യമല്ല</td></tr>";
      }
    });
}

// =========================
// Edit Sale (pending sale edits in-place)
// =========================
async function editSale(saleId, itemName, currentShownQty, currentShownAmt, saleDateStr) {
  await queueReady;

  const cleanName = (itemName || "").trim();
  const item = itemsData ? itemsData[cleanName] : null;
  if (!item) {
    alert("ഈ ഐറ്റം സ്റ്റോക്ക് ലിസ്റ്റിൽ കണ്ടെത്താനായില്ല!");
    return;
  }

  const shownQty = Number(currentShownQty) || 0;
  const shownAmt = Number(currentShownAmt) || 0;

  const maxAllowedQty = (Number(item.stock) || 0) + shownQty;

  const newQtyStr = prompt(
    `'${cleanName}'\nനിലവിലെ ബില്ലിലെ എണ്ണം: ${shownQty}\nപുതിയ ശരിയായ എണ്ണം (Qty) നൽകുക (പരമാവധി ലഭ്യമായത്: ${maxAllowedQty}):`,
    String(shownQty)
  );
  if (newQtyStr === null) return;

  const newQty = parseInt(newQtyStr, 10);
  if (isNaN(newQty) || newQty <= 0) {
    alert("ശരിയായ എണ്ണം നൽകുക! (മുഴുവനായി ഒഴിവാക്കാനാണെങ്കിൽ Delete ബട്ടൺ ഉപയോഗിക്കുക)");
    return;
  }
  if (newQty === shownQty) return;
  if (newQty > maxAllowedQty) {
    alert(`അത്രയും സ്റ്റോക്ക് ലഭ്യമല്ല! പരമാവധി ${maxAllowedQty} എണ്ണം വരെ നൽകാം.`);
    return;
  }

  const unitPrice = (shownQty > 0 ? shownAmt / shownQty : 0) || Number(item.mrp) || 0;
  const newAmt = Number((newQty * unitPrice).toFixed(2));
  const dateKey = (saleDateStr || "").replaceAll("/", "-");

  // If this sale is still only a pending "sale:" op, edit that op in-place
  const pendingAddOp = await queueGet("sale:" + saleId);
  if (pendingAddOp) {
    pendingAddOp.qty = newQty;
    pendingAddOp.amount = newAmt;
    if (pendingAddOp.saleData) {
      pendingAddOp.saleData.quantity = newQty;
      pendingAddOp.saleData.amount = newAmt;
    }
    await queuePut(pendingAddOp);
  } else {
    // Otherwise queue/overwrite an editSale op against server saleId
    const existingEditOp = await queueGet("editSale:" + saleId);
    const baseOldQty = existingEditOp ? existingEditOp.oldQty : shownQty;
    const baseOldAmt = existingEditOp ? existingEditOp.oldAmt : shownAmt;

    await queuePut({
      opId: "editSale:" + saleId,
      type: "editSale",
      saleId,
      dateKey,
      formattedDate: saleDateStr,
      itemId: item.id,
      itemName: cleanName,
      oldQty: baseOldQty,
      newQty,
      qtyDiff: newQty - baseOldQty,
      oldAmt: baseOldAmt,
      newAmt,
      amtDiff: Number((newAmt - baseOldAmt).toFixed(2))
    });
  }

  showToast("ബിൽ വിവരങ്ങൾ അപ്ഡേറ്റ് ചെയ്തു!", "success");
  loadSalesList();
  syncPendingOps();
}

// =========================
// Cancel pending (offline-created) sale
// =========================
async function cancelPendingSale(opId) {
  await queueReady;

  const op = await queueGet(opId);
  if (!op || op.type !== "sale") return;

  await queueDelete(opId);
  showToast("Sale cancelled", "success");
  loadSalesList();
}

// =========================
// Delete Sale (server sale)
// =========================
async function deleteSale(saleId, itemName, currentShownQty, currentShownAmt, saleDateStr) {
  await queueReady;

  if (!confirm("ഈ ബിൽ ഡിലീറ്റ് ചെയ്യണോ?")) return;

  // If it's a pending sale, cancel it instead
  const pendingAddOp = await queueGet("sale:" + saleId);
  if (pendingAddOp) {
    await cancelPendingSale("sale:" + saleId);
    return;
  }

  const cleanName = (itemName || "").trim();
  const item = itemsData ? itemsData[cleanName] : null;
  if (!item) return;

  // If a pending edit exists, remove it first; delete should revert server baseline
  const existingEditOp = await queueGet("editSale:" + saleId);
  if (existingEditOp) {
    await queueDelete("editSale:" + saleId);
  }

  const shownQty = Number(currentShownQty) || 0;
  const shownAmt = Number(currentShownAmt) || 0;

  const serverRevertQty = existingEditOp ? existingEditOp.oldQty : shownQty;
  const serverRevertAmt = existingEditOp ? existingEditOp.oldAmt : shownAmt;

  const dateKey = (saleDateStr || "").replaceAll("/", "-");

  await queuePut({
    opId: "delSale:" + saleId,
    type: "deleteSale",
    saleId,
    dateKey,
    formattedDate: saleDateStr,
    itemId: item.id,
    itemName: cleanName,
    qty: serverRevertQty,
    amount: serverRevertAmt
  });

  showToast("ബിൽ ഡിലീറ്റ് ചെയ്തു", "success");
  loadSalesList();
  syncPendingOps();
}