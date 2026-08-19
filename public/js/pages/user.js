import { api, CONDITION_LABELS, CONDITION_BADGE_CLASSES, categoryBadgeClass, initials, escapeHtml } from "../api.js";

const contentEl = document.getElementById("content");
const id = new URLSearchParams(window.location.search).get("id");

if (!id) {
  contentEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">Profil introuvable.</p>`;
} else {
  render();
}

function listingCard(listing) {
  const badgeClass = categoryBadgeClass(listing.categoryId);
  const conditionClass = CONDITION_BADGE_CLASSES[listing.itemCondition] ?? "bg-gray-50 text-gray-700";
  const conditionLabel = CONDITION_LABELS[listing.itemCondition] ?? listing.itemCondition;
  const photo = listing.photoUrl
    ? `<img src="${escapeHtml(listing.photoUrl)}" alt="${escapeHtml(listing.title)}" class="w-full h-full object-cover" loading="lazy" />`
    : `<div class="w-full h-full flex items-center justify-center text-3xl text-mutedfg">📦</div>`;

  return `
    <a href="listing.html?id=${listing.id}" class="block bg-white border border-appfg/10 rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      <div class="relative h-40 bg-mutedbg">
        ${photo}
        ${listing.categoryLabel ? `<span class="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}">${escapeHtml(listing.categoryLabel)}</span>` : ""}
      </div>
      <div class="p-3">
        <p class="text-sm font-bold text-appfg leading-snug">${escapeHtml(listing.title)}</p>
        <div class="flex items-center justify-end mt-2.5">
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${conditionClass}">${conditionLabel}</span>
        </div>
      </div>
    </a>
  `;
}

async function render() {
  let user;
  try {
    user = await api.get(`/users/${id}`);
  } catch (err) {
    contentEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">${escapeHtml(err.message)}</p>`;
    return;
  }

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("fr-CH", { month: "long", year: "numeric" })
    : null;

  contentEl.innerHTML = `
    <div class="bg-white border-b border-appfg/10 px-4 py-6 flex flex-col items-center text-center">
      <div class="w-20 h-20 rounded-full bg-brand text-white text-2xl font-bold flex items-center justify-center mb-3">${escapeHtml(initials(user.displayName))}</div>
      <p class="text-xl font-extrabold">${escapeHtml(user.displayName)}</p>
      ${memberSince ? `<p class="text-xs text-mutedfg mt-1">Membre depuis ${escapeHtml(memberSince)}</p>` : ""}
      <p class="text-sm text-mutedfg mt-2">${user.activeListings} annonce${user.activeListings === 1 ? "" : "s"} en ligne</p>
      <img src="/users/${user.id}/qr" alt="QR code du profil" class="w-28 h-28 mt-4 rounded-lg border border-appfg/10" />
    </div>
    <div class="px-4 py-4">
      <h2 class="font-extrabold mb-3">Ses objets</h2>
      <div id="user-listings" class="space-y-3">
        <p class="text-center text-sm text-mutedfg py-6">Chargement…</p>
      </div>
    </div>
  `;

  const listingsEl = document.getElementById("user-listings");
  try {
    const listings = await api.get(`/listings?ownerId=${user.id}`);
    if (!listings.length) {
      listingsEl.innerHTML = `<p class="text-center text-sm text-mutedfg py-6">Aucune annonce en ligne pour l'instant.</p>`;
      return;
    }
    listingsEl.innerHTML = listings.map(listingCard).join("");
  } catch (err) {
    listingsEl.innerHTML = `<p class="text-center text-sm text-red-600 py-6">${escapeHtml(err.message)}</p>`;
  }
}
