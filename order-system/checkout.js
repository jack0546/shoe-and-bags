import {
  getCurrentUser,
  onAuthStateChanged,
  serverTimestamp,
  createOrderDoc,
  createUserOrderDoc,
  reduceProductStock,
  auth,
  logOut,
  getDocs,
  getDoc,
  doc,
  collection,
  runTransaction,
  writeBatch,
  initializePayment,
  createCashOrder,
  db,
} from "./firebase.js";

// ─── STATE ──────────────────────────────────────────────────────────
let user = null;
let cart = [];

// ─── INIT ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (u) => {
    user = u;
    if (u) {
      document.getElementById("authCheck").style.display = "none";
      document.getElementById("checkoutForm").style.display = "block";
      loadUserInfo(u);
      loadCart();
      setupEventListeners();
      checkAdmin(u);
    } else {
      document.getElementById("authCheck").style.display = "block";
      document.getElementById("checkoutForm").style.display = "none";
      document.getElementById("goToLogin").addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = "login.html";
      });
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", (e) => {
    e.preventDefault();
    logOut();
  });
});

// ─── AUTH CHECK ─────────────────────────────────────────────────────
function checkAdmin(u) {
  const adminLink = document.getElementById("adminLink");
  if (u.email === "narhsnazzisco@gmail.com" || (u.email && u.email.toLowerCase() === "narhsnazzisco@gmail.com")) {
    adminLink.style.display = "inline";
    return true;
  }
  // Verify admin role from Firestore user document
  return getDoc(doc(db, `users/${u.uid}`)).then((userDoc) => {
    if (userDoc.exists() && userDoc.data().role === 'admin') {
      adminLink.style.display = "inline";
      return true;
    }
    adminLink.style.display = "none";
    return false;
  }).catch((e) => {
    console.error("Error checking admin status:", e);
    adminLink.style.display = "none";
    return false;
  });
}

// ─── LOAD USER INFO ─────────────────────────────────────────────────
function loadUserInfo(u) {
  document.getElementById("email").value = u.email || "";
}

// ─── LOAD CART ──────────────────────────────────────────────────────
function loadCart() {
  cart = JSON.parse(localStorage.getItem("cart") || "[]");
  renderCart();
}

// ─── RENDER CART ────────────────────────────────────────────────────
function renderCart() {
  const container = document.getElementById("cartItems");
  if (cart.length === 0) {
    container.innerHTML =
      '<p class="text-muted">Your cart is empty.</p>';
    document.getElementById("placeOrderBtn").disabled = true;
    updateTotals(0);
    return;
  }

  let subtotal = 0;
  container.innerHTML = cart
    .map(
      (item) => {
        const lineTotal = item.price * item.quantity;
        subtotal += lineTotal;
        return `
          <div class="order-item">
            <img src="${escapeHtml(item.image || "https://via.placeholder.com/60")}" alt="${escapeHtml(item.productName)}">
            <div class="order-item-info">
              <h4>${escapeHtml(item.productName)}</h4>
              <p>Qty: ${item.quantity} × ₦${item.price.toLocaleString()}</p>
            </div>
            <div style="font-weight:600;">₦${lineTotal.toLocaleString()}</div>
          </div>
        `;
      }
    )
    .join("");

  updateTotals(subtotal);
}

// ─── UPDATE TOTALS ──────────────────────────────────────────────────
function updateTotals(subtotal) {
  const delivery = 1500;
  const total = subtotal + delivery;
  document.getElementById("subtotal").textContent = `₦${subtotal.toLocaleString()}`;
  document.getElementById("deliveryFee").textContent = `₦${delivery.toLocaleString()}`;
  document.getElementById("total").textContent = `₦${total.toLocaleString()}`;
}

// ─── EVENT LISTENERS ────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById("placeOrderBtn").addEventListener("click", placeOrder);
}

