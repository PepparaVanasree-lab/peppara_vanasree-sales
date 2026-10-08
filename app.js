// app.js
// =========================
// Firebase Init & Globals
// =========================
const firebaseConfig = {
  apiKey: "AIzaSyB9RbRc2ALocSdB7Q335k91VFQNPLVdQ18",
  authDomain: "vanasree-sales.firebaseapp.com",
  databaseURL: "https://vanasree-sales-default-rtdb.firebaseio.com",
  projectId: "vanasree-sales",
  storageBucket: "vanasree-sales.firebasestorage.app",
  messagingSenderId: "616459948644",
  appId: "1:616459948644:web:6830ae2230a3c0b77b4571"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// shared globals (used by other files)
let itemsData = {};
const js = (v) => JSON.stringify(v);

let isConnected = null;
let queueDb = null;
let pendingCount = 0;
let syncRunning = false;

// Ensure sync does not run before queue init finishes
let _queueReadyResolve;
const queueReady = new Promise((resolve) => (_queueReadyResolve = resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =========================
// Toast & Button Flash
// =========================
let toastTimer = null;
function showToast(msg, type = "info", ms = 2000) {
  const t = document.getElementById("toast");
  if (!t) return;

  t.className = "";
  t.classList.add(type);
  t.textContent = msg;
  t.style.display = "block";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.display = "none"), ms);
}

function flashButton(btn, { state = "success", text = "✔ Done!", ms = 1500 } = {}) {
  if (!btn) return;

  const originalText = btn.dataset.originalText || btn.innerHTML;
  btn.dataset.originalText = originalText;

  btn.disabled = true;
  btn.classList.remove("btn-saving", "btn-success", "btn-error");
  btn.classList.add(state === "saving" ? "btn-saving" : state === "error" ? "btn-error" : "btn-success");
  btn.innerHTML = text;

  setTimeout(() => {
    btn.disabled = false;
    btn.classList.remove("btn-saving", "btn-success", "btn-error");
    btn.innerHTML = originalText;
  }, ms);
}

// =========================
// Net Badge & Connection Monitor
// =========================
function updateNetBadge() {
  const el = document.getElementById("netStatus");
  if (!el) return;

  const suffix = pendingCount > 0 ? ` (${pendingCount} pending)` : "";

  if (isConnected === null) {
    el.className = "pill connecting";
    el.textContent = "Connecting..." + suffix;
  } else if (isConnected) {
    el.className = "pill online";
    el.textContent = "Online" + suffix;
  } else {
    el.className = "pill offline";
    el.textContent = "Offline (Sync Pending)" + suffix;
  }
}

function initConnectionMonitor() {
  db.ref(".info/connected").on("value", (snap) => {
    isConnected = snap.val() === true;
    updateNetBadge();
    if (isConnected) syncPendingOps();
  });

  window.addEventListener("offline", () => showToast("Offline mode: saved changes will sync later", "info", 2500));
  window.addEventListener("online", () => {
    showToast("Internet connected: syncing...", "success", 2000);
    syncPendingOps();
  });

  setInterval(() => {
    if (isConnected) syncPendingOps();
  }, 15000);
}

// =========================
// Offline Queue (IndexedDB + localStorage fallback)
// =========================
const QUEUE_DB_NAME = "vanasree_pending_db_v1";
const QUEUE_STORE = "ops";
const QUEUE_LS_KEY = "vanasree_pending_ops_v1";

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB not supported"));

    const req = indexedDB.open(QUEUE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(QUEUE_STORE)) {
        const store = idb.createObjectStore(QUEUE_STORE, { keyPath: "opId" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueInit() {
  try {
    queueDb = await openQueueDb();
  } catch {
    queueDb = null;
  }
  _queueReadyResolve?.();
  await refreshPendingCount();
}

function lsReadAllMap() {
  return safeJsonParse(localStorage.getItem(QUEUE_LS_KEY) || "{}", {});
}
function lsWriteAllMap(map) {
  localStorage.setItem(QUEUE_LS_KEY, JSON.stringify(map));
}

async function queuePut(op) {
  op.createdAt = op.createdAt || Date.now();

  if (!queueDb) {
    const map = lsReadAllMap();
    map[op.opId] = op;
    lsWriteAllMap(map);
    await refreshPendingCount();
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = queueDb.transaction(QUEUE_STORE, "readwrite");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.objectStore(QUEUE_STORE).put(op);
  });
  await refreshPendingCount();
}

async function queueGetAll() {
  if (!queueDb) {
    const arr = Object.values(lsReadAllMap());
    arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return arr;
  }

  const arr = await new Promise((resolve, reject) => {
    const tx = queueDb.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return arr;
}

async function queueGet(opId) {
  if (!queueDb) return lsReadAllMap()[opId] || null;

  return await new Promise((resolve, reject) => {
    const tx = queueDb.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).get(opId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function queueDelete(opId) {
  if (!queueDb) {
    const map = lsReadAllMap();
    delete map[opId];
    lsWriteAllMap(map);
    await refreshPendingCount();
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = queueDb.transaction(QUEUE_STORE, "readwrite");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.objectStore(QUEUE_STORE).delete(opId);
  });
  await refreshPendingCount();
}

async function queueCount() {
  if (!queueDb) return Object.keys(lsReadAllMap()).length;

  return await new Promise((resolve, reject) => {
    const tx = queueDb.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

async function refreshPendingCount() {
  pendingCount = await queueCount();
  updateNetBadge();

  if (itemsData && Object.keys(itemsData).length > 0) {
    try {
      const summary = await getPendingSummary();
      for (const name in itemsData) {
        const it = itemsData[name];
        const delta = summary.stockDeltaByItemId[it.id] || 0;
        it.stock = Math.max(0, (it.baseStock || 0) + delta);
      }
      if (typeof updateSalesStockDetails === "function") {
        updateSalesStockDetails();
      }
    } catch (e) {
      console.error("Stock refresh error:", e);
    }
  }
}

async function getPendingSummary() {
  const ops = await queueGetAll();

  const stockDeltaByItemId = {};
  const pendingSalesByDate = {};
  const pendingDeleteSaleIds = new Set();
  const pendingIncomeByDateKey = {};
  const pendingRemitByDateKey = {};

  for (const op of ops) {
    if (op.type === "sale") {
      stockDeltaByItemId[op.itemId] = (stockDeltaByItemId[op.itemId] || 0) - (op.qty || 0);

      const d = op.saleData && op.saleData.date;
      if (d) {
        pendingSalesByDate[d] = pendingSalesByDate[d] || [];
        pendingSalesByDate[d].push(op);
      }

      pendingIncomeByDateKey[op.dateKey] = (pendingIncomeByDateKey[op.dateKey] || 0) + (op.amount || 0);

    } else if (op.type === "deleteSale") {
      stockDeltaByItemId[op.itemId] = (stockDeltaByItemId[op.itemId] || 0) + (op.qty || 0);
      pendingDeleteSaleIds.add(op.saleId);
      pendingIncomeByDateKey[op.dateKey] = (pendingIncomeByDateKey[op.dateKey] || 0) - (op.amount || 0);

    } else if (op.type === "editSale") {
      stockDeltaByItemId[op.itemId] = (stockDeltaByItemId[op.itemId] || 0) - (op.qtyDiff || 0);
      pendingIncomeByDateKey[op.dateKey] = (pendingIncomeByDateKey[op.dateKey] || 0) + (op.amtDiff || 0);

    } else if (op.type === "return") {
      stockDeltaByItemId[op.itemId] = (stockDeltaByItemId[op.itemId] || 0) - (op.qty || 0);

    } else if (op.type === "purchase") {
      stockDeltaByItemId[op.itemId] = (stockDeltaByItemId[op.itemId] || 0) + (op.qty || 0);

    } else if (op.type === "remit") {
      pendingRemitByDateKey[op.dateKey] = op.data;
    }
  }

  return { ops, stockDeltaByItemId, pendingSalesByDate, pendingDeleteSaleIds, pendingIncomeByDateKey, pendingRemitByDateKey };
}

// =========================
// Sync Operations (Atomic & Zero-Drift)
// =========================
async function syncPendingOps() {
  await queueReady;

  if (!isConnected || syncRunning) return;

  syncRunning = true;
  try {
    const summary = await getPendingSummary();

    for (const op of summary.ops) {
      if (!isConnected) break;

      try {
        if (op.type === "sale") await syncSaleOp(op);
        else if (op.type === "deleteSale") await syncDeleteSaleOp(op);
        else if (op.type === "editSale") await syncEditSaleOp(op);
        else if (op.type === "remit") await syncRemitOp(op);
        else if (op.type === "return") await syncReturnOp(op);
        else if (op.type === "purchase") await syncPurchaseOp(op);
      } catch (e) {
        console.error("Sync failed for op:", op, e);
        break;
      }
    }
  } finally {
    syncRunning = false;
    await refreshPendingCount();
    updateNetBadge();
  }
}

async function recalculateDailyTotal(formattedDate, dateKey) {
  if (!formattedDate || !dateKey) return;
  const snap = await db.ref("Sales").orderByChild("date").equalTo(formattedDate).once("value");
  let sum = 0;
  snap.forEach((c) => {
    const v = c.val();
    if (v && v.amount) sum += Number(v.amount) || 0;
  });
  await db.ref("DailySales/" + dateKey).set(Number(sum.toFixed(2)));
}

async function syncSaleOp(op) {
  const exists = await db.ref("Sales/" + op.saleId).once("value");
  if (exists.exists()) { await queueDelete(op.opId); return; }

  const formattedDate = op.formattedDate || (op.saleData && op.saleData.date);

  const daySnap = await db.ref("Sales").orderByChild("date").equalTo(formattedDate).once("value");
  let existingServerSale = null;
  let existingServerSaleId = null;
  daySnap.forEach((c) => {
    const s = c.val();
    const sId = (s && s.id) || c.key;
    if (s && sId !== op.saleId && (s.itemName || "").trim() === (op.itemName || "").trim()) {
      if (!existingServerSale) {
        existingServerSale = s;
        existingServerSaleId = sId;
      }
    }
  });

  // Guard: do not merge into existingServerSaleId if a pending editSale or deleteSale exists for it
  if (existingServerSaleId) {
    const hasPendingEdit = await queueGet("editSale:" + existingServerSaleId);
    const hasPendingDel = await queueGet("delSale:" + existingServerSaleId);
    if (hasPendingEdit || hasPendingDel) {
      existingServerSale = null;
      existingServerSaleId = null;
    }
  }

  const updates = {};
  if (existingServerSale && existingServerSaleId) {
    const mergedQty = (Number(existingServerSale.quantity) || 0) + (Number(op.qty) || 0);
    const mergedAmt = Number(((Number(existingServerSale.amount) || 0) + (Number(op.amount) || 0)).toFixed(2));
    updates["Sales/" + existingServerSaleId + "/id"] = existingServerSaleId;
    updates["Sales/" + existingServerSaleId + "/quantity"] = mergedQty;
    updates["Sales/" + existingServerSaleId + "/amount"] = mergedAmt;
  } else {
    updates["Sales/" + op.saleId] = op.saleData;
  }
  updates["Items/" + op.itemId + "/stock"] = firebase.database.ServerValue.increment(-op.qty);

  await queueDelete(op.opId);
  try {
    await db.ref().update(updates);
    await recalculateDailyTotal(formattedDate, op.dateKey);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

async function syncDeleteSaleOp(op) {
  const snap = await db.ref("Sales/" + op.saleId).once("value");
  if (!snap.exists()) { await queueDelete(op.opId); return; }

  const actualServerSale = snap.val();
  const itemId = actualServerSale.itemId || op.itemId;
  const actualQtyToRestore = Number(actualServerSale.quantity) || op.qty || 0;
  const formattedDate = op.formattedDate || actualServerSale.date;

  const updates = {};
  updates["Sales/" + op.saleId] = null;
  updates["Items/" + itemId + "/stock"] = firebase.database.ServerValue.increment(+actualQtyToRestore);

  await queueDelete(op.opId);
  try {
    await db.ref().update(updates);
    await recalculateDailyTotal(formattedDate, op.dateKey);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

async function syncEditSaleOp(op) {
  const snap = await db.ref("Sales/" + op.saleId).once("value");
  if (!snap.exists()) { await queueDelete(op.opId); return; }

  const actualServerSale = snap.val();
  const itemId = actualServerSale.itemId || op.itemId;
  const actualOldQty = Number(actualServerSale.quantity) || 0;
  const actualQtyDiff = op.newQty - actualOldQty;
  const formattedDate = op.formattedDate || actualServerSale.date;

  const updates = {};
  updates["Sales/" + op.saleId + "/quantity"] = op.newQty;
  updates["Sales/" + op.saleId + "/amount"] = op.newAmt;
  updates["Items/" + itemId + "/stock"] = firebase.database.ServerValue.increment(-actualQtyDiff);

  await queueDelete(op.opId);
  try {
    await db.ref().update(updates);
    await recalculateDailyTotal(formattedDate, op.dateKey);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

async function syncRemitOp(op) {
  await queueDelete(op.opId);
  try {
    await db.ref("Remittances/" + op.dateKey).set(op.data);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

async function syncReturnOp(op) {
  const exists = await db.ref("Returns/" + op.monthKey + "/" + op.returnId).once("value");
  if (exists.exists()) { await queueDelete(op.opId); return; }

  const updates = {};
  updates["Returns/" + op.monthKey + "/" + op.returnId] = op.data;
  updates["Items/" + op.itemId + "/stock"] = firebase.database.ServerValue.increment(-op.qty);

  await queueDelete(op.opId);
  try {
    await db.ref().update(updates);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

async function syncPurchaseOp(op) {
  const exists = await db.ref("Purchases/" + op.monthKey + "/" + op.purchaseId).once("value");
  if (exists.exists()) { await queueDelete(op.opId); return; }

  const updates = {};
  updates["Purchases/" + op.monthKey + "/" + op.purchaseId] = op.data;
  updates["Items/" + op.itemId + "/stock"] = firebase.database.ServerValue.increment(+op.qty);

  await queueDelete(op.opId);
  try {
    await db.ref().update(updates);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

// =========================
// Authentication (Encrypted Hash Only)
// =========================
const AUTH_PATH = "AppAuth";
let authConfig = null;
const MASKED_PASS = "********";

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clearSavedHashOnEdit() {
  const passInput = document.getElementById("password");
  if (passInput && passInput.dataset.savedHash && passInput.value !== MASKED_PASS) {
    delete passInput.dataset.savedHash;
  }
}

async function ensureAuthLoaded() {
  if (authConfig) return authConfig;

  const snap = await db.ref(AUTH_PATH).once("value");
  if (snap.exists()) {
    authConfig = snap.val();
    return authConfig;
  }

  const defaultUser = "admin";
  const defaultPass = "admin123";
  const defaultHash = await sha256(defaultPass);

  authConfig = { username: defaultUser, passwordHash: defaultHash };
  await db.ref(AUTH_PATH).set(authConfig);
  return authConfig;
}

async function changePasswordPrompt() {
  try {
    const cfg = await ensureAuthLoaded();

    const oldPass = prompt("Enter OLD password:");
    if (oldPass === null) return;

    const oldHash = await sha256(oldPass);
    if (oldHash !== cfg.passwordHash) { showToast("Old password is wrong!", "error"); return; }

    const newPass1 = prompt("Enter NEW password (min 4 chars):");
    if (newPass1 === null) return;
    if (newPass1.trim().length < 4) { showToast("Password too short!", "error"); return; }

    const newPass2 = prompt("Confirm NEW password:");
    if (newPass2 === null) return;
    if (newPass1 !== newPass2) { showToast("Password not matching!", "error"); return; }

    const newHash = await sha256(newPass1);
    await db.ref(AUTH_PATH + "/passwordHash").set(newHash);
    authConfig.passwordHash = newHash;

    if (localStorage.getItem("rememberedUser")) {
      localStorage.setItem("rememberedHash", newHash);
      localStorage.removeItem("rememberedPass");
    }

    showToast("Password updated successfully!", "success");
  } catch (e) {
    console.error(e);
    showToast("Password change failed!", "error");
  }
}

async function handleLogin() {
  try {
    const u = document.getElementById("username").value.trim();
    const passEl = document.getElementById("password");
    const p = passEl.value.trim();
    const remember = document.getElementById("rememberMe").checked;

    document.getElementById("loginError").style.display = "none";

    const cfg = await ensureAuthLoaded();
    const enteredHash =
      (p === MASKED_PASS && passEl.dataset.savedHash)
        ? passEl.dataset.savedHash
        : await sha256(p);

    if (u === cfg.username && enteredHash === cfg.passwordHash) {
      localStorage.removeItem("rememberedPass");

      if (remember) {
        localStorage.setItem("rememberedUser", u);
        localStorage.setItem("rememberedHash", enteredHash);
        passEl.dataset.savedHash = enteredHash;
        passEl.value = MASKED_PASS;
      } else {
        localStorage.removeItem("rememberedUser");
        localStorage.removeItem("rememberedHash");
        delete passEl.dataset.savedHash;
      }

      document.getElementById("loginSection").style.display = "none";
      document.getElementById("appSection").style.display = "block";
      switchTab("salesTab");
      showToast("Login successful", "success");
    } else {
      document.getElementById("loginError").style.display = "block";
    }
  } catch (e) {
    console.error(e);
    showToast("Login error", "error");
  }
}

function handleLogout() {
  document.getElementById("appSection").style.display = "none";
  document.getElementById("loginSection").style.display = "block";
}

// =========================
// Navigation
// =========================
function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));

  if (tabId === "salesTab") {
    document.querySelector(".tabs .tab:nth-child(1)").classList.add("active");
    document.getElementById("salesTab").classList.add("active");
    showSalesSubPage("salesMainMenu");
  } else {
    document.querySelector(".tabs .tab:nth-child(2)").classList.add("active");
    document.getElementById("adminTab").classList.add("active");
    loadAdminData();
  }
}

function showSalesSubPage(pageId) {
  document.getElementById("salesMainMenu").style.display = "none";
  document.querySelectorAll(".sales-subpage").forEach((page) => (page.style.display = "none"));

  if (pageId === "salesMainMenu") {
    document.getElementById("salesMainMenu").style.display = "block";
  } else {
    document.getElementById(pageId).style.display = "block";
    if (pageId === "editSalesPage") loadSalesList();
  }
}

// =========================
// App Startup
// =========================
window.addEventListener("load", async () => {
  const legacyPlainPass = localStorage.getItem("rememberedPass");
  if (legacyPlainPass) {
    const migratedHash = await sha256(legacyPlainPass);
    localStorage.setItem("rememberedHash", migratedHash);
    localStorage.removeItem("rememberedPass");
  }

  const savedUser = localStorage.getItem("rememberedUser");
  const savedHash = localStorage.getItem("rememberedHash");
  if (savedUser && savedHash) {
    document.getElementById("username").value = savedUser;
    const passEl = document.getElementById("password");
    passEl.value = MASKED_PASS;
    passEl.dataset.savedHash = savedHash;
    document.getElementById("rememberMe").checked = true;
  }

  const today = new Date().toISOString().split("T")[0];
  const saleDate = document.getElementById("saleDate");
  const filterSaleDate = document.getElementById("filterSaleDate");
  if (saleDate) saleDate.value = today;
  if (filterSaleDate) filterSaleDate.value = today;

  initConnectionMonitor();
  queueInit().catch(() => {});

  ensureAuthLoaded().catch((err) => console.error("Auth error:", err));

  if (typeof loadItemsFromFirebase === "function") loadItemsFromFirebase();
});