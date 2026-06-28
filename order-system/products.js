import { getCurrentUser, onAuthStateChanged, auth, logOut } from "./firebase.js";
import { addToCart } from "./cart.js";

// Sample products - in production fetch from Firestore
const products = [
  { productId: "prod-1", productName: "Wireless Headphones", price: 25000, image: "https://via.placeholder.com/300?text=Headphones", stock: 20 },
  { productId: "prod-2", productName: "Smart Watch", price: 45000, image: "https://via.placeholder.com/300?text=Smart+Watch", stock: 15 },
  { productId: "prod-3", productName: "Laptop Stand", price: 8000, image: "https://via.placeholder.com/300?text=Laptop+Stand", stock: 30 },
  { productId: "prod-4", productName: "USB-C Hub", price: 12000, image: "https://via.placeholder.com/300?text=USB-C+Hub", stock: 25 },
  { productId: "prod-5", productName: "Mechanical Keyboard", price: 35000, image: "https://via.placeholder.com/300?text=Keyboard", stock: 10 },
  { productId: "prod-6", productName: "Wireless Mouse", price: 10000, image: "https://via.placeholder.com/300?text=Mouse", stock: 40 },
];

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (u) => {
    if (u) {
      document.getElementById("loginBtn").style.display = "none";
      document.getElementById("logoutBtn").style.display = "inline";
      document.getElementById("logoutBtn").addEventListener("click", (e) => {
        e.preventDefault();
        logOut();
      });
      if (u.email === "admin@example.com") {
        document.getElementById("adminLink").style.display = "inline";
      }
    }
  });

  renderProducts();
});

function renderProducts() {
  const grid = document.getElementById("productsGrid");
  grid.innerHTML = products
    .map(
      (p) => `
      <div class="card" style="text-align:center;">
        <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.productName)}" style="width:100%;height:200px;object-fit:cover;border-radius:6px;margin-bottom:12px;">
        <h3>${escapeHtml(p.productName)}</h3>
        <p style="font-size:1.1rem;font-weight:bold;color:#2563eb;">₦${p.price.toLocaleString()}</p>
        <p class="text-muted" style="font-size:0.85rem;">Stock: ${p.stock}</p>
        <button class="btn btn-primary mt-10" onclick="window.addToCart('${p.productId}')">Add to Cart</button>
      </div>
    `
    )
    .join("");

  window.addToCart = (productId) => {
    const product = products.find((p) => p.productId === productId);
    if (!product) return;
    addToCart({
      productId: product.productId,
      productName: product.productName,
      image: product.image,
      price: product.price,
      quantity: 1,
    });
    showToast("Added to cart!", "success");
  };
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
