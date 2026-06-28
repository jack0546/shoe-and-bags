import {
  getCurrentUser,
  onAuthStateChanged,
  getUserOrders,
  getUserOrdersCollection,
  auth,
  logOut,
} from "./firebase.js";

const ORDERS_PER_PAGE = 10;
let currentPage = 1;
let allOrders = [];
let filteredOrders = [];
let currentStatusFilter = "all";
let currentSearch = "";

document.addEventListener("DOMContentLoaded", init);

function init() {
  onAuthStateChanged(auth, (u) => {
    if (!u) {
      window.location.href = "login.html";
      return;
    }
    document.getElementById("logoutBtn").addEventListener("click", (e) => {
      e.preventDefault();
      logOut();
    });
    checkAdmin(u);
    setupRealtimeListener();
    setupSearchAndFilter();
  });
}

function checkAdmin(u) {
  const adminLink = document.getElementById("adminLink");
  if (u.email === "admin@example.com") {
    adminLink.style.display = "inline";
  }
}

// ─── REALTIME LISTENER ──────────────────────────────────────────────
function setupRealtimeListener() {
  const uid = getCurrentUser().uid;
  const q = query(getUserOrdersCollection(uid), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    allOrders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    applyFilters();
  });
}

// ─── SEARCH & FILTER ────────────────────────────────────────────────
function setupSearchAndFilter() {
  document.getElementById("searchInput").addEventListener("input", (e) => {
    currentSearch = e.target.value.toLowerCase();
    currentPage = 1;
    applyFilters();
  });

  document.getElementById("statusFilter").addEventListener("change", (e) => {
    currentStatusFilter = e.target.value;
    currentPage = 1;
    applyFilters();
  });
}

function applyFilters() {
  filteredOrders = allOrders.filter((order) => {
    const matchesSearch = order.orderId
      .toLowerCase()
      .includes(currentSearch);
    const matchesStatus =
      currentStatusFilter === "all" ||
      order.orderStatus === currentStatusFilter;
    return matchesSearch && matchesStatus;
  });

  renderOrders();
  renderPagination();
  updateOrderCount();
}

// ─── RENDER ORDERS ──────────────────────────────────────────────────
function renderOrders() {
  const container = document.getElementById("ordersTable");
  const start = (currentPage - 1) * ORDERS_PER_PAGE;
  const end = start + ORDERS_PER_PAGE;
  const pageOrders = filteredOrders.slice(start, end);

  if (pageOrders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No orders found</h3>
        <p>You haven't placed any orders yet.</p>
        <a href="checkout.html" class="btn btn-primary">Start Shopping</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Date</th>
            <th>Items</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pageOrders
            .map((order) => `
              <tr>
                <td><strong>${escapeHtml(order.orderId)}</strong></td>
                <td>${formatDate(order.createdAt)}</td>
                <td>${order.items?.length || 0} item(s)</td>
                <td>₦${order.total?.toLocaleString() || 0}</td>
                <td><span class="badge ${getPaymentBadgeClass(order.paymentStatus)}">${escapeHtml(order.paymentStatus || "pending")}</span></td>
                <td><span class="badge ${getStatusBadgeClass(order.orderStatus)}">${escapeHtml(order.orderStatus || "pending")}</span></td>
                <td>
                  <a href="order-details.html?orderId=${encodeURIComponent(order.orderId)}" class="btn btn-sm btn-primary">View</a>
                </td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ─── PAGINATION ─────────────────────────────────────────────────────
function renderPagination() {
  const container = document.getElementById("pagination");
  const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">Previous</button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    html += `
      <button class="${i === currentPage ? "active" : ""}" data-page="${i}">${i}</button>
    `;
  }

  html += `
    <button ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">Next</button>
  `;

  container.innerHTML = html;

  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page);
      if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderOrders();
        renderPagination();
      }
    });
  });
}

// ─── UPDATE COUNT ───────────────────────────────────────────────────
function updateOrderCount() {
  document.getElementById("orderCount").textContent = `${filteredOrders.length} order(s)`;
}

// ─── HELPERS ────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
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

function getStatusBadgeClass(status) {
  const map = {
    pending: "badge-pending",
    processing: "badge-processing",
    shipped: "badge-shipped",
    delivered: "badge-delivered",
    cancelled: "badge-cancelled",
  };
  return map[status] || "badge-pending";
}

function getPaymentBadgeClass(status) {
  const map = {
    paid: "badge-paid",
    unpaid: "badge-unpaid",
    pending: "badge-pending",
  };
  return map[status] || "badge-pending";
}
