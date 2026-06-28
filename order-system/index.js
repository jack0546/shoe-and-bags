import { getCurrentUser, onAuthStateChanged, auth, logOut } from "./firebase.js";

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
    } else {
      document.getElementById("loginBtn").style.display = "inline";
      document.getElementById("logoutBtn").style.display = "none";
      document.getElementById("adminLink").style.display = "none";
    }
  });
});
