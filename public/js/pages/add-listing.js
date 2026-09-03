import { api, requireUser, CONDITION_LABELS } from "../api.js";

await requireUser();

const categorySelect = document.getElementById("category-select");
const conditionSelect = document.getElementById("condition-select");
const titleInput = document.getElementById("title-input");
const descriptionInput = document.getElementById("description-input");
const locationInput = document.getElementById("location-input");
const errorBox = document.getElementById("error-box");
const submitBtn = document.getElementById("submit-btn");
const photosInput = document.getElementById("photos-input");
const photoPreviews = document.getElementById("photo-previews");
const aiBtn = document.getElementById("ai-btn");
const aiStatus = document.getElementById("ai-status");

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

// Photos selectionnees (envoyees au serveur apres creation de l'annonce).
let selectedFiles = [];

photosInput.addEventListener("change", () => {
  selectedFiles = Array.from(photosInput.files);
  photoPreviews.innerHTML = "";
  for (const file of selectedFiles) {
    const url = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = url;
    img.className = "w-16 h-16 object-cover rounded-lg border border-appfg/10";
    photoPreviews.appendChild(img);
  }
  aiBtn.classList.toggle("hidden", selectedFiles.length === 0);
});

function setAiStatus(message, isError = false) {
  aiStatus.textContent = message;
  aiStatus.classList.remove("hidden");
  aiStatus.classList.toggle("text-red-600", isError);
  aiStatus.classList.toggle("text-mutedfg", !isError);
}

// Analyse la premiere photo via l'IA et pre-remplit categorie, etat et
// description (sans ecraser un texte deja saisi).
aiBtn.addEventListener("click", async () => {
  if (!selectedFiles.length) return;

  aiBtn.disabled = true;
  setAiStatus("Analyse de la photo en cours…");

  try {
    const formData = new FormData();
    formData.append("photo", selectedFiles[0]);
    const result = await api.upload("/listings/ai/analyze", formData);

    if (result.categoryId) categorySelect.value = String(result.categoryId);
    if (result.itemCondition) conditionSelect.value = result.itemCondition;
    if (result.description && !descriptionInput.value.trim()) {
      descriptionInput.value = result.description;
    }
    setAiStatus("Champs pré-remplis par l'IA — vérifiez et ajustez si besoin.");
  } catch (err) {
    const message =
      err.status === 503
        ? "Analyse IA indisponible pour le moment."
        : `Analyse impossible : ${err.message}`;
    setAiStatus(message, true);
  } finally {
    aiBtn.disabled = false;
  }
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

submitBtn.addEventListener("click", async () => {
  errorBox.classList.add("hidden");

  const title = titleInput.value.trim();
  const description = descriptionInput.value.trim();
  const categoryId = Number(categorySelect.value);
  const itemCondition = conditionSelect.value;
  const location = locationInput.value.trim();

  if (!title) {
    showError("Le titre est obligatoire.");
    return;
  }
  if (!description) {
    showError("La description est obligatoire.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Publication…";

  try {
    const listing = await api.post("/listings", {
      categoryId,
      title,
      description,
      itemCondition,
      location: location || null,
    });

    // Envoi des photos une fois l'annonce creee (elle porte l'id necessaire).
    for (const file of selectedFiles) {
      submitBtn.textContent = "Envoi des photos…";
      const formData = new FormData();
      formData.append("photo", file);
      await api.upload(`/listings/${listing.id}/photos`, formData);
    }

    document.getElementById("form-view").classList.add("hidden");
    document.getElementById("success-view").classList.remove("hidden");
    document.getElementById("success-view").classList.add("flex");
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Publier l'annonce";
  }
});
