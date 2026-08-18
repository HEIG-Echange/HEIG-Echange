import { api, getConfig, buildInviteMailto, CONDITION_LABELS, CONDITION_BADGE_CLASSES, categoryBadgeClass, initials, escapeHtml } from "../api.js";

const tabsEl = document.getElementById("category-tabs");
const gridEl = document.getElementById("listings-grid");
const searchInput = document.getElementById("search-input");

// Invitation par email : ouvre le client mail avec un message pre-rempli.
// Accessible aux visiteurs non connectes comme aux membres.
const inviteBtn = document.getElementById("invite-btn");
if (inviteBtn) {
  getConfig().then(({ publicBaseUrl }) => {
    inviteBtn.href = buildInviteMailto(publicBaseUrl);
  });
}

let activeCategoryId = null;
let searchTimer = null;

function tabClasses(active) {
  return active
    ? "flex-shrink-0 bg-brand text-white rounded-full px-4 py-2 whitespace-nowrap"
    : "flex-shrink-0 bg-white text-mutedfg rounded-full px-4 py-2 border border-appfg/10 whitespace-nowrap";
}

async function loadCategories() {
  const categories = await api.get("/categories");

  const renderTabs = () => {
    tabsEl.innerHTML = "";
    const allTab = document.createElement("button");
    allTab.type = "button";
    allTab.textContent = "Tout";
    allTab.className = tabClasses(activeCategoryId === null);
    allTab.addEventListener("click", () => selectCategory(null));
    tabsEl.appendChild(allTab);

    for (const cat of categories) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = cat.label;
      tab.className = tabClasses(activeCategoryId === cat.id);
      tab.addEventListener("click", () => selectCategory(cat.id));
      tabsEl.appendChild(tab);
    }
  };

  renderTabs();
  return renderTabs;
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
        <p class="text-xs text-mutedfg mt-0.5 line-clamp-1">${escapeHtml(listing.description)}</p>
        <div class="flex items-center justify-between mt-2.5">
          <div class="flex items-center gap-1.5">
            <div class="w-5 h-5 rounded-full bg-brand text-white text-[9px] font-bold flex items-center justify-center">${escapeHtml(initials(listing.ownerName))}</div>
            <span class="text-xs text-mutedfg">${escapeHtml(listing.ownerName ?? "Anonyme")}</span>
          </div>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${conditionClass}">${conditionLabel}</span>
        </div>
      </div>
    </a>
  `;
}

async function loadListings() {
  gridEl.innerHTML = `<p class="text-center text-sm text-mutedfg py-10">Chargement…</p>`;

  const params = new URLSearchParams();
  if (activeCategoryId !== null) params.set("categoryId", activeCategoryId);
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());

  try {
    const listings = await api.get(`/listings?${params.toString()}`);
    if (listings.length === 0) {
      gridEl.innerHTML = `<p class="text-center text-sm text-mutedfg py-10">Aucune annonce pour l'instant.</p>`;
      return;
    }
    gridEl.innerHTML = listings.map(listingCard).join("");
  } catch (err) {
    gridEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">${escapeHtml(err.message)}</p>`;
  }
}

let renderTabsFn = () => {};

async function selectCategory(categoryId) {
  activeCategoryId = categoryId;
  renderTabsFn();
  await loadListings();
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadListings, 300);
});

(async function init() {
  renderTabsFn = await loadCategories();
  await loadListings();
})();
