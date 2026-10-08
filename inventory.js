// =========================
// Inventory, Purchase, Return & Bulk Import
// =========================
let currentStockModalMode = "purchase"; // "purchase" or "return"

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

function loadItemsFromFirebase() {
  db.ref("Items").on("value", async snapshot => {
    const addSalesSelect = document.getElementById("salesItemSelect");
    const invBody = document.getElementById("inventoryListBody");
    const importBtn = document.getElementById("importBtn");

    addSalesSelect.innerHTML = "";
    invBody.innerHTML = "";
    itemsData = {};

    let list = [];
    snapshot.forEach(child => {
      const itemVal = child.val();
      if (itemVal && itemVal.itemName) {
        list.push(itemVal);
      }
    });

    list.sort((a, b) => (a.itemName || "").localeCompare((b.itemName || "")));

    if (list.length >= TOTAL_IMPORT_ITEMS) {
      importBtn.style.display = "none";
    } else {
      importBtn.style.display = "block";
      importBtn.disabled = false;
      importBtn.innerText = list.length === 0
        ? "⚡ IMPORT ALL ITEMS"
        : `⚡ IMPORT REMAINING ITEMS (${list.length}/${TOTAL_IMPORT_ITEMS})`;
    }

    for (const item of list) {
      const stockNum = (typeof item.stock === "number") ? item.stock : (parseInt(item.stock, 10) || 0);
      const mrpNum   = (typeof item.mrp === "number") ? item.mrp : (parseFloat(item.mrp) || 0);

      item.baseStock = stockNum;
      item.stock = stockNum;
      item.mrp = mrpNum;
      itemsData[item.itemName] = item;
    }

    const summary = await getPendingSummary();
    for (const name in itemsData) {
      const it = itemsData[name];
      const delta = summary.stockDeltaByItemId[it.id] || 0;
      it.stock = Math.max(0, (it.baseStock || 0) + delta);
    }

    for (const raw of list) {
      const it = itemsData[raw.itemName];
      if (!it) continue;

      addSalesSelect.add(new Option(it.itemName, it.itemName));
      invBody.innerHTML += `<tr>
        <td style="text-align:left;">${it.itemName}</td>
        <td style="font-weight:bold;">${it.stock}</td>
        <td>₹${Number(it.mrp).toFixed(2)}</td>
        <td>
          <button class="edit-btn" onclick='editInvItem(${js(it.id)}, ${js(it.itemName)}, ${js(it.baseStock)}, ${js(it.mrp)})'>Edit</button>
          <button class="delete-btn" onclick='deleteInvItem(${js(it.id)}, ${js(it.itemName)})'>Delete</button>
        </td>
      </tr>`;
    }
    updateSalesStockDetails();
  });
}

async function bulkImportItems() {
  if (!isConnected) {
    showToast("Import ചെയ്യാൻ Internet വേണം (Online ആകുക)", "error", 3000);
    return;
  }
  if (!confirm("മുന്നറിയിപ്പ്: ഇത് ക്ലിക്ക് ചെയ്താൽ ബാക്കിയുള്ള എല്ലാ ഐറ്റങ്ങളും ആഡ് ആകുന്നതാണ്. തുടരണമോ?")) return;

  const importBtn = document.getElementById("importBtn");
  const originalText = importBtn.innerText;
  importBtn.disabled = true;

  // ഇമ്പോർട്ട് നടക്കുമ്പോൾ ടേബിൾ വീണ്ടും വരച്ച് സ്ലോ ആകാതിരിക്കാൻ ലിസണർ താൽക്കാലികമായി നിർത്തുന്നു
  db.ref("Items").off("value");

  try {
    // ഡാറ്റാബേസിൽ നിലവിലുള്ള ഐറ്റങ്ങൾ നേരിട്ട് പരിശോധിക്കുന്നു
    const snap = await db.ref("Items").once("value");
    const existingNames = new Set();
    snap.forEach(c => {
      const val = c.val();
      if (val && val.itemName) existingNames.add(val.itemName);
    });

    const toImport = BULK_DATA.filter(x => !existingNames.has(x[0]));

    if (toImport.length === 0) {
      showToast("All items already imported!", "success");
      importBtn.style.display = "none";
      return;
    }

    let done = 0;
    for (const it of toImport) {
      const itemId = db.ref("Items").push().key;
      await db.ref("Items/" + itemId).set({
        id: itemId,
        itemName: it[0],
        mrp: parseFloat(it[1]) || 0,
        stock: parseInt(it[2], 10) || 0
      });

      done++;
      importBtn.innerText = `⏳ Importing... ${done} / ${toImport.length}`;
    }

    showToast(`വിജയകരം! ${done} ഐറ്റങ്ങളും സ്റ്റോക്കിൽ ആഡ് ചെയ്തു.`, "success", 3000);
    importBtn.style.display = "none";
  } catch (e) {
    console.error("Import error:", e);
    showToast("Import failed: " + e.message, "error", 5000);
  } finally {
    importBtn.disabled = false;
    importBtn.innerText = originalText;
    // ഇമ്പോർട്ട് കഴിഞ്ഞ ഉടൻ ലിസണർ തിരികെ ഓൺ ആക്കുന്നു
    loadItemsFromFirebase();
  }
}

