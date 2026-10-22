// inventory.js
// =========================
// Inventory, Purchase, Return & Bulk Import
// =========================

// =========================
// Globals
// =========================
let currentStockModalMode = "purchase"; // "purchase" | "return"
let itemsListener = null;

// =========================
// Helpers
// =========================
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

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");

function formatMrpForName(mrp) {
  const n = Number(mrp) || 0;
  // 50 -> "50", 50.5 -> "50.5", 50.25 -> "50.25"
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

// =========================
// Sales Dropdown (hide 0-stock, keep previous selection visible + supports search filter)
// =========================
function renderSalesDropdown(preferredSelection) {
  const sel = document.getElementById("salesItemSelect");
  if (!sel) return;

  const searchEl = document.getElementById("salesItemSearch");
  const q = (searchEl?.value || "").trim().toLowerCase();

  const prevSelected = (preferredSelection || sel.value || "").trim();

  const list = Object.values(itemsData || {}).filter((x) => x && (x.itemName || x.name));

  // Sort by displayed name
  list.sort((a, b) => String(a.itemName || a.name).localeCompare(String(b.itemName || b.name)));

  const options = [];
  for (const it of list) {
    const name = String(it.itemName || it.name);
    const stock = Number(it.stock) || 0;

    const isSelected = prevSelected && name === prevSelected;
    const matchesQuery = !q || name.toLowerCase().includes(q);

    // Hide 0-stock items, unless it's the selected item (prevents blank dropdown)
    if (!isSelected && stock <= 0) continue;

    // Apply search filter, unless it's the selected item (prevents selection disappearing)
    if (!isSelected && !matchesQuery) continue;

    const suffix = stock <= 0 ? " (Out of stock)" : ` (Stock: ${stock})`;
    options.push(`<option value="${escAttr(name)}">${escHtml(name)}${escHtml(suffix)}</option>`);
  }

  if (!options.length) {
    sel.innerHTML = `<option value="" disabled selected>No matching items</option>`;
    if (typeof updateSalesStockDetails === "function") updateSalesStockDetails();
    return;
  }

  sel.innerHTML = options.join("");

  const canRestore = prevSelected && Array.from(sel.options).some((o) => o.value === prevSelected);
  if (canRestore) sel.value = prevSelected;
  else sel.selectedIndex = 0;

  if (typeof updateSalesStockDetails === "function") updateSalesStockDetails();
}

// Clear search box + reset dropdown to full list
function resetSalesItemSearch() {
  const input = document.getElementById("salesItemSearch");
  if (input) input.value = "";
  renderSalesDropdown();
}

// Attach search input handler (filter dropdown dynamically)
(function initSalesItemSearchFilter() {
  const input = document.getElementById("salesItemSearch");
  if (!input) return;

  input.addEventListener("input", () => {
    // Helps app.js "freeze while interacting" logic even on weird mobile focus behavior
    if (typeof markSalesDropdownInteracting === "function") markSalesDropdownInteracting(2500);

    renderSalesDropdown();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      resetSalesItemSearch();
      input.blur();
    }
  });
})();

// =========================
// Inventory Search Filter (Manage Inventory table)
// =========================
function filterItems() {
  const input = (document.getElementById("searchItem")?.value || "").toUpperCase();
  const table = document.getElementById("invTable");
  if (!table) return;

  const trs = table.getElementsByTagName("tr");
  for (let i = 1; i < trs.length; i++) {
    const td = trs[i].getElementsByTagName("td")[0];
    if (!td) continue;

    const txtValue = td.textContent || td.innerText || "";
    trs[i].style.display = txtValue.toUpperCase().includes(input) ? "" : "none";
  }
}

