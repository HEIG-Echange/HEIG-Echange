import { api, requireUser, logout, getConfig, buildInviteMailto, initials, CONDITION_LABELS, CONDITION_BADGE_CLASSES, categoryBadgeClass, escapeHtml } from "../api.js";

const user = await requireUser();

document.getElementById("avatar").textContent = initials(user.displayName);
document.getElementById("display-name").textContent = user.displayName;
document.getElementById("email").textContent = user.email;
document.getElementById("role-badge").textContent = user.role === "admin" ? "Administrateur" : "Étudiant·e";

document.getElementById("logout-btn").addEventListener("click", () => logout());

// QR code du profil (genere par l'API, domaine via variable d'environnement).
document.getElementById("qr-img").src = `/users/${user.id}/qr`;

// Partage du profil (Web Share si dispo, sinon copie du lien) + invitation.
const { publicBaseUrl } = await getConfig();
const profileUrl = `${publicBaseUrl}/u.html?id=${user.id}`;
document.getElementById("invite-btn").href = buildInviteMailto(publicBaseUrl);

document.getElementById("share-btn").addEventListener("click", async () => {
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
    alert("Lien du profil copié !");
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

const listingsEl = document.getElementById("my-listings");

function myListingCard(listing) {
  const badgeClass = categoryBadgeClass(listing.categoryId);
  const conditionClass = CONDITION_BADGE_CLASSES[listing.itemCondition] ?? "bg-gray-50 text-gray-700";
  const conditionLabel = CONDITION_LABELS[listing.itemCondition] ?? listing.itemCondition;
  const photo = listing.photoUrl
    ? `<img src="${escapeHtml(listing.photoUrl)}" alt="${escapeHtml(listing.title)}" class="w-full h-full object-cover" loading="lazy" />`
    : `<div class="w-full h-full flex items-center justify-center text-3xl text-mutedfg">📦</div>`;

  const wrapper = document.createElement("div");
  wrapper.className = "bg-white border border-appfg/10 rounded-2xl overflow-hidden relative";
  wrapper.innerHTML = `
    <a href="listing.html?id=${listing.id}" class="block">
      <div class="relative h-32 bg-mutedbg">
        ${photo}
        ${listing.categoryLabel ? `<span class="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}">${escapeHtml(listing.categoryLabel)}</span>` : ""}
      </div>
      <div class="p-3">
        <p class="text-sm font-bold leading-snug">${escapeHtml(listing.title)}</p>
        <div class="flex items-center justify-between mt-2">
          <span class="text-[11px] text-mutedfg">${listing.status === "closed" ? "Retirée" : "En ligne"}</span>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${conditionClass}">${conditionLabel}</span>
        </div>
      </div>
    </a>
    <button type="button" data-id="${listing.id}" title="Retirer l'annonce"
            class="delete-btn absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors">
      🗑
    </button>
  `;

  wrapper.querySelector(".delete-btn").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("Retirer cette annonce ?")) return;
    try {
      await api.del(`/listings/${listing.id}`);
      wrapper.remove();
      const activeEl = document.getElementById("active-count");
      activeEl.textContent = String(Math.max(0, Number(activeEl.textContent) - 1));
      if (!listingsEl.children.length) {
        listingsEl.innerHTML = `<p class="text-center text-sm text-mutedfg py-6">Vous n'avez pas encore publié d'annonce.</p>`;
      }
    } catch (err) {
      alert(err.message);
    }
  });

  return wrapper;
}

async function loadMyListings() {
  try {
    const listings = await api.get(`/listings?ownerId=${user.id}`);
    listingsEl.innerHTML = "";
    document.getElementById("active-count").textContent = String(listings.length);

    if (listings.length === 0) {
      listingsEl.innerHTML = `<p class="text-center text-sm text-mutedfg py-6">Vous n'avez pas encore publié d'annonce.</p>`;
      return;
    }
    for (const listing of listings) {
      listingsEl.appendChild(myListingCard(listing));
    }
  } catch (err) {
    listingsEl.innerHTML = `<p class="text-center text-sm text-red-600 py-6">${escapeHtml(err.message)}</p>`;
  }
}

loadMyListings();
