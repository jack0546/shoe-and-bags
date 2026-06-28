import {
  getCurrentUser,
  onAuthStateChanged,
  getOrderDoc,
  doc,
  onSnapshot,
  auth,
  logOut,
  deleteDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  deleteOrder as deleteOrderFromFirestore,
  restoreProductStock,
  verifyPayment,
  db,
} from "./firebase.js";

let currentOrder = null;
let orderId = null;

document.addEventListener("DOMContentLoaded", () => {
  orderId = new URLSearchParams(window.location.search).get("orderId");

  if (!orderId) {
    window.location.href = "orders.html";
    return;
  }

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
    loadOrder(u);
  });
});

// ─── ADMIN CHECK ─────────────────────────────────────────────────────
async function checkAdmin(u) {
  const adminLink = document.getElementById("adminLink");
  if (u.email === "admin@example.com") {
    adminLink.style.display = "inline";
    return;
  }
  // Verify admin role from Firestore user document
  try {
    const userDoc = await getDoc(doc(db, `users/${u.uid}`));
    if (userDoc.exists() && userDoc.data().role === 'admin') {
      adminLink.style.display = "inline";
      return;
    }
  } catch (e) {
    console.error("Error checking admin status:", e);
  }
  adminLink.style.display = "none";
}

// ─── LOAD ORDER ─────────────────────────────────────────────────────
async function loadOrder(user) {
  showLoading(true);
  const orderRef = doc(db, `orders/${orderId}`);

  const unsubscribe = onSnapshot(orderRef, async (snap) => {
    if (!snap.exists) {
      showToast("Order not found.", "error");
      window.location.href = "orders.html";
      return;
    }

    const orderData = snap.data();

    // Verify ownership or admin
    if (orderData.userId !== user.uid) {
      const isAdminUser = await checkAdmin(user);
      if (!isAdminUser) {
        showToast("Access denied.", "error");
        window.location.href = "orders.html";
        return;
      }
    }

    // Auto-verify pending Paystack payments
    if (orderData.paymentMethod === "paystack" && orderData.paymentStatus === "pending") {
      try {
        const result = await verifyPayment({ orderId });
        if (result.data?.success && result.data?.status === "verified") {
          showToast("Payment verified!", "success");
        }
      } catch (e) {
        // Verification may fail if not paid yet - that's expected
      }
    }

    currentOrder = { id: orderId, ...orderData };
    renderOrder(currentOrder);
    showLoading(false);
  }, (error) => {
    console.error("Error listening to order:", error);
    showToast("Failed to load order.", "error");
    showLoading(false);
  });

  return unsubscribe;
}