// =========================
// Load Items + Render Inventory
// =========================
function loadItemsFromFirebase() {
  // Detach previous listener (avoid duplicates)
  if (itemsListener) db.ref("Items").off("value", itemsListener);

  itemsListener = async (snapshot) => {
    const addSalesSelect = document.getElementById("salesItemSelect");
    const invBody = document.getElementById("inventoryListBody");

    const prevSelected = addSalesSelect ? addSalesSelect.value : null;

    if (addSalesSelect) addSalesSelect.innerHTML = "";
    if (invBody) invBody.innerHTML = "";

    itemsData = {};

    snapshot.forEach((child) => {
      const item = child.val();
      if (!item) return;

      // Backward compatible read: accept itemName or legacy name
      const rawName = item.itemName || item.name;
      if (!rawName) return;

      item.id = item.id || child.key;

      const cleanName = normalizeName(rawName);
      item.itemName = cleanName; // primary
      item.name = cleanName;     // compatibility

      item.baseStock = toInt(item.stock);
      item.stock = toInt(item.stock);
      item.mrp = toMoney(item.mrp);

      itemsData[cleanName] = item;
    });

    // Immediate UI update (no waiting for offline queue)
    const updateUI = () => {
      if (!invBody) return;

      const names = Object.keys(itemsData).sort((a, b) => a.localeCompare(b));
      let rowsHtml = "";
      for (const name of names) {
        const it = itemsData[name];
        rowsHtml += `<tr>
          <td style="text-align:left;">${escHtml(it.itemName)}</td>
          <td style="font-weight:bold;">${toInt(it.stock)}</td>
          <td>₹${Number(it.mrp || 0).toFixed(2)}</td>
          <td>
            <button class="edit-btn" onclick='editInvItem(${js(it.id)}, ${js(it.itemName)}, ${js(it.stock)}, ${js(it.mrp)})'>Edit</button>
            <button class="delete-btn" onclick='deleteInvItem(${js(it.id)}, ${js(it.itemName)})'>Delete</button>
          </td>
        </tr>`;
      }
      invBody.innerHTML = rowsHtml;

      // Keep dropdown selection stable
      renderSalesDropdown(prevSelected);
    };

    updateUI();

    // Apply offline pending ops in background
    try {
      await queueReady;
      const summary = await getPendingSummary();

      let changed = false;
      for (const name in itemsData) {
        const it = itemsData[name];
        const delta = summary.stockDeltaByItemId[it.id] || 0;
        if (delta !== 0) {
          it.stock = Math.max(0, (it.baseStock || 0) + delta);
          changed = true;
        }
      }
      if (changed) updateUI();
    } catch (e) {
      console.log("Offline sync delayed:", e);
    }
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
  if (!importBtn) return;

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
      const nm = val?.itemName || val?.name;
      if (nm) existingNames.add(normalizeName(nm));
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
        const nm = normalizeName(it[0]);
        const mrp = toMoney(it[1]);
        const stock = toInt(it[2]);

        await db.ref("Items/" + itemId).set({
          id: itemId,
          itemName: nm,
          name: nm, // compatibility
          mrp,
          stock
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
  let name = normalizeName(document.getElementById("invNewName")?.value);
  const stock = toInt(document.getElementById("invNewStock")?.value);
  const mrp = toMoney(document.getElementById("invNewMrp")?.value);

  if (!name || !mrp) {
    alert("ഐറ്റത്തിന്റെ പേരും വിലയും നിർബന്ധമാണ്!");
    return;
  }

  // If no (₹...) at all, append a formatted price variant
  if (!/\(₹/.test(name)) {
    name = `${name} (₹${formatMrpForName(mrp)})`;
  }

  if (itemsData[name]) {
    alert("ഈ ഐറ്റം നിലവിലുണ്ട്!");
    return;
  }

  const itemId = db.ref("Items").push().key;
  db.ref("Items/" + itemId)
    .set({ id: itemId, itemName: name, name, stock, mrp })
    .then(() => {
      document.getElementById("invNewName").value = "";
      document.getElementById("invNewStock").value = "";
      document.getElementById("invNewMrp").value = "";
      showToast("Item added", "success");
    })
    .catch(() => showToast("Failed to add", "error"));
}

function editInvItem(id, currentName, currentStock, currentMrp) {
  let newName = prompt("പുതിയ പേര് നൽകുക:", currentName);
  if (newName === null) return;
  newName = normalizeName(newName);
  if (!newName) return;

  // Prevent renaming to a different item that already has this name
  if (newName !== currentName && itemsData[newName] && itemsData[newName].id !== id) {
    alert("ഈ പേരിൽ മറ്റൊരു ഐറ്റം നിലവിലുണ്ട്!");
    return;
  }

  const newStockStr = prompt("സ്റ്റോക്ക് എത്രയാണ്?", currentStock);
  if (newStockStr === null) return;
  const newStock = toInt(newStockStr);

  const newMrpStr = prompt("പുതിയ MRP നൽകുക:", currentMrp);
  if (newMrpStr === null) return;
  const newMrp = toMoney(newMrpStr);

  db.ref("Items/" + id)
    .update({
      itemName: newName,
      name: newName, // compatibility
      stock: newStock,
      mrp: newMrp
    })
    .then(() => showToast("വിവരങ്ങൾ അപ്ഡേറ്റ് ചെയ്തു!", "success"))
    .catch((e) => {
      console.error(e);
      showToast("Update failed", "error");
    });
}

function deleteInvItem(id, name) {
  if (!confirm(`"${name}" മായ്ച്ചു കളയണമെന്ന് ഉറപ്പാണോ?`)) return;
  db.ref("Items/" + id)
    .remove()
    .then(() => showToast("Deleted", "success"))
    .catch((e) => {
      console.error(e);
      showToast("Delete failed", "error");
    });
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

  // Use local date (avoid UTC offset issues)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  document.getElementById("modalDateInput").value = `${yyyy}-${mm}-${dd}`;

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
  infoEl.innerText = `നിലവിലെ Stock: ${toInt(it.stock)}  |  നിലവിലെ MRP: ₹${Number(it.mrp || 0).toFixed(2)}`;
  mrpInput.value = Number(it.mrp || 0);
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
  await queueReady;

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
      const variantName = `${baseName} (₹${formatMrpForName(newMrp)})`;

      if (itemsData[variantName]) {
        targetItem = itemsData[variantName];
        name = variantName;
      } else {
        if (!isConnected) {
          alert("വില വ്യത്യാസമുള്ള പുതിയ ഇനം ചേർക്കാൻ ഇന്റർനെറ്റ് കണക്ഷൻ ആവശ്യമാണ്!");
          return;
        }

        const newItemId = db.ref("Items").push().key;
        const newItemObj = {
          id: newItemId,
          itemName: variantName,
          name: variantName,
          stock: 0,
          baseStock: 0,
          mrp: newMrp
        };

        await db.ref("Items/" + newItemId).set({
          id: newItemId,
          itemName: variantName,
          name: variantName, // compatibility
          stock: 0,
          mrp: newMrp
        });

        // Update local cache immediately; listener will also refresh baseStock later
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

    closeStockModal();
    showToast(`Return saved: ${name} (-${qty})`, "success", 2500);
    syncPendingOps();
  }
}