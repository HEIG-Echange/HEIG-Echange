import { api, requireUser } from "../api.js";
import { mountNav } from "../ui.js";
import { createListingForm } from "../listing-form.js";

mountNav("add");
await requireUser();

const form = createListingForm();
await form.init();

form.onSubmit(
  async (payload, { uploadPendingPhotos, setBusyLabel }) => {
    const listing = await api.post("/listings", payload);

    // Les photos partent apres la creation : elles ont besoin de l'id.
    setBusyLabel("Envoi des photos…");
    await uploadPendingPhotos(listing.id);

    document.getElementById("success-view-listing").href = `listing.html?id=${listing.id}`;

    const formView = document.getElementById("form-view");
    formView.classList.remove("contents");
    formView.classList.add("hidden");

    const success = document.getElementById("success-view");
    success.classList.remove("hidden");
    success.classList.add("flex");
  },
  { busyLabel: "Publication…", idleLabel: "Publier l'annonce" }
);
