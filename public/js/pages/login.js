import { api, getCurrentUser } from "../api.js";

// ?next=... : page a rouvrir apres connexion (ex. l'annonce depuis laquelle on
// a clique sur "Se connecter pour contacter"). Restreinte a un chemin relatif
// du site : un "next" absolu permettrait une redirection vers un domaine tiers.
const params = new URLSearchParams(window.location.search);
const rawNext = params.get("next") ?? "";
const nextUrl = /^[\w.-]+\.html(\?[^#]*)?$/.test(rawNext) ? rawNext : "index.html";

const existing = await getCurrentUser();
if (existing) {
  window.location.href = nextUrl;
}

const form = document.getElementById("login-form");
const errorBox = document.getElementById("error-box");
const emailInput = document.getElementById("email-input");

// Retour depuis la page de confirmation : on repropose la meme adresse.
const prefill = params.get("email");
if (prefill) emailInput.value = prefill;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.add("hidden");

  const email = emailInput.value.trim();
  const password = document.getElementById("password-input").value;

  try {
    await api.post("/auth/login", { email, password });
    window.location.href = nextUrl;
  } catch (err) {
    // Le compte existe et le mot de passe est bon, mais l'adresse n'est pas
    // (ou plus) confirmee : on emmene directement sur la page de code plutot
    // que d'afficher un message que l'utilisateur ne saurait pas quoi faire.
    if (err.code === "EMAIL_NOT_VERIFIED") {
      window.location.href = `verify.html?email=${encodeURIComponent(email)}&reason=signup`;
      return;
    }
    if (err.code === "EMAIL_REVERIFICATION_REQUIRED") {
      const code = err.data?.devVerificationCode;
      window.location.href =
        `verify.html?email=${encodeURIComponent(email)}&reason=reverification` +
        (code ? `&code=${encodeURIComponent(code)}` : "");
      return;
    }

    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
