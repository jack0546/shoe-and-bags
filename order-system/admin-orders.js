import {
  getCurrentUser,
  onAuthStateChanged,
  getAllOrders,
  getOrderDoc,
  auth,
  logOut,
  query,
  orderBy,
} from "./firebase.js";

const ORDERS_PER_PAGE = 15;
let currentPage = 1;
let allOrders = [];
let filteredOrders = [];
let currentStatusFilter = "all";
let currentSearch = "";

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (u) => {
    if (!u) {
      window.location.href = "login.html";
      return;
    }
    // Client-side admin check (security enforced by Firestore rules)
    checkAdmin(u).then((isAdmin) => {
      if (!isAdmin) {
        showToast("Access denied. Admin only.", "error");
        window.location.href = "orders.html";
        return;
      }
      document.getElementById("logoutBtn").addEventListener("click", (e) => {
        e.preventDefault();
        logOut();
      });
      setupRealtimeListener();
      setupSearchAndFilter();
      document.getElementById("exportBtn").addEventListener("click", exportToCSV);
    });
  });
});

// ─── ADMIN CHECK ──────────────────────────────────────────────────────
async function checkAdmin(u) {
  const adminLink = document.getElementById("adminLink");
  if (u.email === "admin@example.com") {
    adminLink.style.display = "inline";
    return true;
  }
  // Verify admin role from Firestore user document
  try {
    const userDoc = await getDoc(doc(db, `users/${u.uid}`));
    if (userDoc.exists() && userDoc.data().role === 'admin') {
      adminLink.style.display = "inline";
      return true;
    }
  } catch (e) {
    console.error("Error checking admin status:", e);
  }
  adminLink.style.display = "none";
  return false;
}

// ─── REALTIME LISTENER ──────────────────────────────────────────────
function setupRealtimeListener() {
  const q = query(getAllOrders(), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    allOrders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    applyFilters();
    updateStats();
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
    const matchesSearch =
      (order.orderId || "").toLowerCase().includes(currentSearch) ||
      (order.customerName || "").toLowerCase().includes(currentSearch);
    const matchesStatus =
      currentStatusFilter === "all" ||
      order.orderStatus === currentStatusFilter;
    return matchesSearch && matchesStatus;
  });

  renderOrders();
  renderPagination();
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
        <p>Try adjusting your search or filter criteria.</p>
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
            <th>Customer</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Date</th>
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
                <td>${escapeHtml(order.customerName || "N/A")}</td>
                <td>${escapeHtml(order.email || "N/A")}</td>
                <td>${escapeHtml(order.phone || "N/A")}</td>
                <td>${formatDate(order.createdAt)}</td>
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

// ─── STATS ──────────────────────────────────────────────────────────
function updateStats() {
  const total = allOrders.length;
  const sales = allOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const pending = allOrders.filter((o) => o.orderStatus === "pending").length;
  const delivered = allOrders.filter((o) => o.orderStatus === "delivered").length;

  document.getElementById("totalOrders").textContent = total;
  document.getElementById("totalSales").textContent = `₦${sales.toLocaleString()}`;
  document.getElementById("pendingOrders").textContent = pending;
  document.getElementById("deliveredOrders").textContent = delivered;
}

// ─── EXPORT CSV ─────────────────────────────────────────────────────
function exportToCSV() {
  if (filteredOrders.length === 0) {
    showToast("No orders to export.", "error");
    return;
  }

  const headers = [
    "Order ID",
    "Customer",
    "Email",
    "Phone",
    "City",
    "Date",
    "Payment Method",
    "Payment Status",
    "Order Status",
    "Total",
  ];

  const rows = filteredOrders.map((o) => [
    o.orderId,
    o.customerName,
    o.email,
    o.phone,
    o.city,
    formatDate(o.createdAt),
    o.paymentMethod,
    o.paymentStatus,
    o.orderStatus,
    o.total,
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orders-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV exported successfully.", "success");
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

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const span = document.createElement("span");
  span.textContent = message;
  toast.appendChild(span);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
