import { api, requireUser } from "../api.js";
import { mountNav } from "../ui.js";
import { createListingForm } from "../listing-form.js";

mountNav("add");
await requireUser();

const form = createListingForm();
await form.init();

// L'annonce doit exister avant que ses photos puissent partir (elles ont besoin
// de son id). Si l'envoi des photos échoue — fichier refusé, connexion coupée —
// l'annonce, elle, est déjà créée : on retient son id pour qu'un nouveau clic
// sur « Publier » reprenne à l'envoi des photos au lieu de créer un doublon.
let createdListing = null;

form.onSubmit(
  async (payload, { uploadPendingPhotos, setBusyLabel }) => {
    if (!createdListing) {
      createdListing = await api.post("/listings", payload);
    } else {
      // Deuxième essai : l'utilisateur a pu corriger un champ entre-temps.
      setBusyLabel("Enregistrement…");
      await api.patch(`/listings/${createdListing.id}`, payload);
    }

    setBusyLabel("Envoi des photos…");
    try {
      await uploadPendingPhotos(createdListing.id);
    } catch (err) {
      err.message = `L'annonce est enregistrée, mais une photo n'a pas pu être envoyée — ${err.message} Retirez-la ou réessayez.`;
      throw err;
    }

    document.getElementById("success-view-listing").href = `listing.html?id=${createdListing.id}`;

    const formView = document.getElementById("form-view");
    formView.classList.remove("contents");
    formView.classList.add("hidden");

    const success = document.getElementById("success-view");
    success.classList.remove("hidden");
    success.classList.add("flex");
  },
  { busyLabel: "Publication…", idleLabel: "Publier l'annonce" }
);
