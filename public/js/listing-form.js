// ---------------------------------------------------------------------------
// Formulaire d'annonce, partage par la creation (add-listing) et l'edition
// (edit-listing).
//
// Les deux pages ont exactement les memes champs et la meme gestion de photos ;
// seules changent la facon d'enregistrer (POST vs PATCH) et la presence de
// photos deja en ligne. Tout le reste vit ici.
// ---------------------------------------------------------------------------
import { api, getConfig, CONDITION_LABELS, escapeHtml } from "./api.js";

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
  const photosInput = el("photos-input");
  const photoPreviews = el("photo-previews");
  const photoHint = el("photo-hint");
  const aiBtn = el("ai-btn");
  const aiStatus = el("ai-status");

  // Photos choisies dans le navigateur, pas encore envoyees.
  let pendingFiles = [];
  // Photos deja en ligne (mode edition), telles que renvoyees par l'API.
  let existingPhotos = [];
  let maxPhotos = 10;
  let listingId = null;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    errorBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearError() {
    errorBox.classList.add("hidden");
  }

  function totalPhotos() {
    return existingPhotos.length + pendingFiles.length;
  }

  // Rend l'ensemble des vignettes : d'abord les photos en ligne, puis celles en
  // attente d'envoi. La premiere de la liste est la vignette de l'annonce, on
  // le signale explicitement pour que ce ne soit pas une surprise.
  function renderPhotos() {
    photoPreviews.innerHTML = "";

    existingPhotos.forEach((photo, index) => {
      const div = document.createElement("div");
      div.className = "photo-thumb";
      div.innerHTML = `
        <img src="${escapeHtml(photo.url)}" alt="Photo ${index + 1}" />
        <button type="button" class="thumb-remove" title="Supprimer cette photo" aria-label="Supprimer cette photo">✕</button>
        ${index === 0 ? `<span class="thumb-cover">Vignette</span>` : ""}
      `;
      div.querySelector(".thumb-remove").addEventListener("click", async () => {
        if (!confirm("Supprimer cette photo de l'annonce ?")) return;
        try {
          await api.del(`/listings/${listingId}/photos/${photo.id}`);
          existingPhotos = existingPhotos.filter((p) => p.id !== photo.id);
          renderPhotos();
        } catch (err) {
          showError(err.message);
        }
      });
      photoPreviews.appendChild(div);
    });

    pendingFiles.forEach((file, index) => {
      const div = document.createElement("div");
      div.className = "photo-thumb";
      const url = URL.createObjectURL(file);
      div.innerHTML = `
        <img src="${url}" alt="Nouvelle photo ${index + 1}" />
        <button type="button" class="thumb-remove" title="Retirer cette photo" aria-label="Retirer cette photo">✕</button>
        ${existingPhotos.length === 0 && index === 0 ? `<span class="thumb-cover">Vignette</span>` : ""}
      `;
      div.querySelector(".thumb-remove").addEventListener("click", () => {
        // On retire par identite d'objet : deux fichiers peuvent porter le
        // meme nom sans etre le meme fichier.
        pendingFiles = pendingFiles.filter((f) => f !== file);
        URL.revokeObjectURL(url);
        renderPhotos();
      });
      photoPreviews.appendChild(div);
    });

    photoHint.textContent = `${totalPhotos()} / ${maxPhotos} photo${totalPhotos() > 1 ? "s" : ""}`;
    aiBtn.classList.toggle("hidden", pendingFiles.length === 0);
  }

  function setAiStatus(message, isError = false) {
    aiStatus.textContent = message;
    aiStatus.classList.remove("hidden");
    aiStatus.classList.toggle("text-red-600", isError);
    aiStatus.classList.toggle("text-mutedfg", !isError);
  }

  // Envoie toutes les photos en attente en une seule requete multipart
  // (l'API accepte plusieurs fichiers sous le champ "photos").
  async function uploadPendingPhotos(id) {
    if (pendingFiles.length === 0) return;
    const formData = new FormData();
    for (const file of pendingFiles) formData.append("photos", file);
    await api.upload(`/listings/${id}/photos`, formData);
    pendingFiles = [];
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
    // Le statut n'existe que sur le formulaire d'edition.
    if (statusSelect) payload.status = statusSelect.value;
    return payload;
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  async function init({ listing } = {}) {
    const config = await getConfig();
    maxPhotos = config.maxPhotosPerListing ?? 10;

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
      listingId = listing.id;
      titleInput.value = listing.title ?? "";
      descriptionInput.value = listing.description ?? "";
      locationInput.value = listing.location ?? "";
      if (listing.categoryId) categorySelect.value = String(listing.categoryId);
      if (listing.itemCondition) conditionSelect.value = listing.itemCondition;
      if (statusSelect && listing.status) statusSelect.value = listing.status;
      existingPhotos = listing.photos ?? [];
    }

    photosInput.addEventListener("change", () => {
      const chosen = Array.from(photosInput.files);
      const room = maxPhotos - totalPhotos();

      if (chosen.length > room) {
        showError(
          `Une annonce est limitée à ${maxPhotos} photos : ${chosen.length - room} photo(s) ignorée(s).`
        );
      } else {
        clearError();
      }

      pendingFiles = pendingFiles.concat(chosen.slice(0, Math.max(0, room)));
      // On vide l'input pour pouvoir re-selectionner le meme fichier apres
      // l'avoir retire.
      photosInput.value = "";
      renderPhotos();
    });

    aiBtn.addEventListener("click", async () => {
      if (!pendingFiles.length) return;

      aiBtn.disabled = true;
      setAiStatus("Analyse de la photo en cours…");

      try {
        const formData = new FormData();
        formData.append("photo", pendingFiles[0]);
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

    renderPhotos();
  }

  // -------------------------------------------------------------------------
  // Enregistrement
  // -------------------------------------------------------------------------

  function onSubmit(handler, { busyLabel, idleLabel }) {
    // La mise en page pose deux boutons d'enregistrement (barre du bas sur
    // mobile, en-tete sur desktop) : un seul porte la logique, les autres sont
    // marques data-submit-mirror et se contentent de relayer le clic. On tient
    // leur libelle et leur etat synchronises pour ne pas laisser un bouton
    // "Publication…" fige apres une erreur.
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
          uploadPendingPhotos,
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
