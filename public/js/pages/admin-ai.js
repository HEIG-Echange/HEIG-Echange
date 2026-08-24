// ---------------------------------------------------------------------------
// Réglages de l'analyse IA des photos — page réservée aux administrateurs.
//
// Elle édite trois valeurs (modèle, prompt système, prompt d'analyse) stockées
// en base par l'API (GET/PUT /admin/ai-settings). Le but : pouvoir corriger la
// formulation d'un prompt ou changer de modèle depuis le navigateur, sans
// toucher au code ni redéployer.
// ---------------------------------------------------------------------------
import { api, requireUser, escapeHtml } from "../api.js";
import { mountNav } from "../ui.js";

mountNav("profile");

const loadingEl = document.getElementById("loading");
const editorEl = document.getElementById("editor");
const errorBox = document.getElementById("error-box");
const savedBox = document.getElementById("saved-box");
const providerBox = document.getElementById("provider-box");

const modelInput = document.getElementById("model-input");
const systemInput = document.getElementById("system-input");
const userInput = document.getElementById("user-input");

const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const mirrors = [...document.querySelectorAll("[data-save-mirror]")];

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  savedBox.classList.add("hidden");
}

function clearBoxes() {
  errorBox.classList.add("hidden");
  savedBox.classList.add("hidden");
}

function fail(message) {
  loadingEl.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(message)}</p>
    <a href="profile.html" class="inline-block mt-4 text-sm font-bold text-brand">Retour au profil</a>`;
}

let defaults = null;

function fill(settings) {
  modelInput.value = settings.model ?? "";
  systemInput.value = settings.systemPrompt ?? "";
  userInput.value = settings.userPrompt ?? "";
}

function renderProvider(data) {
  providerBox.className = data.configured
    ? "border rounded-xl px-4 py-3 text-sm bg-emerald-50 border-emerald-200 text-emerald-800"
    : "border rounded-xl px-4 py-3 text-sm bg-amber-50 border-amber-200 text-amber-800";
  providerBox.textContent = data.configured
    ? "Fournisseur : Hugging Face — jeton d'API configuré, l'analyse est active."
    : "Fournisseur : Hugging Face — aucun jeton d'API configuré sur le serveur "
      + "(HUGGINGFACE_API_KEY). Les prompts sont modifiables, mais l'analyse "
      + "répondra « indisponible » tant que le jeton n'est pas en place.";
}

const user = await requireUser();

if (user) {
  let data;
  try {
    data = await api.get("/admin/ai-settings");
  } catch (err) {
    // 403 : compte non administrateur. L'API tranche, la page ne fait que le
    // dire proprement.
    fail(
      err.status === 403
        ? "Cette page est réservée aux administrateurs."
        : err.message
    );
    throw err;
  }

  defaults = data.defaults;
  fill(data.effective);
  renderProvider(data);

  loadingEl.classList.add("hidden");
  editorEl.classList.remove("hidden");

  const setBusy = (busy) => {
    for (const btn of [saveBtn, ...mirrors]) {
      btn.disabled = busy;
      btn.textContent = busy ? "Enregistrement…" : "Enregistrer";
    }
  };

  async function save() {
    clearBoxes();

    if (!modelInput.value.trim()) {
      showError("Le modèle est obligatoire.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.put("/admin/ai-settings", {
        model: modelInput.value,
        systemPrompt: systemInput.value,
        userPrompt: userInput.value,
      });
      fill(result.effective);
      savedBox.classList.remove("hidden");
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  saveBtn.addEventListener("click", save);
  for (const mirror of mirrors) mirror.addEventListener("click", save);

  // Remise à zéro : on renvoie des valeurs vides, ce que l'API interprète comme
  // « efface la personnalisation » (la valeur repart alors de la configuration
  // de déploiement, ou du défaut du code).
  resetBtn.addEventListener("click", async () => {
    if (!confirm("Effacer la personnalisation et revenir aux valeurs par défaut ?")) return;
    clearBoxes();
    setBusy(true);
    try {
      const result = await api.put("/admin/ai-settings", {
        model: "",
        systemPrompt: "",
        userPrompt: "",
      });
      fill(result.effective ?? defaults);
      savedBox.classList.remove("hidden");
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  });
}
