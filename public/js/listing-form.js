// ---------------------------------------------------------------------------
// Formulaire d'annonce, partagé par la création (add-listing) et l'édition
// (edit-listing).
//
// Les deux pages ont exactement les mêmes champs ; seules changent la façon
// d'enregistrer (POST vs PATCH) et la présence de photos déjà en ligne. Tout
// ce qui touche aux photos vit dans `photo-picker.js`.
// ---------------------------------------------------------------------------
import { api, CONDITION_LABELS } from "./api.js";
import { createPhotoPicker } from "./photo-picker.js";

export function createListingForm() {
  const el = (id) => document.getElementById(id);

  const categorySelect = el("category-select");
  const conditionSelect = el("condition-select");
  const titleInput = el("title-input");
  const descriptionInput = el("description-input");
  const locationInput = el("location-input");
  const statusSelect = el("status-select");
  const errorBox = el("error-box");
  const submitBtn = el("submit-btn");
  const aiBtn = el("ai-btn");
  const aiStatus = el("ai-status");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    errorBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }

  const photos = createPhotoPicker({
    dropzone: el("photo-dropzone"),
    input: el("photos-input"),
    previews: el("photo-previews"),
    hint: el("photo-hint"),
    onError: showError,
    // Le bouton IA n'a de sens qu'avec une photo pas encore envoyée : c'est
    // elle qu'on transmet au modèle.
    onChange: () => aiBtn.classList.toggle("hidden", !photos.hasPending()),
  });

  function setAiStatus(message, isError = false) {
    aiStatus.textContent = message;
    aiStatus.classList.remove("hidden");
    aiStatus.classList.toggle("text-red-600", isError);
    aiStatus.classList.toggle("text-mutedfg", !isError);
  }

  function readForm() {
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const location = locationInput.value.trim();

    if (!title) {
      showError("Le titre est obligatoire.");
      return null;
    }
    if (!description) {
      showError("La description est obligatoire.");
      return null;
    }

    const payload = {
      categoryId: Number(categorySelect.value),
      title,
      description,
      itemCondition: conditionSelect.value,
      location: location || null,
    };
    // Le statut n'existe que sur le formulaire d'édition.
    if (statusSelect) payload.status = statusSelect.value;
    return payload;
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  async function init({ listing } = {}) {
    for (const [value, label] of Object.entries(CONDITION_LABELS)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      conditionSelect.appendChild(opt);
    }

    const categories = await api.get("/categories");
    for (const cat of categories) {
      const opt = document.createElement("option");
      opt.value = String(cat.id);
      opt.textContent = cat.label;
      categorySelect.appendChild(opt);
    }

    if (listing) {
      titleInput.value = listing.title ?? "";
      descriptionInput.value = listing.description ?? "";
      locationInput.value = listing.location ?? "";
      if (listing.categoryId) categorySelect.value = String(listing.categoryId);
      if (listing.itemCondition) conditionSelect.value = listing.itemCondition;
      if (statusSelect && listing.status) statusSelect.value = listing.status;
    }

    await photos.init({ listing });

    aiBtn.addEventListener("click", async () => {
      const [first] = photos.pendingFiles();
      if (!first) return;

      aiBtn.disabled = true;
      setAiStatus("Analyse de la photo en cours…");

      try {
        const formData = new FormData();
        formData.append("photo", first);
        const result = await api.upload("/listings/ai/analyze", formData);

        if (result.categoryId) categorySelect.value = String(result.categoryId);
        if (result.itemCondition) conditionSelect.value = result.itemCondition;
        if (result.description && !descriptionInput.value.trim()) {
          descriptionInput.value = result.description;
        }
        setAiStatus("Champs pré-remplis par l'IA — vérifiez et ajustez si besoin.");
      } catch (err) {
        setAiStatus(
          err.status === 503
            ? "Analyse IA indisponible pour le moment."
            : `Analyse impossible : ${err.message}`,
          true
        );
      } finally {
        aiBtn.disabled = false;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Enregistrement
  // -------------------------------------------------------------------------

  function onSubmit(handler, { busyLabel, idleLabel }) {
    // La mise en page pose deux boutons d'enregistrement (barre du bas sur
    // mobile, en-tête sur desktop) : un seul porte la logique, les autres sont
    // marqués data-submit-mirror et se contentent de relayer le clic. On tient
    // leur libellé et leur état synchronisés pour ne pas laisser un bouton
    // « Publication… » figé après une erreur.
    const mirrors = [...document.querySelectorAll("[data-submit-mirror]")];
    for (const mirror of mirrors) {
      mirror.addEventListener("click", () => submitBtn.click());
    }

    const setState = (label, disabled) => {
      for (const btn of [submitBtn, ...mirrors]) {
        btn.textContent = label;
        btn.disabled = disabled;
      }
    };

    submitBtn.addEventListener("click", async () => {
      clearError();
      const payload = readForm();
      if (!payload) return;

      setState(busyLabel, true);

      try {
        await handler(payload, {
          // Envoie les photos en attente en affichant l'avancement : sur une
          // connexion lente, plusieurs photos prennent du temps et un bouton
          // muet donne l'impression que rien ne se passe.
          uploadPendingPhotos: (id) =>
            photos.uploadPending(id, (done, count) => {
              if (count > 0) setState(`Envoi des photos ${done}/${count}…`, true);
            }),
          setBusyLabel: (label) => setState(label, true),
        });
      } catch (err) {
        showError(err.message);
        setState(idleLabel, false);
      }
    });
  }

  return { init, onSubmit, showError, clearError };
}