// ─── RENDER ORDER ───────────────────────────────────────────────────
function renderOrder(order) {
  const container = document.getElementById("orderContent");
  const isAdmin = getCurrentUser()?.email === "admin@example.com";

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h2>Shipping Information</h2>
        <p><strong>Customer:</strong> ${escapeHtml(order.customerName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(order.email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(order.phone)}</p>
        <p><strong>Address:</strong> ${escapeHtml(order.address)}</p>
        <p><strong>City:</strong> ${escapeHtml(order.city)}</p>
        ${isAdmin ? `
          <hr class="mt-20 mb-20">
          <h3>Update Delivery Info</h3>
          <div class="form-group">
            <label>Phone</label>
            <input type="text" id="editPhone" value="${escapeHtml(order.phone)}">
          </div>
          <div class="form-group">
            <label>Address</label>
            <textarea id="editAddress">${escapeHtml(order.address)}</textarea>
          </div>
          <button class="btn btn-primary btn-sm mt-10" onclick="window.updateDeliveryInfo('${orderId}')">Save</button>
        ` : ""}
      </div>

      <div class="card">
        <h2>Payment & Status</h2>
        <p><strong>Payment Method:</strong> ${escapeHtml(order.paymentMethod || "Paystack")}</p>
        <p><strong>Payment Status:</strong> <span class="badge ${getPaymentBadgeClass(order.paymentStatus)}">${escapeHtml(order.paymentStatus || "pending")}</span></p>
        <p><strong>Order Status:</strong> <span class="badge ${getStatusBadgeClass(order.orderStatus)}">${escapeHtml(order.orderStatus || "pending")}</span></p>
        <p><strong>Date:</strong> ${formatDate(order.createdAt)}</p>
        <p><strong>Estimated Delivery:</strong> ${getEstimatedDelivery(order.createdAt)}</p>
        ${isAdmin ? `
          <hr class="mt-20 mb-20">
          <h3>Admin Actions</h3>
          <div class="form-group">
            <label>Order Status</label>
            <select id="editOrderStatus">
              <option value="pending" ${order.orderStatus === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="processing" ${order.orderStatus === 'processing' ? 'selected' : ''}>Processing</option>
              <option value="shipped" ${order.orderStatus === 'shipped' ? 'selected' : ''}>Shipped</option>
              <option value="delivered" ${order.orderStatus === 'delivered' ? 'selected' : ''}>Delivered</option>
              <option value="cancelled" ${order.orderStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
          <div class="form-group">
            <label>Payment Status</label>
            <select id="editPaymentStatus">
              <option value="unpaid" ${order.paymentStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option>
              <option value="paid" ${order.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="pending" ${order.paymentStatus === 'pending' ? 'selected' : ''}>Pending</option>
            </select>
          </div>
          <button class="btn btn-primary btn-sm mt-10" onclick="window.updateOrderStatus('${orderId}')">Update Status</button>
          <button class="btn btn-danger btn-sm mt-10" onclick="window.deleteOrder('${orderId}')">Delete Order</button>
        ` : ""}
      </div>
    </div>

    <div class="card mt-20">
      <h2>Items Purchased</h2>
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Product</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${order.items
            ? order.items
                .map(
                  (item) => `
                <tr>
                  <td><img src="${escapeHtml(item.image || "https://via.placeholder.com/50")}" alt="${escapeHtml(item.productName)}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;"></td>
                  <td>${escapeHtml(item.productName)}</td>
                  <td>${item.quantity}</td>
                  <td>₦${item.price.toLocaleString()}</td>
                  <td>₦${item.subtotal.toLocaleString()}</td>
                </tr>
              `
                )
                .join("")
            : "<tr><td colspan='5'>No items</td></tr>"}
        </tbody>
      </table>

      <div class="mt-20" style="max-width:400px;margin-left:auto;">
        <div class="flex justify-between mb-10">
          <span>Subtotal</span>
          <span>₦${order.subtotal?.toLocaleString() || 0}</span>
        </div>
        <div class="flex justify-between mb-10">
          <span>Delivery Fee</span>
          <span>₦${order.deliveryFee?.toLocaleString() || 0}</span>
        </div>
        <div class="flex justify-between mb-20" style="font-size:1.2rem;font-weight:bold;">
          <span>Total</span>
          <span>₦${order.total?.toLocaleString() || 0}</span>
        </div>
      </div>
    </div>

    <div class="flex mt-20">
      <button class="btn btn-primary" onclick="window.printReceipt('${orderId}')">Print Receipt</button>
      <button class="btn btn-secondary" onclick="window.downloadReceipt('${orderId}')">Download Receipt</button>
      <button class="btn btn-outline" onclick="window.emailReceipt('${orderId}')">Email Receipt</button>
      <button class="btn btn-success" onclick="window.reorder('${orderId}')">Reorder</button>
      ${order.paymentMethod === 'paystack' ? `
        <button class="btn btn-outline" onclick="window.whatsappOrder('${orderId}')">
          💬 WhatsApp Summary
        </button>
      ` : ""}
    </div>
  `;

  // Expose functions globally for onclick
  window.updateDeliveryInfo = updateDeliveryInfo;
  window.updateOrderStatus = updateOrderStatus;
  window.deleteOrder = deleteOrder;
  window.printReceipt = printReceipt;
  window.downloadReceipt = downloadReceipt;
  window.emailReceipt = emailReceipt;
  window.reorder = reorder;
  window.whatsappOrder = whatsappOrder;
}

// ─── ADMIN ACTIONS ──────────────────────────────────────────────────
async function updateDeliveryInfo(orderId) {
  const phone = document.getElementById("editPhone").value.trim();
  const address = document.getElementById("editAddress").value.trim();
  const uid = getCurrentUser().uid;

  if (!phone || !address) {
    showToast("Please fill all fields.", "error");
    return;
  }

  showLoading(true);
  try {
    await updateOrder(orderId, { phone, address }, uid);
    showToast("Delivery info updated.", "success");
    currentOrder.phone = phone;
    currentOrder.address = address;
    renderOrder(currentOrder);
  } catch (error) {
    console.error(error);
    showToast("Update failed.", "error");
  } finally {
    showLoading(false);
  }
}

async function updateOrderStatus(orderId) {
  const newStatus = document.getElementById("editOrderStatus").value;
  const newPayment = document.getElementById("editPaymentStatus").value;
  const uid = getCurrentUser().uid;

  showLoading(true);
  try {
    const snap = await getOrderDoc(orderId);
    const orderData = snap.data();
    const previousStatus = orderData.orderStatus;

    await updateOrder(orderId, {
      orderStatus: newStatus,
      paymentStatus: newPayment,
    }, uid);

    // Restore stock if order is being cancelled
    if (newStatus === "cancelled" && previousStatus !== "cancelled" && orderData.items) {
      for (const item of orderData.items) {
        await restoreProductStock(item.productId, item.quantity);
      }
    }

    showToast("Order updated.", "success");
    currentOrder.orderStatus = newStatus;
    currentOrder.paymentStatus = newPayment;
    renderOrder(currentOrder);
  } catch (error) {
    console.error(error);
    showToast("Update failed.", "error");
  } finally {
    showLoading(false);
  }
}

async function deleteOrder(orderId) {
  if (!confirm("Are you sure you want to delete this order?")) return;

  const uid = getCurrentUser().uid;
  showLoading(true);
  try {
    const snap = await getOrderDoc(orderId);
    const orderData = snap.data();
    if (orderData.orderStatus !== "cancelled") {
      showToast("Only cancelled orders can be deleted.", "error");
      return;
    }
    await deleteOrderFromFirestore(orderId, uid);
    showToast("Order deleted.", "success");
    window.location.href = "admin.html";
  } catch (error) {
    console.error(error);
    showToast("Delete failed.", "error");
  } finally {
    showLoading(false);
  }
}

// ─── RECEIPT ────────────────────────────────────────────────────────
function printReceipt() {
  window.print();
}

function downloadReceipt() {
  if (!currentOrder) return;
  const text = generateReceiptText(currentOrder);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${currentOrder.orderId}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Receipt downloaded.", "success");
}

function generateReceiptText(order) {
  let text = `RECEIPT\n`;
  text += `Order ID: ${order.orderId}\n`;
  text += `Date: ${formatDate(order.createdAt)}\n`;
  text += `Customer: ${order.customerName}\n`;
  text += `Phone: ${order.phone}\n`;
  text += `Address: ${order.address}, ${order.city}\n`;
  text += `Payment: ${order.paymentMethod}\n`;
  text += `Status: ${order.orderStatus}\n\n`;
  text += `ITEMS:\n`;
  order.items.forEach((item) => {
    text += `${item.productName} x${item.quantity} - ₦${item.subtotal.toLocaleString()}\n`;
  });
  text += `\nSubtotal: ₦${order.subtotal?.toLocaleString()}\n`;
  text += `Delivery: ₦${order.deliveryFee?.toLocaleString()}\n`;
  text += `TOTAL: ₦${order.total?.toLocaleString()}\n`;
  return text;
}

// ─── REORDER ────────────────────────────────────────────────────────
function reorder() {
  if (!currentOrder) return;
  const cart = JSON.parse(localStorage.getItem("cart") || "[]");
  for (const item of currentOrder.items) {
    const existing = cart.find((c) => c.productId === item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      cart.push({
        productId: item.productId,
        productName: item.productName,
        image: item.image,
        price: item.price,
        quantity: item.quantity,
      });
    }
  }
  localStorage.setItem("cart", JSON.stringify(cart));
  showToast("Items added to cart.", "success");
  window.location.href = "checkout.html";
}

// ─── EMAIL RECEIPT ──────────────────────────────────────────────────
function emailReceipt() {
  if (!currentOrder) return;
  showToast("Email receipt feature coming soon. Please use Download Receipt.", "info");
  // In production, integrate with Firebase Cloud Functions or email service
}

// ─── WHATSAPP ───────────────────────────────────────────────────────
function whatsappOrder() {
  if (!currentOrder) return;
  const text = `New Order\nID: ${currentOrder.orderId}\nTotal: ₦${currentOrder.total?.toLocaleString()}\nItems: ${currentOrder.items?.length || 0}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
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

function getEstimatedDelivery(createdAt) {
  if (!createdAt) return "N/A";
  const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  const est = new Date(date);
  est.setDate(est.getDate() + 5);
  return est.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
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

function showLoading(show) {
  document.getElementById("loadingOverlay").style.display = show ? "flex" : "none";
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
