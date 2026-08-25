import { api, getCurrentUser } from "../api.js";

const existing = await getCurrentUser();
if (existing) {
  window.location.href = "index.html";
}

const form = document.getElementById("login-form");
const errorBox = document.getElementById("error-box");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.add("hidden");

  const email = document.getElementById("email-input").value.trim();
  const password = document.getElementById("password-input").value;

  try {
    await api.post("/auth/login", { email, password });
    window.location.href = "index.html";
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
