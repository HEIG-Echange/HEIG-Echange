import { api, requireUser, CONDITION_LABELS } from "../api.js";

await requireUser();

const categorySelect = document.getElementById("category-select");
const conditionSelect = document.getElementById("condition-select");
const titleInput = document.getElementById("title-input");
const descriptionInput = document.getElementById("description-input");
const errorBox = document.getElementById("error-box");
const submitBtn = document.getElementById("submit-btn");
const photosInput = document.getElementById("photos-input");
const photoPreviews = document.getElementById("photo-previews");

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

// Apercu local uniquement : aucune photo n'est envoyee au serveur (pas
// d'endpoint de stockage de fichiers pour l'instant, voir README).
photosInput.addEventListener("change", () => {
  photoPreviews.innerHTML = "";
  for (const file of photosInput.files) {
    const url = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = url;
    img.className = "w-16 h-16 object-cover rounded-lg border border-appfg/10";
    photoPreviews.appendChild(img);
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
    await api.post("/listings", { categoryId, title, description, itemCondition });
    document.getElementById("form-view").classList.add("hidden");
    document.getElementById("success-view").classList.remove("hidden");
    document.getElementById("success-view").classList.add("flex");
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Publier l'annonce";
  }
});
