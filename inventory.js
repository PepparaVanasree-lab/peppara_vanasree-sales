// inventory.js
// =========================
// Inventory, Purchase, Return & Bulk Import
// =========================

let currentStockModalMode = "purchase"; // "purchase" | "return"
let itemsListener = null;

// Small helpers
const normalizeName = (s) => (s || "").trim();
const toInt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
};
const toMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
};
// Prevent HTML injection in table rendering (optional but safer)
const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

// =========================
// Inventory Search Filter
// =========================
function filterItems() {
  const input = document.getElementById("searchItem").value.toUpperCase();
  const trs = document.getElementById("invTable").getElementsByTagName("tr");
  for (let i = 1; i < trs.length; i++) {
    const td = trs[i].getElementsByTagName("td")[0];
    if (td) {
      const txtValue = td.textContent || td.innerText;
      trs[i].style.display = txtValue.toUpperCase().indexOf(input) > -1 ? "" : "none";
    }
  }
}

// =========================
// Load Items + Render Inventory
// =========================
function loadItemsFromFirebase() {
  // Detach previous listener (avoid duplicate listeners)
  if (itemsListener) db.ref("Items").off("value", itemsListener);

  itemsListener = async (snapshot) => {
    const addSalesSelect = document.getElementById("salesItemSelect");
    const invBody = document.getElementById("inventoryListBody");
    const importBtn = document.getElementById("importBtn");

    // Keep current selected item if possible
    const prevSelected = addSalesSelect.value;

    addSalesSelect.innerHTML = "";
    invBody.innerHTML = "";
    itemsData = {};

    // Build itemsData map (unique by trimmed name)
    snapshot.forEach((child) => {
      const item = child.val();
      if (!item || !item.itemName) return;

      item.id = item.id || child.key; // Guarantee id exists

      const cleanName = normalizeName(item.itemName);
      const stockNum = toInt(item.stock);
      const mrpNum = toMoney(item.mrp);

      // Detect duplicates (same name, different IDs)
      if (itemsData[cleanName] && itemsData[cleanName].id !== item.id) {
        console.warn("Duplicate itemName in DB:", cleanName, itemsData[cleanName].id, item.id);
      }

      item.itemName = cleanName;
      item.baseStock = stockNum;
      item.stock = stockNum;
      item.mrp = mrpNum;

      itemsData[cleanName] = item;
    });

    // Apply pending-queue stock delta (offline ops)
    const summary = await getPendingSummary();
    for (const name in itemsData) {
      const it = itemsData[name];
      const delta = summary.stockDeltaByItemId[it.id] || 0;
      it.stock = Math.max(0, (it.baseStock || 0) + delta);
    }

    // Import button logic based on missing BULK items
    const bulk = (typeof BULK_DATA !== "undefined" && Array.isArray(BULK_DATA)) ? BULK_DATA : [];
    const existing = new Set(Object.keys(itemsData).map(normalizeName));
    const missingCount = bulk.filter((x) => !existing.has(normalizeName(x[0]))).length;

    if (!bulk.length) {
      // If BULK_DATA not loaded, hide button to avoid errors
      importBtn.style.display = "none";
    } else if (missingCount === 0) {
      importBtn.style.display = "none";
    } else {
      importBtn.style.display = "block";
      importBtn.disabled = false;
      importBtn.innerText =
        missingCount === TOTAL_IMPORT_ITEMS
          ? "⚡ IMPORT ALL ITEMS"
          : `⚡ IMPORT REMAINING ITEMS (${missingCount} left)`;
    }

    // Render UI from unique sorted names
    const names = Object.keys(itemsData).sort((a, b) => a.localeCompare(b));

    let rowsHtml = "";
    for (const name of names) {
      const it = itemsData[name];

      // Dropdown is safe (no HTML parsing)
      addSalesSelect.add(new Option(it.itemName, it.itemName));

      // Table rows (escape itemName)
      rowsHtml += `<tr>
        <td style="text-align:left;">${escHtml(it.itemName)}</td>
        <td style="font-weight:bold;">${it.stock}</td>
        <td>₹${Number(it.mrp).toFixed(2)}</td>
        <td>
          <button class="edit-btn" onclick='editInvItem(${js(it.id)}, ${js(it.itemName)}, ${js(it.baseStock)}, ${js(it.mrp)})'>Edit</button>
          <button class="delete-btn" onclick='deleteInvItem(${js(it.id)}, ${js(it.itemName)})'>Delete</button>
        </td>
      </tr>`;
    }

    invBody.innerHTML = rowsHtml;

    // Restore previous selection if still exists
    if (prevSelected && itemsData[prevSelected]) addSalesSelect.value = prevSelected;

    updateSalesStockDetails();
  };

  db.ref("Items").on("value", itemsListener);
}

