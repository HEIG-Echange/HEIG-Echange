import { api, initials, escapeHtml } from "../api.js";
import {
  mountNav,
  mountAccountChip,
  mountViewToggle,
  listingCardHtml,
} from "../ui.js";

mountNav("home");
mountAccountChip(document.getElementById("account-chip"));

const contentEl = document.getElementById("content");
const id = new URLSearchParams(window.location.search).get("id");

let viewMode = "grid";
let listings = [];

if (!id) {
  contentEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">Profil introuvable.</p>`;
} else {
  render();
}

function renderListings() {
  const el = document.getElementById("user-listings");
  if (!el) return;

  el.className = `listing-grid${viewMode === "compact" ? " is-compact" : ""}`;

  if (listings.length === 0) {
    el.innerHTML = `<p class="col-span-full text-center text-sm text-mutedfg py-8">Aucune annonce en ligne pour l'instant.</p>`;
    return;
  }
  el.innerHTML = listings.map((l) => listingCardHtml(l, viewMode)).join("");
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
    ? new Date(user.createdAt).toLocaleDateString("fr-CH", {
        month: "long",
        year: "numeric",
      })
    : null;

  // Meme decoupage que "mon profil" : identite a gauche, annonces a droite sur
  // desktop, tout empile sur mobile.
  contentEl.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-8 items-start">
      <aside class="bg-white border border-appfg/10 rounded-2xl p-6 text-center lg:sticky lg:top-24">
        <span class="w-20 h-20 rounded-full bg-brand text-white text-2xl font-bold flex items-center justify-center mx-auto mb-3">${escapeHtml(initials(user.displayName))}</span>
        <p class="text-xl font-extrabold">${escapeHtml(user.displayName)}</p>
        ${memberSince ? `<p class="text-xs text-mutedfg mt-1">Membre depuis ${escapeHtml(memberSince)}</p>` : ""}
        <p class="text-sm text-mutedfg mt-2">${user.activeListings} annonce${user.activeListings === 1 ? "" : "s"} en ligne</p>
        <img src="/users/${user.id}/qr" alt="QR code du profil"
             class="w-32 h-32 mx-auto mt-5 rounded-xl border border-appfg/10" />
        <p class="text-[11px] text-mutedfg mt-2 break-all">${escapeHtml(user.profileUrl ?? "")}</p>
      </aside>

      <section>
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="text-lg font-extrabold">Ses objets</h2>
          <div id="view-toggle" class="hidden md:flex"></div>
        </div>
        <div id="user-listings" class="listing-grid">
          <p class="col-span-full text-center text-sm text-mutedfg py-8">Chargement…</p>
        </div>
      </section>
    </div>
  `;

  viewMode = mountViewToggle(document.getElementById("view-toggle"), (mode) => {
    viewMode = mode;
    renderListings();
  });

  try {
    listings = await api.get(`/listings?ownerId=${user.id}`);
    renderListings();
  } catch (err) {
    document.getElementById("user-listings").innerHTML =
      `<p class="col-span-full text-center text-sm text-red-600 py-6">${escapeHtml(err.message)}</p>`;
  }
}
