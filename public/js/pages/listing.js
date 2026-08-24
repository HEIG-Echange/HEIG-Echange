import {
  api,
  getConfig,
  getCurrentUser,
  buildContactMailto,
  buildTeamsChatUrl,
  buildListingShareLinks,
  initials,
  CONDITION_LABELS,
  CONDITION_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  categoryBadgeClass,
  escapeHtml,
} from "../api.js";
import { mountNav, mountAccountChip, attachShareMenu, icon } from "../ui.js";

mountNav("home");
mountAccountChip(document.getElementById("account-chip"));

const contentEl = document.getElementById("content");
const shareBtn = document.getElementById("share-btn");
const id = new URLSearchParams(window.location.search).get("id");

if (!id) {
  contentEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">Annonce introuvable.</p>`;
} else {
  render();
}

/**
 * Galerie du carrousel. Sur mobile : defilement horizontal avec accroche et
 * pastilles. Sur desktop : une grande photo plus des vignettes cliquables,
 * la place permet de tout voir sans faire defiler.
 */
function galleryHtml(listing) {
  const photos = listing.photos ?? [];

  if (photos.length === 0) {
    return `<div class="w-full aspect-[4/3] bg-mutedbg rounded-2xl flex items-center justify-center text-mutedfg">${icon("box")}</div>`;
  }

  const slides = photos
    .map(
      (p, index) => `
        <img src="${escapeHtml(p.url)}" data-index="${index}" alt="${escapeHtml(listing.title)} — photo ${index + 1}"
             class="w-full aspect-[4/3] object-cover bg-mutedbg" />`
    )
    .join("");

  const dots =
    photos.length > 1
      ? `<div id="gallery-dots" class="flex justify-center gap-1.5 mt-2 lg:hidden">
           ${photos.map((_, i) => `<span data-dot="${i}" class="w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-brand" : "bg-appfg/20"}"></span>`).join("")}
         </div>`
      : "";

  const thumbs =
    photos.length > 1
      ? `<div class="hidden lg:flex gap-2 mt-3 flex-wrap">
           ${photos
             .map(
               (p, i) => `
             <button type="button" data-thumb="${i}"
                     class="w-20 h-20 rounded-xl overflow-hidden border-2 ${i === 0 ? "border-brand" : "border-transparent"} hover:border-brand/50 transition-colors">
               <img src="${escapeHtml(p.url)}" alt="Photo ${i + 1}" class="w-full h-full object-cover" />
             </button>`
             )
             .join("")}
         </div>`
      : "";

  return `
    <div>
      <div id="gallery-track" class="gallery-track no-scrollbar bg-mutedbg">${slides}</div>
      ${dots}
      ${thumbs}
      ${photos.length > 1 ? `<p class="text-xs text-mutedfg mt-2 lg:hidden text-center">${photos.length} photos — faites glisser</p>` : ""}
    </div>`;
}

/** Synchronise pastilles, vignettes et position du carrousel. */
function wireGallery(photoCount) {
  const track = document.getElementById("gallery-track");
  if (!track || photoCount < 2) return;

  const dots = [...document.querySelectorAll("[data-dot]")];
  const thumbs = [...document.querySelectorAll("[data-thumb]")];

  const setActive = (index) => {
    dots.forEach((dot, i) => {
      dot.className = `w-1.5 h-1.5 rounded-full ${i === index ? "bg-brand" : "bg-appfg/20"}`;
    });
    thumbs.forEach((thumb, i) => {
      thumb.className = `w-20 h-20 rounded-xl overflow-hidden border-2 ${i === index ? "border-brand" : "border-transparent"} hover:border-brand/50 transition-colors`;
    });
  };

  track.addEventListener("scroll", () => {
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActive(index);
  });

  for (const thumb of thumbs) {
    thumb.addEventListener("click", () => {
      const index = Number(thumb.dataset.thumb);
      track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
      setActive(index);
    });
  }
}

async function render() {
  let listing;
  try {
    listing = await api.get(`/listings/${id}`);
  } catch (err) {
    contentEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">${escapeHtml(err.message)}</p>`;
    return;
  }

  const user = await getCurrentUser();
  const isOwner = user && user.id === listing.ownerId;

  const conditionLabel =
    CONDITION_LABELS[listing.itemCondition] ?? listing.itemCondition;
  const conditionClass =
    CONDITION_BADGE_CLASSES[listing.itemCondition] ?? "bg-gray-50 text-gray-700";
  const badgeClass = categoryBadgeClass(listing.categoryId);

  contentEl.innerHTML = `
    <article class="listing-detail">
      <div>${galleryHtml(listing)}</div>

      <aside class="detail-aside space-y-4">
        <div class="flex items-center gap-2 flex-wrap">
          ${listing.categoryLabel ? `<span class="text-[11px] font-semibold px-2.5 py-1 rounded-full border ${badgeClass}">${escapeHtml(listing.categoryLabel)}</span>` : ""}
          <span class="text-[11px] font-semibold px-2.5 py-1 rounded-full ${conditionClass}">${conditionLabel}</span>
          ${listing.status !== "available" ? `<span class="text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE_CLASSES[listing.status]}">${STATUS_LABELS[listing.status]}</span>` : ""}
        </div>

        <h2 class="text-2xl lg:text-3xl font-extrabold leading-tight">${escapeHtml(listing.title)}</h2>
        <p class="text-sm text-appfg/80 whitespace-pre-line">${escapeHtml(listing.description)}</p>

        ${listing.location ? `<p class="text-sm text-mutedfg flex items-center gap-1.5">${icon("pin")} ${escapeHtml(listing.location)}</p>` : ""}

        <div class="pt-3 border-t border-appfg/10">
          <a href="u.html?id=${listing.ownerId}" class="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity">
            <span class="w-10 h-10 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(initials(listing.ownerName))}</span>
            <span class="min-w-0">
              <span class="block text-xs text-mutedfg">Proposé par</span>
              <span class="block text-sm font-bold truncate">${escapeHtml(listing.ownerName ?? "un·e étudiant·e")}</span>
            </span>
          </a>
        </div>

        <div id="action-zone" class="space-y-2"></div>
      </aside>
    </article>
  `;

  wireGallery((listing.photos ?? []).length);

  // Bouton de partage de l'en-tete : liens bases sur PUBLIC_BASE_URL.
  shareBtn.innerHTML = icon("share");
  shareBtn.classList.remove("hidden");
  shareBtn.classList.add("flex");
  attachShareMenu(shareBtn, listing);

  const actionZone = document.getElementById("action-zone");
  const { publicBaseUrl } = await getConfig();
  const shareUrl = buildListingShareLinks(listing, publicBaseUrl).url;

  if (isOwner) {
    actionZone.innerHTML = `
      <a href="edit-listing.html?id=${listing.id}"
         class="flex items-center justify-center gap-2 w-full bg-brand hover:bg-brand-dark text-white font-bold rounded-xl py-3 transition-colors">
        ${icon("edit")} Modifier mon annonce
      </a>
      <button id="delete-btn" type="button"
              class="flex items-center justify-center gap-2 w-full border-2 border-red-200 text-red-600 font-bold rounded-xl py-3 hover:bg-red-50 transition-colors">
        ${icon("trash")} Retirer l'annonce
      </button>
    `;
    document.getElementById("delete-btn").addEventListener("click", async () => {
      if (!confirm("Retirer cette annonce ?")) return;
      try {
        await api.del(`/listings/${listing.id}`);
        window.location.href = "profile.html";
      } catch (err) {
        alert(err.message);
      }
    });
  } else if (user && listing.ownerEmail) {
    // Visiteur connecte : deux facons de joindre le donneur, toutes deux avec
    // un message pre-rempli contenant le lien public de l'annonce (et non
    // l'URL du navigateur).
    //
    // Teams en premier : c'est le canal decrit dans le projet (prise de contact
    // et rendez-vous), et tout le monde y est deja connecte avec son compte
    // d'ecole. Le mail reste en secours pour qui n'utilise pas Teams.
    const teamsUrl = buildTeamsChatUrl(listing, shareUrl);

    actionZone.innerHTML = `
      ${
        teamsUrl
          ? `<a href="${escapeHtml(teamsUrl)}" target="_blank" rel="noopener"
                class="flex items-center justify-center gap-2 w-full bg-brand hover:bg-brand-dark text-white font-bold rounded-xl py-3 transition-colors">
               ${icon("chat")} Contacter via Teams
             </a>`
          : ""
      }
      <a href="${escapeHtml(buildContactMailto(listing, shareUrl))}"
         class="flex items-center justify-center gap-2 w-full border border-appfg/15 bg-white font-bold rounded-xl py-3 hover:bg-secondarybg transition-colors">
        ${icon("mail")} Contacter par mail
      </a>
    `;
  } else {
    // Visiteur non connecte : les coordonnees ne sont pas exposees.
    actionZone.innerHTML = `
      <a href="login.html"
         class="block text-center w-full bg-brand hover:bg-brand-dark text-white font-bold rounded-xl py-3 transition-colors">
        Se connecter pour contacter le donneur
      </a>
      <p class="text-[11px] text-mutedfg text-center">Les coordonnées ne sont visibles que par les membres connectés.</p>
    `;
  }
}