// =========================
// Bulk Import (Safe One-by-One + Progress + Listener Pause)
// =========================
async function bulkImportItems() {
  if (!isConnected) {
    showToast("Import ചെയ്യാൻ Internet വേണം (Online ആകുക)", "error", 3000);
    return;
  }
  if (!confirm("മുന്നറിയിപ്പ്: ഇത് ക്ലിക്ക് ചെയ്താൽ ബാക്കിയുള്ള എല്ലാ ഐറ്റങ്ങളും ആഡ് ആകുന്നതാണ്. തുടരണമോ?")) return;

  const importBtn = document.getElementById("importBtn");
  const originalText = importBtn.innerText;
  importBtn.disabled = true;

  // Pause listener during import (prevents re-render lag)
  if (itemsListener) db.ref("Items").off("value", itemsListener);

  try {
    if (typeof BULK_DATA === "undefined" || !Array.isArray(BULK_DATA) || BULK_DATA.length === 0) {
      alert("BULK_DATA is missing. Please check data.js loading.");
      return;
    }

    // Read existing names from DB (resume-safe)
    const snap = await db.ref("Items").once("value");
    const existingNames = new Set();
    snap.forEach((c) => {
      const val = c.val();
      if (val && val.itemName) existingNames.add(normalizeName(val.itemName));
    });

    const toImport = BULK_DATA.filter((x) => !existingNames.has(normalizeName(x[0])));

    if (toImport.length === 0) {
      showToast("All items already imported!", "success", 2200);
      importBtn.style.display = "none";
      return;
    }

    importBtn.innerText = `⏳ Importing... 0 / ${toImport.length}`;

    let done = 0;
    for (const it of toImport) {
      try {
        const itemId = db.ref("Items").push().key;
        await db.ref("Items/" + itemId).set({
          id: itemId,
          itemName: normalizeName(it[0]),
          mrp: toMoney(it[1]),
          stock: toInt(it[2])
        });
      } catch (itemErr) {
        alert("Failed at item: " + it[0] + "\n" + (itemErr.message || itemErr));
        throw itemErr;
      }

      done++;

      // Update UI progress every 5 items
      if (done % 5 === 0 || done === toImport.length) {
        importBtn.innerText = `⏳ Importing... ${done} / ${toImport.length}`;
      }

      // Yield occasionally to keep UI responsive
      if (done % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    showToast(`വിജയകരം! ${done} ഐറ്റങ്ങളും സ്റ്റോക്കിൽ ആഡ് ചെയ്തു.`, "success", 3000);
    importBtn.style.display = "none";

  } catch (e) {
    console.error("Import error:", e);
    showToast("Import failed: " + (e.message || e), "error", 5000);

  } finally {
    importBtn.disabled = false;
    importBtn.innerText = originalText;

    // Re-attach listener
    loadItemsFromFirebase();
  }
}

// =========================
// Inventory CRUD
// =========================
function addNewInvItem() {
  const name = normalizeName(document.getElementById("invNewName").value);
  const stock = toInt(document.getElementById("invNewStock").value);
  const mrp = toMoney(document.getElementById("invNewMrp").value);

  if (!name || !mrp) { alert("ഐറ്റത്തിന്റെ പേരും വിലയും നിർബന്ധമാണ്!"); return; }
  if (itemsData[name]) { alert("ഈ ഐറ്റം നിലവിലുണ്ട്!"); return; }

  const itemId = db.ref("Items").push().key;
  db.ref("Items/" + itemId).set({ id: itemId, itemName: name, stock, mrp })
    .then(() => {
      document.getElementById("invNewName").value = "";
      document.getElementById("invNewStock").value = "";
      document.getElementById("invNewMrp").value = "";
      showToast("Item added", "success");
    })
    .catch(() => showToast("Failed to add", "error"));
}

function editInvItem(id, currentName, currentStock, currentMrp) {
  const newName = prompt("പുതിയ പേര് നൽകുക:", currentName);
  if (newName === null || normalizeName(newName) === "") return;

  const newStock = prompt("സ്റ്റോക്ക് എത്രയാണ്?", currentStock);
  if (newStock === null) return;

  const newMrp = prompt("പുതിയ MRP നൽകുക:", currentMrp);
  if (newMrp === null) return;

  db.ref("Items/" + id).update({
    itemName: normalizeName(newName),
    stock: toInt(newStock),
    mrp: toMoney(newMrp)
  }).then(() => showToast("വിവരങ്ങൾ അപ്ഡേറ്റ് ചെയ്തു!", "success"));
}

function deleteInvItem(id, name) {
  if (!confirm(`"${name}" മായ്ച്ചു കളയണമെന്ന് ഉറപ്പാണോ?`)) return;
  db.ref("Items/" + id).remove().then(() => showToast("Deleted", "success"));
}

// =========================
// Dropdown Modal for Purchase & Return
// =========================
function openStockModal(mode) {
  const names = Object.keys(itemsData || {}).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    alert("സ്റ്റോക്കിൽ ഐറ്റങ്ങൾ ഒന്നും തന്നെയില്ല!");
    return;
  }

  currentStockModalMode = mode;
  const modal = document.getElementById("stockModal");
  const title = document.getElementById("stockModalTitle");
  const mrpWrap = document.getElementById("modalMrpWrap");
  const submitBtn = document.getElementById("modalSubmitBtn");

  document.getElementById("modalItemSearch").value = "";
  document.getElementById("modalQtyInput").value = "";
  document.getElementById("modalDateInput").value = new Date().toISOString().split("T")[0];

  if (mode === "purchase") {
    title.innerText = "➕ Add Purchase (പുതിയ സ്റ്റോക്ക് വരവ്)";
    title.style.color = "#2E7D32";
    title.style.borderBottomColor = "#4CAF50";
    mrpWrap.style.display = "block";
    submitBtn.style.background = "#2E7D32";
    submitBtn.innerText = "ADD PURCHASE";
  } else {
    title.innerText = "🔄 Return Stock (തിരികെ നൽകൽ)";
    title.style.color = "#d9534f";
    title.style.borderBottomColor = "#d9534f";
    mrpWrap.style.display = "none";
    submitBtn.style.background = "#d9534f";
    submitBtn.innerText = "RETURN STOCK";
  }

  populateModalDropdown("");
  modal.style.display = "flex";
}

function populateModalDropdown(filterText) {
  const select = document.getElementById("modalItemSelect");
  select.innerHTML = "";

  const q = normalizeName(filterText).toUpperCase();
  const names = Object.keys(itemsData || {}).sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    if (!q || name.toUpperCase().includes(q)) {
      select.add(new Option(name, name));
    }
  }
  onModalItemChange();
}

