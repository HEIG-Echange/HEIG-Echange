import { api } from "../api.js";

// Cette page sert deux situations qui utilisent le meme mecanisme de code :
//   - "signup"        : premiere confirmation, juste apres l'inscription ;
//   - "reverification": l'adresse doit etre reconfirmee (tous les 6 mois), le
//                       compte est suspendu ou sur le point de l'etre.
// Le parametre `reason` de l'URL ne change que les textes affiches.
const params = new URLSearchParams(window.location.search);
const reason = params.get("reason") === "reverification" ? "reverification" : "signup";

const emailInput = document.getElementById("email-input");
const codeInput = document.getElementById("code-input");
const errorBox = document.getElementById("error-box");
const infoBox = document.getElementById("info-box");
const submitBtn = document.getElementById("submit-btn");
const resendBtn = document.getElementById("resend-btn");

emailInput.value = params.get("email") ?? "";

if (reason === "reverification") {
  document.getElementById("page-title").textContent = "Reconfirmez votre adresse";
  document.getElementById("page-intro").textContent =
    "Votre confirmation a plus de 6 mois. Reconfirmez votre adresse pour réactiver votre compte : vos annonces redeviendront visibles.";
}

// Le code envoye par l'inscription est repris automatiquement quand l'API le
// renvoie (uniquement en dev/staging, cf. EXPOSE_VERIFICATION_CODE_FOR_TESTING).
const prefilledCode = params.get("code");
if (prefilledCode) codeInput.value = prefilledCode;

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  infoBox.classList.add("hidden");
}

function showInfo(message) {
  infoBox.textContent = message;
  infoBox.classList.remove("hidden");
  errorBox.classList.add("hidden");
}

document.getElementById("verify-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("hidden");

  const email = emailInput.value.trim();
  const code = codeInput.value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = "Vérification…";

  try {
    const result = await api.post("/auth/verify-email", { email, code });
    showInfo(
      result.reactivated
        ? "Compte réactivé ! Vos annonces sont de nouveau visibles."
        : "Adresse confirmée ! Vous pouvez maintenant vous connecter."
    );
    submitBtn.textContent = "Adresse confirmée ✓";
    setTimeout(() => {
      window.location.href = `login.html?email=${encodeURIComponent(email)}`;
    }, 1200);
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirmer mon adresse";
  }
});

resendBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showError("Renseignez d'abord votre adresse email.");
    return;
  }

  resendBtn.disabled = true;
  resendBtn.textContent = "Envoi…";

  try {
    const result = await api.post("/auth/resend-code", { email });
    // devVerificationCode n'est renvoye qu'en dev/staging : pratique pour
    // tester sans boite mail, absent en production.
    if (result.devVerificationCode) {
      codeInput.value = result.devVerificationCode;
      showInfo(`Code de test pré-rempli : ${result.devVerificationCode}`);
    } else {
      showInfo("Un nouveau code vient de vous être envoyé par email.");
    }
  } catch (err) {
    showError(err.message);
  } finally {
    resendBtn.disabled = false;
    resendBtn.textContent = "Renvoyer un code";
  }
});
