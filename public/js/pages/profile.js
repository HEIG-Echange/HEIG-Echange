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
  mountViewToggle,
  renderEmailBanner,
  listingCardHtml,
  icon,
} from "../ui.js";

mountNav("profile");

const user = await requireUser();

document.getElementById("avatar").textContent = initials(user.displayName);
document.getElementById("display-name").textContent = user.displayName;
document.getElementById("email").textContent = user.email;
document.getElementById("role-badge").textContent =
  user.role === "admin" ? "Administrateur" : "Étudiant·e";

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

// Nombre de groupes/amis prioritaires : fonctionnalite en apercu local
// uniquement (pas encore de table en base), voir priority-friends.js.
const FRIEND_GROUPS_KEY = "heig-echange:priority-groups";
try {
  const groups = JSON.parse(localStorage.getItem(FRIEND_GROUPS_KEY) ?? "[]");
  const total = groups.reduce((sum, g) => sum + g.members.length, 0);
  document.getElementById("friends-count").textContent = String(total);
} catch {
  document.getElementById("friends-count").textContent = "0";
}

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

  document.getElementById("active-count").textContent = String(myListings.length);

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
});

await loadMyListings();
