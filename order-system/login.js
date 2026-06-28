import { signIn, signInWithGoogle, resetPassword, auth, logOut } from "./firebase.js";

document.addEventListener("DOMContentLoaded", () => {
  // If already logged in, redirect
  if (auth.currentUser) {
    window.location.href = "orders.html";
    return;
  }

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!email || !password) {
      showToast("Please fill all fields.", "error");
      return;
    }

    showLoading(true);
    try {
      await signIn(email, password);
      showToast("Login successful!", "success");
      window.location.href = "orders.html";
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error.code), "error");
    } finally {
      showLoading(false);
    }
  });

  document.getElementById("forgotPassword").addEventListener("click", (e) => {
    e.preventDefault();
    const email = prompt("Enter your email address:");
    if (email) {
      resetPassword(email).then(() => {
        showToast("Password reset email sent.", "success");
      }).catch((error) => {
        showToast(getErrorMessage(error.code), "error");
      });
    }
  });
});

function getErrorMessage(code) {
  const messages = {
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-email": "Invalid email address.",
    "auth/invalid-credential": "Invalid credentials.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return messages[code] || "Login failed. Please try again.";
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
