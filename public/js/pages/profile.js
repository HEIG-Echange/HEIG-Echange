import {
  api,
  requireUser,
  logout,
  getConfig,
  buildInviteMailto,
  initials,
  escapeHtml,
} from "../api.js";
import {
  mountNav,
  mountNotificationBell,
  mountViewToggle,
  renderEmailBanner,
  listingCardHtml,
  icon,
} from "../ui.js";

mountNav("profile");
mountNotificationBell(document.getElementById("notif-bell"));

const user = await requireUser();

document.getElementById("avatar").textContent = initials(user.displayName);
document.getElementById("display-name").textContent = user.displayName;
document.getElementById("email").textContent = user.email;
document.getElementById("role-badge").textContent =
  user.role === "admin" ? "Administrateur" : "Étudiant·e";

// Acces aux reglages reserves aux admins (aujourd hui : prompts de l analyse
// IA des photos). Le lien reste cache pour les autres — l API refuse de toute
// facon les routes /admin a un compte non administrateur.
if (user.role === "admin") {
  document.getElementById("admin-links").classList.remove("hidden");
}

const logoutBtn = document.getElementById("logout-btn");
logoutBtn.innerHTML = icon("logout");
logoutBtn.addEventListener("click", () => logout());

renderEmailBanner(user, document.getElementById("account-banner"));

// QR code du profil : genere par l'API, qui encode PUBLIC_BASE_URL — le code
// scanne depuis un telephone doit ouvrir le site public, pas un localhost.
document.getElementById("qr-img").src = `/users/${user.id}/qr`;

const { publicBaseUrl } = await getConfig();
const profileUrl = `${publicBaseUrl}/u.html?id=${user.id}`;
document.getElementById("profile-url").textContent = profileUrl;
document.getElementById("invite-btn").href = buildInviteMailto(publicBaseUrl);

document.getElementById("share-btn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Mon profil HEIG-Échange", url: profileUrl });
      return;
    } catch {
      // Partage annule : on retombe sur la copie.
    }
  }
  try {
    await navigator.clipboard.writeText(profileUrl);
    btn.textContent = "Lien copié !";
    setTimeout(() => {
      btn.textContent = "Copier le lien";
    }, 2000);
  } catch {
    prompt("Copiez le lien de votre profil :", profileUrl);
  }
});

// ---------------------------------------------------------------------------
// Mes annonces
// ---------------------------------------------------------------------------

const listingsEl = document.getElementById("my-listings");
let viewMode = "grid";
let myListings = [];

/**
 * Reprend la carte partagee et lui superpose les actions du proprietaire
 * (modifier / retirer), qui n'existent que sur cette page.
 */
function ownerCard(listing) {
  const wrapper = document.createElement("div");
  wrapper.className = "relative";
  wrapper.innerHTML = listingCardHtml(listing, viewMode);

  const actions = document.createElement("div");
  actions.className = "absolute top-2 right-2 flex gap-1.5";
  actions.innerHTML = `
    <a href="edit-listing.html?id=${listing.id}" title="Modifier l'annonce" aria-label="Modifier l'annonce"
       class="w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center transition-colors">${icon("edit")}</a>
    <button type="button" data-delete title="Retirer l'annonce" aria-label="Retirer l'annonce"
            class="w-8 h-8 rounded-full bg-black/55 hover:bg-red-600 text-white flex items-center justify-center transition-colors">${icon("trash")}</button>
  `;
  wrapper.appendChild(actions);

  actions.querySelector("[data-delete]").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("Retirer cette annonce ?")) return;
    try {
      await api.del(`/listings/${listing.id}`);
      myListings = myListings.filter((l) => l.id !== listing.id);
      renderListings();
    } catch (err) {
      alert(err.message);
    }
  });

  return wrapper;
}

