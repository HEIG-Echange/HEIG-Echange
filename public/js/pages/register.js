import { api, getCurrentUser } from "../api.js";

const existing = await getCurrentUser();
if (existing) {
  window.location.href = "index.html";
}

const form = document.getElementById("register-form");
const errorBox = document.getElementById("error-box");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.add("hidden");

  const displayName = document.getElementById("name-input").value.trim();
  const email = document.getElementById("email-input").value.trim();
  const password = document.getElementById("password-input").value;

  try {
    await api.post("/auth/register", { email, displayName, password });
    window.location.href = "index.html";
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