// ─── CALLABLE: Initialize Paystack Payment ─────────────────────────
async function initializePaymentWithPaystack(shipping, validatedCart, subtotal, total) {
  const result = await initializePayment({
    cart: validatedCart,
    shipping: {
      customerName: shipping.customerName,
      email: shipping.email,
      phone: shipping.phone,
      address: shipping.address,
      city: shipping.city,
    },
  });

  return {
    orderId: result.data.orderId,
    authorization_url: result.data.authorization_url,
    reference: result.data.reference,
    access_code: result.data.access_code,
  };
}

// ─── PLACE ORDER ────────────────────────────────────────────────────
async function placeOrder() {
  if (!getCurrentUser()) {
    showToast("Please log in to place an order.", "error");
    return;
  }

  const form = document.getElementById("shippingForm");
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const customerName = document.getElementById("customerName").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address = document.getElementById("address").value.trim();
  const city = document.getElementById("city").value.trim();
  const paymentMethod = document.getElementById("paymentMethod").value;

  // Basic input validation
  if (customerName.length < 2 || customerName.length > 100) {
    showToast("Please enter a valid name (2-100 characters).", "error");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast("Please enter a valid email address.", "error");
    return;
  }
  if (!/^\+?[\d\s\-()]{7,15}$/.test(phone)) {
    showToast("Please enter a valid phone number.", "error");
    return;
  }
  if (address.length < 5 || address.length > 500) {
    showToast("Please enter a valid address (5-500 characters).", "error");
    return;
  }
  if (city.length < 2 || city.length > 100) {
    showToast("Please enter a valid city (2-100 characters).", "error");
    return;
  }

  showLoading(true);

  try {
    const shipping = { customerName, email, phone, address, city };

    if (paymentMethod === "paystack") {
      // ─── PAYSTACK: Use Cloud Function ─────────────────────────────
      const { validatedCart, subtotal } = await validateCart();
      const total = subtotal + 1500;

      const paymentResult = await initializePaymentWithPaystack(shipping, validatedCart, subtotal, total);

      // Clear cart before redirect
      localStorage.removeItem("cart");

      showToast("Redirecting to payment...", "success");

      // Redirect to Paystack
      setTimeout(() => {
        window.location.href = paymentResult.authorization_url;
      }, 500);
    } else {
      // ─── CASH / BANK TRANSFER: Use Cloud Function ──────────────
      const { validatedCart, subtotal } = await validateCart();
      
      const result = await createCashOrder({
        cart: validatedCart,
        shipping: { customerName, email, phone, address, city },
        paymentMethod
      });

      localStorage.removeItem("cart");
      showToast("Order placed successfully!", "success");
      setTimeout(() => {
        window.location.href = `order-details.html?orderId=${result.data.orderId}`;
      }, 1000);
    }
  } catch (error) {
    console.error("Error placing order:", error);
    showToast(error.message || "Failed to place order. Please try again.", "error");
  } finally {
    showLoading(false);
  }
}

// ─── VALIDATE CART AGAINST FIRESTORE ────────────────────────────────
async function validateCart() {
  if (cart.length === 0) {
    throw new Error("Your cart is empty.");
  }

  const productsSnap = await getDocs(collection(db, "products"));
  const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const validatedCart = [];
  let subtotal = 0;

  for (const cartItem of cart) {
    const product = products.find(p => p.productId === cartItem.productId);

    if (!product) {
      throw new Error(`Product "${cartItem.productId}" no longer exists.`);
    }

    if (product.stock < cartItem.quantity) {
      throw new Error(`Insufficient stock for "${product.productName}". Available: ${product.stock}, Requested: ${cartItem.quantity}`);
    }

    const price = product.price;
    const quantity = Math.max(1, Math.min(cartItem.quantity, product.stock));
    const lineTotal = price * quantity;

    validatedCart.push({
      productId: product.productId,
      productName: product.productName,
      image: product.image || cartItem.image,
      quantity,
      price,
      subtotal: lineTotal,
    });

    subtotal += lineTotal;
  }

  return { validatedCart, subtotal };
}

// ─── UI HELPERS ─────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showLoading(show) {
  document.getElementById("loadingOverlay").style.display = show
    ? "flex"
    : "none";
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const span = document.createElement("span");
  span.textContent = message;
  toast.appendChild(span);
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}
