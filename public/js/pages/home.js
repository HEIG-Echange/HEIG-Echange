import {
  api,
  getConfig,
  buildInviteMailto,
  getCurrentUser,
  escapeHtml,
} from "../api.js";
import {
  mountNav,
  mountViewToggle,
  mountAccountChip,
  renderEmailBanner,
  listingCardHtml,
  icon,
} from "../ui.js";

mountNav("home");

const tabsEl = document.getElementById("category-tabs");
const gridEl = document.getElementById("listings-grid");
const countEl = document.getElementById("results-count");

// Deux champs de recherche coexistent (un pour la mise en page mobile, un pour
// la barre desktop) : la CSS n'en montre qu'un, mais on les tient synchronises
// pour que passer d'une taille d'ecran a l'autre ne perde pas la saisie.
const searchInputs = [
  document.getElementById("search-input-mobile"),
  document.getElementById("search-input-desktop"),
].filter(Boolean);

for (const id of ["search-icon-mobile", "search-icon-desktop"]) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = icon("search");
}
document.getElementById("invite-btn").innerHTML = icon("mail");

let activeCategoryId = null;
let viewMode = "grid";
let searchTimer = null;
let searchTerm = "";

// Invitation par email : ouvre le client mail avec un message pre-rempli.
// L'URL vient de /config (PUBLIC_BASE_URL), pas de window.location : le lien
// part par mail et doit pointer sur le domaine public.
getConfig().then(({ publicBaseUrl }) => {
  document.getElementById("invite-btn").href = buildInviteMailto(publicBaseUrl);
});

mountAccountChip(document.getElementById("account-chip"));
getCurrentUser().then((user) =>
  renderEmailBanner(user, document.getElementById("account-banner"))
);

function tabClasses(active) {
  return active
    ? "flex-shrink-0 bg-brand text-white rounded-full px-4 py-2 whitespace-nowrap transition-colors"
    : "flex-shrink-0 bg-white text-mutedfg rounded-full px-4 py-2 border border-appfg/10 whitespace-nowrap hover:border-brand/40 hover:text-appfg transition-colors";
}

async function loadCategories() {
  const categories = await api.get("/categories");

  const renderTabs = () => {
    tabsEl.innerHTML = "";
    const makeTab = (label, categoryId) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = label;
      tab.className = tabClasses(activeCategoryId === categoryId);
      tab.setAttribute("aria-pressed", String(activeCategoryId === categoryId));
      tab.addEventListener("click", () => selectCategory(categoryId));
      tabsEl.appendChild(tab);
    };

    makeTab("Tout", null);
    for (const cat of categories) makeTab(cat.label, cat.id);
  };

  renderTabs();
  return renderTabs;
}

async function loadListings() {
  gridEl.className = `listing-grid${viewMode === "compact" ? " is-compact" : ""}`;
  gridEl.innerHTML = `<p class="col-span-full text-center text-sm text-mutedfg py-10">Chargement…</p>`;

  const params = new URLSearchParams();
  if (activeCategoryId !== null) params.set("categoryId", activeCategoryId);
  if (searchTerm) params.set("q", searchTerm);

  try {
    const listings = await api.get(`/listings?${params.toString()}`);

    countEl.textContent = listings.length
      ? `${listings.length} annonce${listings.length > 1 ? "s" : ""}`
      : "";

    if (listings.length === 0) {
      gridEl.innerHTML = `
        <div class="col-span-full text-center py-16">
          <p class="text-sm text-mutedfg">Aucune annonce ne correspond à votre recherche.</p>
          <a href="add-listing.html" class="inline-block mt-4 text-sm font-bold bg-brand hover:bg-brand-dark text-white rounded-xl px-4 py-2.5 transition-colors">
            Mettre un objet à disposition
          </a>
        </div>`;
      return;
    }

    gridEl.innerHTML = listings
      .map((listing) => listingCardHtml(listing, viewMode))
      .join("");
  } catch (err) {
    countEl.textContent = "";
    gridEl.innerHTML = `<p class="col-span-full text-center text-sm text-red-600 py-10">${escapeHtml(err.message)}</p>`;
  }
}

let renderTabsFn = () => {};

async function selectCategory(categoryId) {
  activeCategoryId = categoryId;
  renderTabsFn();
  await loadListings();
}

for (const input of searchInputs) {
  input.addEventListener("input", () => {
    searchTerm = input.value.trim();
    for (const other of searchInputs) {
      if (other !== input) other.value = input.value;
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadListings, 300);
  });
}

(async function init() {
  viewMode = mountViewToggle(document.getElementById("view-toggle"), (mode) => {
    viewMode = mode;
    loadListings();
  });
  renderTabsFn = await loadCategories();
  await loadListings();
})();
