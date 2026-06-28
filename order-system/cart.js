/**
 * Shopping Cart Module
 * Handles add to cart, update quantity, remove item, calculate totals.
 */

// ─── STATE ──────────────────────────────────────────────────────────
let cart = [];

// ─── INIT ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadCart();
  setupEventListeners();
});

// ─── CART OPERATIONS ────────────────────────────────────────────────
export function addToCart(item) {
  const existing = cart.find((c) => c.productId === item.productId);
  if (existing) {
    existing.quantity += item.quantity || 1;
  } else {
    cart.push({
      ...item,
      quantity: item.quantity || 1,
    });
  }
  saveCart();
  updateCartUI();
}

export function removeFromCart(productId) {
  cart = cart.filter((c) => c.productId !== productId);
  saveCart();
  updateCartUI();
}

export function updateQuantity(productId, quantity) {
  const item = cart.find((c) => c.productId === productId);
  if (item) {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    item.quantity = quantity;
  }
  saveCart();
  updateCartUI();
}

export function clearCart() {
  cart = [];
  saveCart();
  updateCartUI();
}

export function getCart() {
  return cart;
}

export function getCartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function getCartCount() {
  return cart.reduce((count, item) => count + item.quantity, 0);
}

// ─── STORAGE ────────────────────────────────────────────────────────
function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function loadCart() {
  cart = JSON.parse(localStorage.getItem("cart") || "[]");
}

// ─── UI UPDATES ─────────────────────────────────────────────────────
function updateCartUI() {
  const count = getCartCount();
  const total = getCartTotal();

  // Update cart count badge if element exists
  const badge = document.getElementById("cartCount");
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? "inline" : "none";
  }

  // Update cart total if element exists
  const totalEl = document.getElementById("cartTotal");
  if (totalEl) {
    totalEl.textContent = `₦${total.toLocaleString()}`;
  }

  // Dispatch custom event for other modules
  window.dispatchEvent(new CustomEvent("cartUpdated", { detail: { cart, count, total } }));
}

// ─── EVENT LISTENERS ────────────────────────────────────────────────
function setupEventListeners() {
  // Delegate clicks for dynamically rendered cart items
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const productId = btn.dataset.productId;

    if (action === "remove") {
      removeFromCart(productId);
    } else if (action === "increase") {
      const item = cart.find((c) => c.productId === productId);
      if (item) updateQuantity(productId, item.quantity + 1);
    } else if (action === "decrease") {
      const item = cart.find((c) => c.productId === productId);
      if (item) updateQuantity(productId, item.quantity - 1);
    }
  });
}
