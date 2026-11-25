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

// Shared globals used by other files
let itemsData = {};
const js = (v) => JSON.stringify(v);

let isConnected = null;
let queueDb = null;
let pendingCount = 0;
let syncRunning = false;

// Ensure sync does not run before queue initialization finishes
let _queueReadyResolve;
const queueReady = new Promise((resolve) => {
  _queueReadyResolve = resolve;
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =========================
// Toast & Button Flash
// =========================
let toastTimer = null;

function showToast(msg, type = "info", ms = 2000) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.className = "";
  toast.classList.add(type);
  toast.textContent = msg;
  toast.style.display = "block";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, ms);
}

function flashButton(
  btn,
  { state = "success", text = "✔ Done!", ms = 1500 } = {}
) {
  if (!btn) return;

  const originalText = btn.dataset.originalText || btn.innerHTML;
  btn.dataset.originalText = originalText;

  btn.disabled = true;
  btn.classList.remove("btn-saving", "btn-success", "btn-error");
  btn.classList.add(
    state === "saving"
      ? "btn-saving"
      : state === "error"
        ? "btn-error"
        : "btn-success"
  );
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

    if (isConnected) {
      syncPendingOps();
    }
  });

  window.addEventListener("offline", () => {
    showToast("Offline mode: saved changes will sync later", "info", 2500);
  });

  window.addEventListener("online", () => {
    showToast("Internet connected: syncing...", "success", 2000);
    syncPendingOps();
  });

  setInterval(() => {
    if (isConnected) {
      syncPendingOps();
    }
  }, 15000);
}

