import { api, requireUser, escapeHtml } from "../api.js";
import { mountNav } from "../ui.js";
import { createListingForm } from "../listing-form.js";

mountNav("profile");

const loadingEl = document.getElementById("loading");
const editorEl = document.getElementById("editor");
const submitBar = document.getElementById("submit-bar");
const savedBox = document.getElementById("saved-box");

const id = new URLSearchParams(window.location.search).get("id");
const user = await requireUser();

function fail(message) {
  loadingEl.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(message)}</p>
    <a href="profile.html" class="inline-block mt-4 text-sm font-bold text-brand">Retour au profil</a>`;
}

if (!user) {
  // requireUser a deja redirige.
} else if (!id) {
  fail("Annonce introuvable.");
} else {
  let listing;
  try {
    listing = await api.get(`/listings/${id}`);
  } catch (err) {
    fail(err.message);
    throw err;
  }

  // Garde-fou cote client : l'API refuse deja la modification par un tiers
  // (403), mais autant ne pas afficher un formulaire inutilisable. Les admins
  // passent par l'interface de moderation, pas par cette page.
  if (listing.ownerId !== user.id) {
    fail("Vous ne pouvez modifier que vos propres annonces.");
  } else {
    loadingEl.classList.add("hidden");
    editorEl.classList.remove("hidden");
    submitBar.classList.remove("hidden");

    const form = createListingForm();
    await form.init({ listing });

    document.getElementById("delete-btn").addEventListener("click", async () => {
      if (!confirm("Retirer définitivement cette annonce ?")) return;
      try {
        await api.del(`/listings/${listing.id}`);
        window.location.href = "profile.html";
      } catch (err) {
        form.showError(err.message);
      }
    });

    form.onSubmit(
      async (payload, { uploadPendingPhotos, setBusyLabel }) => {
        await api.patch(`/listings/${listing.id}`, payload);

        setBusyLabel("Envoi des photos…");
        await uploadPendingPhotos(listing.id);

        savedBox.classList.remove("hidden");
        savedBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

        // On recharge la fiche pour repartir des photos reellement en base
        // (celles qui viennent d'etre envoyees ont maintenant un id).
        const refreshed = await api.get(`/listings/${listing.id}`);
        window.location.href = `listing.html?id=${refreshed.id}`;
      },
      { busyLabel: "Enregistrement…", idleLabel: "Enregistrer" }
    );
  }
}
