// data.js
// =========================
// Bulk Import Data (BULK_DATA) + Total Count
// =========================
// Format of each entry:
// [ itemName (string), mrp (number), stock (number) ]

const BULK_DATA = [];


const TOTAL_IMPORT_ITEMS = BULK_DATA.length;

// Expose for debugging / safety across scripts (optional but useful)
window.BULK_DATA = BULK_DATA;
window.TOTAL_IMPORT_ITEMS = TOTAL_IMPORT_ITEMS;

// Quick sanity log (helps confirm correct file is loaded)
console.log("data.js loaded. BULK_DATA length =", TOTAL_IMPORT_ITEMS);