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
    const account = await api.post("/auth/register", {
      email,
      displayName,
      password,
    });

    // Le compte existe mais n'est PAS actif tant que l'adresse n'est pas
    // confirmee : on n'envoie donc pas sur l'accueil, mais sur la saisie du
    // code recu par email.
    // devVerificationCode n'est renseigne qu'en dev/staging
    // (EXPOSE_VERIFICATION_CODE_FOR_TESTING) : en production, l'utilisateur
    // recopie le code depuis sa boite mail.
    const code = account.devVerificationCode;
    window.location.href =
      `verify.html?email=${encodeURIComponent(email)}&reason=signup` +
      (code ? `&code=${encodeURIComponent(code)}` : "");
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