function filterModalItems() {
  const q = document.getElementById("modalItemSearch").value;
  populateModalDropdown(q);
}

function onModalItemChange() {
  const name = document.getElementById("modalItemSelect").value;
  const it = itemsData[name];
  const infoEl = document.getElementById("modalStockInfo");
  const mrpInput = document.getElementById("modalMrpInput");

  if (!it) {
    infoEl.innerText = "ഐറ്റം ലഭ്യമല്ല";
    mrpInput.value = "";
    return;
  }
  infoEl.innerText = `നിലവിലെ Stock: ${it.stock}  |  നിലവിലെ MRP: ₹${Number(it.mrp).toFixed(2)}`;
  mrpInput.value = Number(it.mrp);
}

function closeStockModal() {
  document.getElementById("stockModal").style.display = "none";
}

function addPurchasePrompt() {
  openStockModal("purchase");
}

function returnStockPrompt() {
  openStockModal("return");
}

async function submitStockModal() {
  let name = document.getElementById("modalItemSelect").value;
  if (!name || !itemsData[name]) {
    alert("ദയവായി ഒരു ഐറ്റം തിരഞ്ഞെടുക്കുക!");
    return;
  }

  const qty = toInt(document.getElementById("modalQtyInput").value);
  if (!qty) {
    alert("ശരിയായ എണ്ണം (Quantity) നൽകുക!");
    return;
  }

  const dateInput = document.getElementById("modalDateInput").value;
  if (!dateInput) {
    alert("തീയതി തിരഞ്ഞെടുക്കുക!");
    return;
  }

  const monthKey = dateInput.substring(0, 7);

  if (currentStockModalMode === "purchase") {
    const currentMrp = toMoney(itemsData[name].mrp);
    const enteredMrp = toMoney(document.getElementById("modalMrpInput").value);
    const newMrp = enteredMrp || currentMrp;

    let targetItem = itemsData[name];

    // If MRP changed, create/use a variant name "(₹NEW)"
    if (newMrp !== currentMrp) {
      const baseName = name.replace(/\s*\(₹\d+(\.\d+)?\)\s*$/, "").trim();
      const variantName = `${baseName} (₹${newMrp})`;

      if (itemsData[variantName]) {
        targetItem = itemsData[variantName];
        name = variantName;
      } else {
        if (!isConnected) {
          alert("വില വ്യത്യാസമുള്ള പുതിയ ഇനം ചേർക്കാൻ ഇന്റർനെറ്റ് കണക്ഷൻ ആവശ്യമാണ്!");
          return;
        }
        const newItemId = db.ref("Items").push().key;
        const newItemObj = { id: newItemId, itemName: variantName, stock: 0, baseStock: 0, mrp: newMrp };

        await db.ref("Items/" + newItemId).set({ id: newItemId, itemName: variantName, stock: 0, mrp: newMrp });

        itemsData[variantName] = newItemObj;
        targetItem = newItemObj;
        name = variantName;
      }
    }

    const purchaseId = db.ref("Purchases/" + monthKey).push().key;
    const data = { date: dateInput, itemName: name, quantity: qty, mrp: newMrp };

    await queuePut({
      opId: "purchase:" + purchaseId,
      type: "purchase",
      monthKey,
      purchaseId,
      itemId: targetItem.id,
      itemName: name,
      qty,
      data
    });

    targetItem.stock = (toInt(targetItem.stock) || 0) + qty;
    updateSalesStockDetails();
    closeStockModal();
    showToast(`Purchase added: ${name} (+${qty})`, "success", 2500);
    syncPendingOps();

  } else {
    // Return mode
    if (qty > toInt(itemsData[name].stock)) {
      alert("സ്റ്റോക്കിനേക്കാൾ കൂടുതൽ Return നൽകാൻ കഴിയില്ല!");
      return;
    }

    const returnId = db.ref("Returns/" + monthKey).push().key;
    const data = { date: dateInput, itemName: name, quantity: qty };

    await queuePut({
      opId: "return:" + returnId,
      type: "return",
      monthKey,
      returnId,
      itemId: itemsData[name].id,
      itemName: name,
      qty,
      data
    });

    itemsData[name].stock = Math.max(0, toInt(itemsData[name].stock) - qty);
    updateSalesStockDetails();
    closeStockModal();
    showToast(`Return saved: ${name} (-${qty})`, "success", 2500);
    syncPendingOps();
  }
}