// =========================
// Offline Queue (IndexedDB + localStorage fallback)
// =========================
const QUEUE_DB_NAME = "vanasree_pending_db_v1";
const QUEUE_STORE = "ops";
const QUEUE_LS_KEY = "vanasree_pending_ops_v1";

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    const req = indexedDB.open(QUEUE_DB_NAME, 1);

    req.onupgradeneeded = () => {
      const idb = req.result;

      if (!idb.objectStoreNames.contains(QUEUE_STORE)) {
        const store = idb.createObjectStore(QUEUE_STORE, {
          keyPath: "opId"
        });
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
  if (!queueDb) {
    return lsReadAllMap()[opId] || null;
  }

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
  if (!queueDb) {
    return Object.keys(lsReadAllMap()).length;
  }

  return await new Promise((resolve, reject) => {
    const tx = queueDb.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).count();

    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

// =========================
// Sales Dropdown Refresh Lock
// Prevents background updates while typing/selecting
// =========================
let salesDropdownRefreshDeferred = false;
let salesDropdownFreezeUntil = 0;
let salesDropdownRefreshTimer = null;

function markSalesDropdownInteracting(ms = 1500) {
  salesDropdownFreezeUntil = Math.max(
    salesDropdownFreezeUntil,
    Date.now() + ms
  );

  if (salesDropdownRefreshTimer) {
    clearTimeout(salesDropdownRefreshTimer);
    salesDropdownRefreshTimer = null;
  }
}

function isSalesDropdownInteracting() {
  const activeEl = document.activeElement;

  if (
    activeEl &&
    (activeEl.id === "salesItemSelect" ||
      activeEl.id === "salesItemSearch")
  ) {
    return true;
  }

  return Date.now() < salesDropdownFreezeUntil;
}

function requestSalesDropdownRefresh() {
  if (typeof renderSalesDropdown !== "function") return;

  if (isSalesDropdownInteracting()) {
    salesDropdownRefreshDeferred = true;
    return;
  }

  salesDropdownRefreshDeferred = false;

  if (salesDropdownRefreshTimer) {
    clearTimeout(salesDropdownRefreshTimer);
    salesDropdownRefreshTimer = null;
  }

  renderSalesDropdown();
}

function flushDeferredSalesDropdownRefresh() {
  if (!salesDropdownRefreshDeferred) return;
  if (typeof renderSalesDropdown !== "function") return;

  const activeEl = document.activeElement;
  if (
    activeEl &&
    (activeEl.id === "salesItemSelect" ||
      activeEl.id === "salesItemSearch")
  ) {
    return;
  }

  const remainingLockTime = salesDropdownFreezeUntil - Date.now();

  if (remainingLockTime > 0) {
    if (salesDropdownRefreshTimer) {
      clearTimeout(salesDropdownRefreshTimer);
    }

    salesDropdownRefreshTimer = setTimeout(() => {
      salesDropdownRefreshTimer = null;
      flushDeferredSalesDropdownRefresh();
    }, remainingLockTime + 1);

    return;
  }

  salesDropdownRefreshDeferred = false;

  if (salesDropdownRefreshTimer) {
    clearTimeout(salesDropdownRefreshTimer);
    salesDropdownRefreshTimer = null;
  }

  renderSalesDropdown();
}

async function refreshPendingCount() {
  pendingCount = await queueCount();
  updateNetBadge();

  // Recompute live stock from baseStock + remaining pending queue.
  if (itemsData && Object.keys(itemsData).length > 0) {
    try {
      const summary = await getPendingSummary();

      for (const name in itemsData) {
        const item = itemsData[name];
        const delta = summary.stockDeltaByItemId[item.id] || 0;
        item.stock = Math.max(0, (item.baseStock || 0) + delta);
      }

      // Keep the dropdown current, unless the user is interacting with it.
      requestSalesDropdownRefresh();

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
      stockDeltaByItemId[op.itemId] =
        (stockDeltaByItemId[op.itemId] || 0) - (op.qty || 0);

      const date = op.saleData && op.saleData.date;
      if (date) {
        pendingSalesByDate[date] = pendingSalesByDate[date] || [];
        pendingSalesByDate[date].push(op);
      }

      pendingIncomeByDateKey[op.dateKey] =
        (pendingIncomeByDateKey[op.dateKey] || 0) + (op.amount || 0);
    } else if (op.type === "deleteSale") {
      stockDeltaByItemId[op.itemId] =
        (stockDeltaByItemId[op.itemId] || 0) + (op.qty || 0);

      pendingDeleteSaleIds.add(op.saleId);
      pendingIncomeByDateKey[op.dateKey] =
        (pendingIncomeByDateKey[op.dateKey] || 0) - (op.amount || 0);
    } else if (op.type === "editSale") {
      stockDeltaByItemId[op.itemId] =
        (stockDeltaByItemId[op.itemId] || 0) - (op.qtyDiff || 0);

      pendingIncomeByDateKey[op.dateKey] =
        (pendingIncomeByDateKey[op.dateKey] || 0) + (op.amtDiff || 0);
    } else if (op.type === "return") {
      stockDeltaByItemId[op.itemId] =
        (stockDeltaByItemId[op.itemId] || 0) - (op.qty || 0);
    } else if (op.type === "purchase") {
      stockDeltaByItemId[op.itemId] =
        (stockDeltaByItemId[op.itemId] || 0) + (op.qty || 0);
    } else if (op.type === "remit") {
      pendingRemitByDateKey[op.dateKey] = op.data;
    }
  }

  return {
    ops,
    stockDeltaByItemId,
    pendingSalesByDate,
    pendingDeleteSaleIds,
    pendingIncomeByDateKey,
    pendingRemitByDateKey
  };
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
        if (op.type === "sale") {
          await syncSaleOp(op);
        } else if (op.type === "deleteSale") {
          await syncDeleteSaleOp(op);
        } else if (op.type === "editSale") {
          await syncEditSaleOp(op);
        } else if (op.type === "remit") {
          await syncRemitOp(op);
        } else if (op.type === "return") {
          await syncReturnOp(op);
        } else if (op.type === "purchase") {
          await syncPurchaseOp(op);
        }
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

// Recalculate exact DailySales total for a date.
async function recalculateDailyTotal(formattedDate, dateKey) {
  if (!formattedDate || !dateKey) return;

  const snap = await db
    .ref("Sales")
    .orderByChild("date")
    .equalTo(formattedDate)
    .once("value");

  let sum = 0;
  snap.forEach((child) => {
    const value = child.val();
    if (value && value.amount) {
      sum += Number(value.amount) || 0;
    }
  });

  await db.ref("DailySales/" + dateKey).set(Number(sum.toFixed(2)));
}

async function syncSaleOp(op) {
  const exists = await db.ref("Sales/" + op.saleId).once("value");

  if (exists.exists()) {
    await queueDelete(op.opId);
    return;
  }

  const formattedDate =
    op.formattedDate || (op.saleData && op.saleData.date);

  // Find same-date, same-item sale on the server to merge into.
  const daySnap = await db
    .ref("Sales")
    .orderByChild("date")
    .equalTo(formattedDate)
    .once("value");

  let existingServerSale = null;
  let existingServerSaleId = null;

  daySnap.forEach((child) => {
    const sale = child.val();
    const saleId = (sale && sale.id) || child.key;

    if (
      sale &&
      saleId !== op.saleId &&
      (sale.itemName || "").trim() === (op.itemName || "").trim()
    ) {
      if (!existingServerSale) {
        existingServerSale = sale;
        existingServerSaleId = saleId;
      }
    }
  });

  // Do not merge into a sale with a pending edit or delete operation.
  if (existingServerSaleId) {
    const pendingEdit = await queueGet("editSale:" + existingServerSaleId);
    const pendingDelete = await queueGet("delSale:" + existingServerSaleId);

    if (pendingEdit || pendingDelete) {
      existingServerSale = null;
      existingServerSaleId = null;
    }
  }

  const updates = {};

  if (existingServerSale && existingServerSaleId) {
    const mergedQty =
      (Number(existingServerSale.quantity) || 0) + (Number(op.qty) || 0);
    const mergedAmount = Number(
      (
        (Number(existingServerSale.amount) || 0) +
        (Number(op.amount) || 0)
      ).toFixed(2)
    );

    updates["Sales/" + existingServerSaleId + "/id"] =
      existingServerSaleId;
    updates["Sales/" + existingServerSaleId + "/quantity"] = mergedQty;
    updates["Sales/" + existingServerSaleId + "/amount"] = mergedAmount;
  } else {
    updates["Sales/" + op.saleId] = op.saleData;
  }

  updates["Items/" + op.itemId + "/stock"] =
    firebase.database.ServerValue.increment(-op.qty);

  // Delete from the local queue before Firebase writes. Restore if the write fails.
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

  if (!snap.exists()) {
    await queueDelete(op.opId);
    return;
  }

  const actualServerSale = snap.val();
  const itemId = actualServerSale.itemId || op.itemId;
  const actualQtyToRestore =
    Number(actualServerSale.quantity) || op.qty || 0;
  const formattedDate = op.formattedDate || actualServerSale.date;

  const updates = {};
  updates["Sales/" + op.saleId] = null;
  updates["Items/" + itemId + "/stock"] =
    firebase.database.ServerValue.increment(+actualQtyToRestore);

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

  if (!snap.exists()) {
    await queueDelete(op.opId);
    return;
  }

  const actualServerSale = snap.val();
  const itemId = actualServerSale.itemId || op.itemId;
  const actualOldQty = Number(actualServerSale.quantity) || 0;
  const actualQtyDiff = op.newQty - actualOldQty;
  const formattedDate = op.formattedDate || actualServerSale.date;

  const updates = {};
  updates["Sales/" + op.saleId + "/quantity"] = op.newQty;
  updates["Sales/" + op.saleId + "/amount"] = op.newAmt;
  updates["Items/" + itemId + "/stock"] =
    firebase.database.ServerValue.increment(-actualQtyDiff);

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
  const exists = await db
    .ref("Returns/" + op.monthKey + "/" + op.returnId)
    .once("value");

  if (exists.exists()) {
    await queueDelete(op.opId);
    return;
  }

  const updates = {};
  updates["Returns/" + op.monthKey + "/" + op.returnId] = op.data;
  updates["Items/" + op.itemId + "/stock"] =
    firebase.database.ServerValue.increment(-op.qty);

  await queueDelete(op.opId);

  try {
    await db.ref().update(updates);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

async function syncPurchaseOp(op) {
  const exists = await db
    .ref("Purchases/" + op.monthKey + "/" + op.purchaseId)
    .once("value");

  if (exists.exists()) {
    await queueDelete(op.opId);
    return;
  }

  const updates = {};
  updates["Purchases/" + op.monthKey + "/" + op.purchaseId] = op.data;
  updates["Items/" + op.itemId + "/stock"] =
    firebase.database.ServerValue.increment(+op.qty);

  await queueDelete(op.opId);

  try {
    await db.ref().update(updates);
  } catch (err) {
    await queuePut(op);
    throw err;
  }
}

// =========================
// Authentication (Encrypted Hash Only) — Multi-User
// =========================
const AUTH_PATH = "AppAuth";
let authConfig = null;
let currentUser = null;
const MASKED_PASS = "********";

const DEFAULT_USERS_PLAINTEXT = {
  admin: "admin123",
  secretary: "sec123"
};

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clearSavedHashOnEdit() {
  const passInput = document.getElementById("password");
  if (!passInput) return;

  if (passInput.dataset.savedHash && passInput.value !== MASKED_PASS) {
    delete passInput.dataset.savedHash;
    delete passInput.dataset.savedUser;
  }
}

async function buildDefaultUsersHashMap() {
  const users = {};

  for (const [username, password] of Object.entries(
    DEFAULT_USERS_PLAINTEXT
  )) {
    users[username] = await sha256(password);
  }

  return users;
}

async function ensureAuthLoaded() {
  if (authConfig) return authConfig;

  const snap = await db.ref(AUTH_PATH).once("value");

  if (!snap.exists()) {
    authConfig = {
      users: await buildDefaultUsersHashMap()
    };
    await db.ref(AUTH_PATH).set(authConfig);
    return authConfig;
  }

  const cfg = snap.val() || {};

  // Current multi-user structure.
  if (cfg.users && typeof cfg.users === "object") {
    authConfig = {
      users: { ...cfg.users }
    };

    // Add missing default accounts without overwriting existing passwords.
    const defaults = await buildDefaultUsersHashMap();
    const missingUsers = {};

    for (const username of Object.keys(defaults)) {
      if (!authConfig.users[username]) {
        authConfig.users[username] = defaults[username];
        missingUsers[username] = defaults[username];
      }
    }

    if (Object.keys(missingUsers).length > 0) {
      await db.ref(AUTH_PATH + "/users").update(missingUsers);
    }

    return authConfig;
  }

  // Migrate the legacy single-user structure, retaining its password hash.
  if (cfg.username && cfg.passwordHash) {
    const legacyUser = String(cfg.username).trim();
    const legacyHash = String(cfg.passwordHash);
    const defaults = await buildDefaultUsersHashMap();
    const users = {};

    if (legacyUser) {
      users[legacyUser] = legacyHash;
    }

    if (!users.secretary) {
      users.secretary = defaults.secretary;
    }

    if (!users.admin) {
      users.admin = defaults.admin;
    }

    authConfig = { users };
    await db.ref(AUTH_PATH).set(authConfig);
    return authConfig;
  }

  // Replace an unrecognized structure with the default multi-user structure.
  authConfig = {
    users: await buildDefaultUsersHashMap()
  };
  await db.ref(AUTH_PATH).set(authConfig);
  return authConfig;
}

async function changePasswordPrompt() {
  try {
    if (!currentUser) {
      showToast("Please login first", "error");
      return;
    }

    const cfg = await ensureAuthLoaded();
    const userHash = cfg.users?.[currentUser];

    if (!userHash) {
      showToast("Current user not found in AppAuth", "error");
      return;
    }

    const oldPass = prompt(`Enter OLD password for "${currentUser}":`);
    if (oldPass === null) return;

    if ((await sha256(oldPass)) !== userHash) {
      showToast("Old password is wrong!", "error");
      return;
    }

    const newPass1 = prompt("Enter NEW password (min 4 chars):");
    if (newPass1 === null) return;

    if (newPass1.trim().length < 4) {
      showToast("Password too short!", "error");
      return;
    }

    const newPass2 = prompt("Confirm NEW password:");
    if (newPass2 === null) return;

    if (newPass1 !== newPass2) {
      showToast("Password not matching!", "error");
      return;
    }

    const newHash = await sha256(newPass1);

    await db.ref(`${AUTH_PATH}/users/${currentUser}`).set(newHash);
    authConfig.users[currentUser] = newHash;

    // Update remembered credentials only for the active remembered user.
    if (localStorage.getItem("rememberedUser") === currentUser) {
      localStorage.setItem("rememberedHash", newHash);
      localStorage.removeItem("rememberedPass");

      const passEl = document.getElementById("password");
      if (passEl) {
        passEl.dataset.savedHash = newHash;
        passEl.dataset.savedUser = currentUser;
        passEl.value = MASKED_PASS;
      }
    }

    showToast("Password updated successfully!", "success");
  } catch (e) {
    console.error(e);
    showToast("Password change failed!", "error");
  }
}

async function handleLogin() {
  try {
    const userEl = document.getElementById("username");
    const passEl = document.getElementById("password");
    const loginError = document.getElementById("loginError");

    const username = (userEl?.value || "").trim();
    const password = (passEl?.value || "").trim();
    const remember = !!document.getElementById("rememberMe")?.checked;

    if (loginError) {
      loginError.style.display = "none";
    }

    const cfg = await ensureAuthLoaded();
    const storedHash = cfg.users?.[username];

    if (!storedHash) {
      if (loginError) loginError.style.display = "block";
      return;
    }

    const canUseSavedHash =
      password === MASKED_PASS &&
      passEl &&
      passEl.dataset.savedHash &&
      passEl.dataset.savedUser === username;

    const enteredHash = canUseSavedHash
      ? passEl.dataset.savedHash
      : await sha256(password);

    if (enteredHash !== storedHash) {
      if (loginError) loginError.style.display = "block";
      return;
    }

    currentUser = username;
    localStorage.removeItem("rememberedPass");

    if (remember) {
      localStorage.setItem("rememberedUser", username);
      localStorage.setItem("rememberedHash", enteredHash);

      if (passEl) {
        passEl.dataset.savedHash = enteredHash;
        passEl.dataset.savedUser = username;
        passEl.value = MASKED_PASS;
      }
    } else {
      localStorage.removeItem("rememberedUser");
      localStorage.removeItem("rememberedHash");

      if (passEl) {
        delete passEl.dataset.savedHash;
        delete passEl.dataset.savedUser;
      }
    }

    const loginSection = document.getElementById("loginSection");
    const appSection = document.getElementById("appSection");

    if (loginSection) loginSection.style.display = "none";
    if (appSection) appSection.style.display = "block";

    switchTab("salesTab");
    showToast(`Login successful (${currentUser})`, "success");
  } catch (e) {
    console.error(e);
    showToast("Login error", "error");
  }
}

function handleLogout() {
  currentUser = null;

  const appSection = document.getElementById("appSection");
  const loginSection = document.getElementById("loginSection");

  if (appSection) appSection.style.display = "none";
  if (loginSection) loginSection.style.display = "block";

  // Keep remembered credentials if Remember me was enabled.
  const passEl = document.getElementById("password");
  if (passEl && !localStorage.getItem("rememberedUser")) {
    passEl.value = "";
    delete passEl.dataset.savedHash;
    delete passEl.dataset.savedUser;
  }
}

// =========================
// Date Helpers & Navigation
// =========================
function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function setCurrentPeriodFields(monthId, yearId, date = new Date()) {
  const monthField = document.getElementById(monthId);
  const yearField = document.getElementById(yearId);

  if (monthField) {
    monthField.value = String(date.getMonth() + 1).padStart(2, "0");
  }

  if (yearField) {
    yearField.value = String(date.getFullYear());
  }
}

function switchTab(tabId) {
  if (tabId !== "salesTab" && tabId !== "adminTab") return;

  const tabButtons = document.querySelectorAll(".tabs .tab");
  const sections = document.querySelectorAll(".section");

  tabButtons.forEach((tab) => tab.classList.remove("active"));
  sections.forEach((section) => section.classList.remove("active"));

  if (tabId === "salesTab") {
    tabButtons[0]?.classList.add("active");
    document.getElementById("salesTab")?.classList.add("active");
    showSalesSubPage("salesMainMenu");
    return;
  }

  tabButtons[1]?.classList.add("active");
  document.getElementById("adminTab")?.classList.add("active");

  // Set the current period before loading the Cash Book.
  setCurrentPeriodFields("adminMonth", "adminYear");

  if (typeof loadAdminData === "function") {
    loadAdminData();
  }
}

function showSalesSubPage(pageId) {
  const mainMenu = document.getElementById("salesMainMenu");
  const targetPage = document.getElementById(pageId);

  if (!mainMenu || !targetPage) return;

  mainMenu.style.display = "none";

  document.querySelectorAll(".sales-subpage").forEach((page) => {
    page.style.display = "none";
  });

  targetPage.style.display = "block";

  if (pageId === "salesMainMenu") {
    mainMenu.style.display = "block";
  } else if (pageId === "editSalesPage") {
    if (typeof loadSalesList === "function") {
      loadSalesList();
    }
  } else if (pageId === "genPdfPage") {
    // Set the PDF month and year each time this section is opened.
    setCurrentPeriodFields("pdfMonth", "pdfYear");

    // Default the stock report date if the user has not selected one.
    const stockReportDate = document.getElementById("stockReportDate");
    if (stockReportDate && !stockReportDate.value) {
      stockReportDate.value = getLocalDateInputValue();
    }
  }
}

// =========================
// App Startup
// =========================
window.addEventListener("load", async () => {
  // Migrate legacy rememberedPass (plain text) to rememberedHash.
  const legacyPlainPass = localStorage.getItem("rememberedPass");

  if (legacyPlainPass) {
    const migratedHash = await sha256(legacyPlainPass);
    localStorage.setItem("rememberedHash", migratedHash);
    localStorage.removeItem("rememberedPass");
  }

  const savedUser = localStorage.getItem("rememberedUser");
  const savedHash = localStorage.getItem("rememberedHash");

  if (savedUser && savedHash) {
    const usernameField = document.getElementById("username");
    const passEl = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");

    if (usernameField) usernameField.value = savedUser;

    if (passEl) {
      passEl.value = MASKED_PASS;
      passEl.dataset.savedHash = savedHash;
      passEl.dataset.savedUser = savedUser;
    }

    if (rememberMe) rememberMe.checked = true;
  }

  const today = getLocalDateInputValue();

  const saleDate = document.getElementById("saleDate");
  const filterSaleDate = document.getElementById("filterSaleDate");
  const stockReportDate = document.getElementById("stockReportDate");

  if (saleDate) saleDate.value = today;
  if (filterSaleDate) filterSaleDate.value = today;
  if (stockReportDate && !stockReportDate.value) {
    stockReportDate.value = today;
  }

  // Initialize displayed periods; navigation updates them again when opened.
  setCurrentPeriodFields("pdfMonth", "pdfYear");
  setCurrentPeriodFields("adminMonth", "adminYear");

  // Hook interactions so deferred dropdown refreshes run after the user finishes.
  const searchEl = document.getElementById("salesItemSearch");
  const selectEl = document.getElementById("salesItemSelect");

  [searchEl, selectEl].forEach((el) => {
    if (!el) return;

    el.addEventListener("focus", () => {
      markSalesDropdownInteracting(2500);
    });

    el.addEventListener("pointerdown", () => {
      markSalesDropdownInteracting(2500);
    });

    el.addEventListener("keydown", () => {
      markSalesDropdownInteracting(2500);
    });

    el.addEventListener("input", () => {
      markSalesDropdownInteracting(2500);
    });

    el.addEventListener("blur", () => {
      setTimeout(flushDeferredSalesDropdownRefresh, 0);
    });

    el.addEventListener("change", () => {
      setTimeout(flushDeferredSalesDropdownRefresh, 0);
    });
  });

  // Extra safety: flush deferred refreshes after the user taps elsewhere.
  document.addEventListener(
    "pointerdown",
    () => {
      setTimeout(flushDeferredSalesDropdownRefresh, 0);
    },
    true
  );

  initConnectionMonitor();
  queueInit().catch((err) => {
    console.error("Queue initialization error:", err);
  });

  ensureAuthLoaded().catch((err) => {
    console.error("Auth error:", err);
  });

  if (typeof loadItemsFromFirebase === "function") {
    loadItemsFromFirebase();
  }
});