function addNewInvItem() {
  const name = document.getElementById("invNewName").value.trim();
  const stock = parseInt(document.getElementById("invNewStock").value, 10) || 0;
  const mrp = parseFloat(document.getElementById("invNewMrp").value) || 0;

  if (!name || !mrp) { alert("ഐറ്റത്തിന്റെ പേരും വിലയും നിർബന്ധമാണ്!"); return; }
  if (itemsData[name]) { alert("ഈ ഐറ്റം നിലവിലുണ്ട്!"); return; }

  const itemId = db.ref("Items").push().key;
  db.ref("Items/" + itemId).set({ id: itemId, itemName: name, stock: stock, mrp: mrp })
    .then(() => {
      document.getElementById("invNewName").value = "";
      document.getElementById("invNewStock").value = "";
      document.getElementById("invNewMrp").value = "";
      showToast("Item added", "success");
    }).catch(() => showToast("Failed to add", "error"));
}

function editInvItem(id, currentName, currentStock, currentMrp) {
  const newName = prompt("പുതിയ പേര് നൽകുക:", currentName);
  if (newName === null || newName.trim() === "") return;
  const newStock = prompt("സ്റ്റോക്ക് എത്രയാണ്?", currentStock);
  if (newStock === null) return;
  const newMrp = prompt("പുതിയ MRP നൽകുക:", currentMrp);
  if (newMrp === null) return;

  db.ref("Items/" + id).update({
    itemName: newName.trim(),
    stock: parseInt(newStock, 10) || 0,
    mrp: parseFloat(newMrp) || 0
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
  const q = (filterText || "").trim().toUpperCase();
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

  const qty = parseInt(document.getElementById("modalQtyInput").value, 10);
  if (isNaN(qty) || qty <= 0) {
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
    const currentMrp = parseFloat(itemsData[name].mrp) || 0;
    const newMrp = parseFloat(document.getElementById("modalMrpInput").value) || currentMrp;
    let targetItem = itemsData[name];

    // വില വ്യത്യാസമുണ്ടെങ്കിൽ പുതിയ വില ബ്രാക്കറ്റിൽ ചേർത്ത് പ്രത്യേക ഐറ്റമായി ക്രമീകരിക്കുന്നു
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
      opId: "purchase:" + purchaseId, type: "purchase", monthKey, purchaseId,
      itemId: targetItem.id, itemName: name, qty, data
    });

    targetItem.stock = (parseInt(targetItem.stock, 10) || 0) + qty;
    updateSalesStockDetails();
    closeStockModal();
    showToast(`Purchase added: ${name} (+${qty})`, "success", 2500);
    syncPendingOps();

  } else {
    // Return Stock Mode
    if (qty > itemsData[name].stock) {
      alert("സ്റ്റോക്കിനേക്കാൾ കൂടുതൽ Return നൽകാൻ കഴിയില്ല!");
      return;
    }

    const returnId = db.ref("Returns/" + monthKey).push().key;
    const data = { date: dateInput, itemName: name, quantity: qty };

    await queuePut({
      opId: "return:" + returnId, type: "return", monthKey, returnId,
      itemId: itemsData[name].id, itemName: name, qty, data
    });

    itemsData[name].stock = Math.max(0, itemsData[name].stock - qty);
    updateSalesStockDetails();
    closeStockModal();
    showToast(`Return saved: ${name} (-${qty})`, "success", 2500);
    syncPendingOps();
  }
}