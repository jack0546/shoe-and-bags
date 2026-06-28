/**
 * Orders Module
 * Shared utilities for order management across the application.
 */

import {
  getCurrentUser,
  getUserOrders,
  getOrderDoc,
  onAuthStateChanged,
  auth,
} from "./firebase.js";

// ─── GET USER ORDERS ────────────────────────────────────────────────
export async function fetchUserOrders(uid) {
  const snapshot = await getUserOrders(uid);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// ─── GET SINGLE ORDER ───────────────────────────────────────────────
export async function fetchOrder(orderId) {
  const snap = await getOrderDoc(orderId);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ─── LISTEN TO USER ORDERS ──────────────────────────────────────────
export function listenToUserOrders(uid, callback) {
  const q = query(getUserOrdersCollection(uid), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const orders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(orders);
  });
}

// ─── FILTER ORDERS ──────────────────────────────────────────────────
export function filterOrders(orders, { search = "", status = "all" } = {}) {
  return orders.filter((order) => {
    const matchesSearch =
      (order.orderId || "").toLowerCase().includes(search.toLowerCase()) ||
      (order.customerName || "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = status === "all" || order.orderStatus === status;
    return matchesSearch && matchesStatus;
  });
}

// ─── PAGINATE ──────────────────────────────────────────────────────
export function paginate(orders, page, perPage = 10) {
  const start = (page - 1) * perPage;
  return {
    items: orders.slice(start, start + perPage),
    totalPages: Math.ceil(orders.length / perPage),
    currentPage: page,
    total: orders.length,
  };
}

// ─── CALCULATE TOTALS ───────────────────────────────────────────────
export function calculateOrderTotals(items, deliveryFee = 1500) {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  return {
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
  };
}

// ─── FORMAT HELPERS ─────────────────────────────────────────────────
export function formatCurrency(amount) {
  return `₦${(amount || 0).toLocaleString()}`;
}

export function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getStatusBadgeClass(status) {
  const map = {
    pending: "badge-pending",
    processing: "badge-processing",
    shipped: "badge-shipped",
    delivered: "badge-delivered",
    cancelled: "badge-cancelled",
  };
  return map[status] || "badge-pending";
}

export function getPaymentBadgeClass(status) {
  const map = {
    paid: "badge-paid",
    unpaid: "badge-unpaid",
    pending: "badge-pending",
  };
  return map[status] || "badge-pending";
}