function renderListings() {
  listingsEl.className = `listing-grid${viewMode === "compact" ? " is-compact" : ""}`;
  listingsEl.innerHTML = "";

  // Les deux compteurs de l'en-tete se deduisent des annonces deja chargees :
  // pas de requete supplementaire.
  document.getElementById("active-count").textContent = String(
    myListings.filter((l) => l.status !== "closed").length
  );
  document.getElementById("given-count").textContent = String(
    myListings.filter((l) => l.status === "closed").length
  );

  if (myListings.length === 0) {
    listingsEl.innerHTML = `
      <div class="col-span-full text-center py-10 border border-dashed border-appfg/15 rounded-2xl">
        <p class="text-sm text-mutedfg">Vous n'avez pas encore publié d'annonce.</p>
        <a href="add-listing.html" class="inline-block mt-3 text-sm font-bold text-brand hover:underline">Mettre un objet à disposition</a>
      </div>`;
    return;
  }

  for (const listing of myListings) {
    listingsEl.appendChild(ownerCard(listing));
  }
}

async function loadMyListings() {
  try {
    myListings = await api.get(`/listings?ownerId=${user.id}`);
    renderListings();
  } catch (err) {
    listingsEl.innerHTML = `<p class="col-span-full text-center text-sm text-red-600 py-6">${escapeHtml(err.message)}</p>`;
  }
}

viewMode = mountViewToggle(document.getElementById("view-toggle"), (mode) => {
  viewMode = mode;
  renderListings();
  renderFavorites();
});

await loadMyListings();

// ---------------------------------------------------------------------------
// Mes favoris (annonces marquees d'une etoile)
// ---------------------------------------------------------------------------

const favoritesEl = document.getElementById("favorites");

let favorites = [];

// Declaration de fonction (hoistee) : la bascule grille/compact, definie plus
// haut dans le fichier, l'appelle pour re-rendre les favoris sans les
// recharger.
function renderFavorites() {
  favoritesEl.className = `listing-grid${viewMode === "compact" ? " is-compact" : ""}`;

  if (favorites.length === 0) {
    favoritesEl.innerHTML = `
      <div class="col-span-full text-center py-10 border border-dashed border-appfg/15 rounded-2xl">
        <p class="text-sm text-mutedfg">Aucun favori pour l'instant.</p>
        <p class="text-xs text-mutedfg mt-1">Touchez l'étoile sur une annonce pour la retrouver ici.</p>
      </div>`;
    return;
  }

  favoritesEl.innerHTML = favorites
    .map((listing) => listingCardHtml(listing, viewMode))
    .join("");
}

async function loadFavorites() {
  try {
    favorites = await api.get("/listings?interested=true");
    renderFavorites();
  } catch (err) {
    favoritesEl.innerHTML = `<p class="col-span-full text-center text-sm text-red-600 py-6">${escapeHtml(err.message)}</p>`;
  }
}

await loadFavorites();

// ---------------------------------------------------------------------------
// Suppression du compte (req 8)
//
// L'API (DELETE /auth/me) supprime des le premier appel : c'est donc au
// frontend de s'assurer que la personne sait ce qu'elle fait. Deux garde-fous
// plutot qu'un seul confirm() qu'on valide par reflexe : une confirmation, puis
// la saisie exacte du mot SUPPRIMER.
// ---------------------------------------------------------------------------

const deleteAccountBtn = document.getElementById("delete-account-btn");
const deleteFeedback = document.getElementById("delete-account-feedback");
const CONFIRM_WORD = "SUPPRIMER";

deleteAccountBtn.addEventListener("click", async () => {
  deleteFeedback.textContent = "";

  const confirmed = confirm(
    "Supprimer définitivement votre compte ?" +
      "\n\nVos annonces seront retirées et votre profil ne sera plus accessible." +
      "\nCette action est irréversible."
  );
  if (!confirmed) return;

  const typed = prompt(`Pour confirmer, tapez ${CONFIRM_WORD} en majuscules :`);
  if (typed === null) return;
  if (typed.trim() !== CONFIRM_WORD) {
    deleteFeedback.textContent = `Suppression annulée : le mot ${CONFIRM_WORD} n'a pas été saisi.`;
    return;
  }

  deleteAccountBtn.disabled = true;
  deleteAccountBtn.textContent = "Suppression…";

  try {
    await api.del("/auth/me");
    window.location.href = "index.html";
  } catch (err) {
    deleteFeedback.textContent = err.message;
    deleteAccountBtn.disabled = false;
    deleteAccountBtn.textContent = "Supprimer mon compte";
  }
});
