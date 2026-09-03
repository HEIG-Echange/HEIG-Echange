// ---------------------------------------------------------------------------
// Briques d'interface partagees par toutes les pages.
//
// Le projet n'a pas de bundler ni de moteur de template : plutot que de
// recopier la navigation et les cartes d'annonce dans chaque fichier HTML (ce
// qui etait le cas avant et divergeait page par page), chaque page pose des
// conteneurs vides et ce module les remplit.
// ---------------------------------------------------------------------------
import {
  api,
  getCurrentUser,
  getConfig,
  buildListingShareLinks,
  CONDITION_LABELS,
  CONDITION_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  categoryBadgeClass,
  initials,
  escapeHtml,
} from "./api.js";

// ---------------------------------------------------------------------------
// Icones (SVG inline : pas de dependance externe, nettes a toutes les tailles,
// et elles prennent la couleur du texte via currentColor).
// ---------------------------------------------------------------------------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="20" height="20"><path d="M12 5v14M5 12h14"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="20" height="20"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 20s-7-4.4-7-9.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 2.7C19 15.6 12 20 12 20z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m5 17 4.5-4 3 2.5L16 12l3 3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="16" height="16"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="m14.5 5.5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4"/><path d="M10 8 6 12l4 4M6 12h9"/></svg>',
  // Bulle de discussion : sert au bouton « Contacter via Teams ». On ne
  // reproduit pas le logo Microsoft (marque deposee), une icone neutre suffit.
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="18" height="18"><path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9.5L5 20.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/></svg>',
  // Etoile pleine : etat "annonce en favori" du bouton Interesse.
  starFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="20" height="20"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="18" height="18"><path d="M5 21V4M5 4h11l-1.6 3.5L16 11H5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="20" height="20"><path d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2.5h15z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" width="20" height="20"><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="34" height="34"><path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v7"/></svg>',
};

export function icon(name) {
  return ICONS[name] ?? "";
}

// ---------------------------------------------------------------------------
// Shell de navigation
// ---------------------------------------------------------------------------

// Entrees de navigation. `key` sert a marquer l'entree courante, `mobile`
// indique si l'entree apparait aussi dans la barre du bas (limitee a
// l'essentiel : la place y est comptee).
const NAV_ITEMS = [
  { key: "home", href: "index.html", label: "Accueil", icon: "home", mobile: true },
  { key: "add", href: "add-listing.html", label: "Mettre à disposition", icon: "plus", mobile: "fab" },
  { key: "profile", href: "profile.html", label: "Profil", icon: "user", mobile: true },
];

/**
 * Remplit la barre laterale (tablette/desktop) et la barre du bas (mobile).
 * Les deux existent toujours dans le DOM : c'est la CSS qui montre l'une ou
 * l'autre selon la largeur, donc aucun risque de decalage au redimensionnement.
 *
 * @param {string} active clef de l'entree courante (voir NAV_ITEMS)
 */
export function mountNav(active) {
  const side = document.querySelector(".side-nav");
  const bottom = document.querySelector(".bottom-nav");

  if (side) {
    const links = NAV_ITEMS.map(
      (item) => `
        <a href="${item.href}" class="nav-item"${item.key === active ? ' aria-current="page"' : ""}>
          <span class="nav-icon">${icon(item.icon)}</span>
          <span class="nav-label">${escapeHtml(item.label)}</span>
        </a>`
    ).join("");

    side.innerHTML = `
      <a href="index.html" class="flex items-center gap-2.5 px-2 pb-5 mb-2 border-b border-appfg/10">
        <span class="w-9 h-9 rounded-xl bg-brand text-white font-extrabold flex items-center justify-center flex-shrink-0">É</span>
        <span class="nav-label leading-tight">
          <span class="block text-[10px] text-mutedfg font-bold">HEIG-VD</span>
          <span class="block text-base font-extrabold -mt-0.5">Échange</span>
        </span>
      </a>
      ${links}
    `;
  }

  if (bottom) {
    bottom.innerHTML = NAV_ITEMS.filter((item) => item.mobile)
      .map((item) => {
        if (item.mobile === "fab") {
          return `<a href="${item.href}" class="flex-1 flex items-center justify-center" aria-label="${escapeHtml(item.label)}">
                    <span class="fab">${icon("plus")}</span>
                  </a>`;
        }
        const color = item.key === active ? "text-brand" : "text-mutedfg";
        return `<a href="${item.href}" class="flex-1 flex flex-col items-center justify-center gap-1 ${color}"${item.key === active ? ' aria-current="page"' : ""}>
                  ${icon(item.icon)}
                  <span class="text-[11px] font-bold">${escapeHtml(item.label)}</span>
                </a>`;
      })
      .join("");
  }
}

// ---------------------------------------------------------------------------
// Bandeau d'etat du compte
// ---------------------------------------------------------------------------

/**
 * Affiche un bandeau quand l'adresse email approche de ses 6 mois. La
 * suspension elle-meme est traitee par requireUser (redirection vers
 * verify.html) : ce bandeau ne sert qu'a prevenir AVANT que ca arrive.
 */
export function renderEmailBanner(user, container) {
  if (!container || !user || user.emailStatus !== "expiring") return;

  const days = user.daysUntilEmailExpiry ?? 0;
  const delay = days <= 1 ? "aujourd'hui" : `dans ${days} jours`;

  container.innerHTML = `
    <div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 mb-4">
      <span class="flex-shrink-0">${icon("mail")}</span>
      <p class="text-sm flex-1 min-w-[12rem]">
        Votre adresse email doit être reconfirmée <strong>${escapeHtml(delay)}</strong>.
        Sans reconfirmation, votre compte sera suspendu et vos annonces masquées.
      </p>
      <a href="verify.html?email=${encodeURIComponent(user.email)}&reason=reverification"
         class="text-sm font-bold bg-amber-900 text-white rounded-xl px-3.5 py-2 hover:bg-amber-800 transition-colors">
        Reconfirmer
      </a>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Cartes d'annonce
// ---------------------------------------------------------------------------

function photoBlock(listing, extraClass = "") {
  if (listing.photoUrl) {
    return `<img src="${escapeHtml(listing.photoUrl)}" alt="${escapeHtml(listing.title)}"
                 class="w-full h-full object-cover ${extraClass}" loading="lazy" />`;
  }
  return `<div class="w-full h-full flex items-center justify-center text-mutedfg">${icon("box")}</div>`;
}

// L'API ne renvoie le nom du donneur qu'aux visiteurs connectes (ownerName est
// null sinon). Plutot qu'un "? Anonyme" qui laisse croire a un compte sans nom,
// on affiche une mention neutre et une pastille discrete.
function ownerChip(listing) {
  if (!listing.ownerName) {
    // Les initiales, elles, restent renvoyees a tout le monde : de quoi
    // distinguer deux donneurs sans rien reveler de leur identite.
    const badge = listing.ownerInitials
      ? `<span class="w-5 h-5 rounded-full bg-mutedbg text-mutedfg text-[9px] font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(listing.ownerInitials)}</span>`
      : "";
    return `<span class="flex items-center gap-1.5 min-w-0">${badge}<span class="text-xs text-mutedfg truncate">Membre HEIG-VD</span></span>`;
  }
  return `
    <span class="flex items-center gap-1.5 min-w-0">
      <span class="w-5 h-5 rounded-full bg-brand text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(initials(listing.ownerName))}</span>
      <span class="text-xs text-mutedfg truncate">${escapeHtml(listing.ownerName)}</span>
    </span>`;
}

function metaRow(listing) {
  const conditionClass =
    CONDITION_BADGE_CLASSES[listing.itemCondition] ?? "bg-gray-50 text-gray-700";
  const conditionLabel =
    CONDITION_LABELS[listing.itemCondition] ?? listing.itemCondition;
  const location = listing.location
    ? `<span class="inline-flex items-center gap-1 text-xs text-mutedfg truncate">${icon("pin")}${escapeHtml(listing.location)}</span>`
    : "";
  return { conditionClass, conditionLabel, location };
}

/** Carte "grille" : grande photo, comme sur la maquette mobile. */
function gridCard(listing) {
  const { conditionClass, conditionLabel, location } = metaRow(listing);
  const badgeClass = categoryBadgeClass(listing.categoryId);
  // Compteur de photos, comme le "+2" de la maquette.
  const extraPhotos =
    listing.photoCount > 1
      ? `<span class="absolute bottom-2 right-2 inline-flex items-center gap-1 text-[11px] font-bold text-white bg-black/60 rounded-full px-2 py-0.5">${icon("photo")}+${listing.photoCount - 1}</span>`
      : "";
  const closed =
    listing.status !== "available"
      ? `<span class="absolute top-2 right-2 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE_CLASSES[listing.status]}">${STATUS_LABELS[listing.status]}</span>`
      : "";

  return `
    <a href="listing.html?id=${listing.id}"
       class="group flex flex-col bg-white border border-appfg/10 rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150">
      <div class="relative aspect-[4/3] bg-mutedbg overflow-hidden">
        ${photoBlock(listing, "group-hover:scale-[1.03] transition-transform duration-300")}
        ${listing.categoryLabel ? `<span class="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-white/95 ${badgeClass}">${escapeHtml(listing.categoryLabel)}</span>` : ""}
        ${closed}
        ${extraPhotos}
      </div>
      <div class="p-3 flex flex-col gap-1 flex-1">
        <p class="text-sm font-bold text-appfg leading-snug line-clamp-2">${escapeHtml(listing.title)}</p>
        <p class="text-xs text-mutedfg line-clamp-2 flex-1">${escapeHtml(listing.description)}</p>
        <div class="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-appfg/5">
          ${ownerChip(listing)}
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${conditionClass}">${conditionLabel}</span>
        </div>
        ${location ? `<div class="pt-0.5">${location}</div>` : ""}
      </div>
    </a>
  `;
}

/** Carte "compacte" : une ligne, vignette a gauche. Pensee pour le desktop,
    ou l'on veut balayer beaucoup d'annonces d'un coup d'oeil. */
function compactCard(listing) {
  const { conditionClass, conditionLabel, location } = metaRow(listing);
  const badgeClass = categoryBadgeClass(listing.categoryId);

  return `
    <a href="listing.html?id=${listing.id}"
       class="flex items-stretch gap-3 bg-white border border-appfg/10 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
      <div class="relative w-24 sm:w-32 flex-shrink-0 bg-mutedbg">
        ${photoBlock(listing)}
        ${listing.photoCount > 1 ? `<span class="absolute bottom-1 right-1 text-[10px] font-bold text-white bg-black/60 rounded-full px-1.5">+${listing.photoCount - 1}</span>` : ""}
      </div>
      <div class="flex-1 min-w-0 py-2.5 pr-3 flex flex-col justify-center gap-1">
        <div class="flex items-start justify-between gap-2">
          <p class="text-sm font-bold leading-snug line-clamp-1">${escapeHtml(listing.title)}</p>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${conditionClass}">${conditionLabel}</span>
        </div>
        <p class="text-xs text-mutedfg line-clamp-1">${escapeHtml(listing.description)}</p>
        <div class="flex items-center gap-2 flex-wrap">
          ${listing.categoryLabel ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}">${escapeHtml(listing.categoryLabel)}</span>` : ""}
          <span class="text-xs text-mutedfg truncate">${escapeHtml(listing.ownerName ?? "Membre HEIG-VD")}</span>
          ${location}
          ${listing.status !== "available" ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE_CLASSES[listing.status]}">${STATUS_LABELS[listing.status]}</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

export function listingCardHtml(listing, mode = "grid") {
  return mode === "compact" ? compactCard(listing) : gridCard(listing);
}

// ---------------------------------------------------------------------------
// Bascule grille / compact
// ---------------------------------------------------------------------------

const VIEW_MODE_KEY = "heig-echange:view-mode";

export function getViewMode() {
  const stored = localStorage.getItem(VIEW_MODE_KEY);
  return stored === "compact" ? "compact" : "grid";
}

export function setViewMode(mode) {
  localStorage.setItem(VIEW_MODE_KEY, mode === "compact" ? "compact" : "grid");
}

/**
 * Monte la bascule d'affichage dans `container` et appelle `onChange` a chaque
 * changement. Le choix est memorise d'une visite a l'autre.
 *
 * La bascule n'a de sens qu'a partir de la tablette : sur un telephone il n'y a
 * de la place que pour une colonne. Le conteneur est donc masque en dessous
 * (classe `hidden md:flex` posee par la page).
 */
export function mountViewToggle(container, onChange) {
  if (!container) return getViewMode();

  const render = () => {
    const mode = getViewMode();
    const cls = (active) =>
      `inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
        active ? "bg-white text-appfg shadow-sm" : "text-mutedfg hover:text-appfg"
      }`;
    container.innerHTML = `
      <div class="inline-flex items-center gap-1 bg-secondarybg border border-appfg/10 rounded-xl p-1" role="group" aria-label="Densité d'affichage">
        <button type="button" data-mode="grid" class="${cls(mode === "grid")}" aria-pressed="${mode === "grid"}">
          ${icon("grid")}<span>Grille</span>
        </button>
        <button type="button" data-mode="compact" class="${cls(mode === "compact")}" aria-pressed="${mode === "compact"}">
          ${icon("list")}<span>Compact</span>
        </button>
      </div>
    `;
    for (const btn of container.querySelectorAll("button[data-mode]")) {
      btn.addEventListener("click", () => {
        setViewMode(btn.dataset.mode);
        render();
        onChange(getViewMode());
      });
    }
  };

  render();
  return getViewMode();
}

// ---------------------------------------------------------------------------
// Partage
// ---------------------------------------------------------------------------

/**
 * Branche un bouton de partage sur une annonce : partage natif si le
 * navigateur le propose, sinon petit menu (copier le lien, envoyer par mail,
 * copier le lien de l'image, afficher le QR code).
 *
 * Tous les liens viennent des champs absolus de l'API, donc du domaine
 * PUBLIC_BASE_URL — jamais de "localhost:3000" dans un lien partage.
 */
export async function attachShareMenu(button, listing) {
  if (!button) return;

  const { publicBaseUrl } = await getConfig();
  const links = buildListingShareLinks(listing, publicBaseUrl);

  const wrapper = button.parentElement;
  if (wrapper && getComputedStyle(wrapper).position === "static") {
    wrapper.style.position = "relative";
  }

  let menu = null;

  const closeMenu = () => {
    menu?.remove();
    menu = null;
    document.removeEventListener("click", onDocClick, true);
  };

  const onDocClick = (event) => {
    if (menu && !menu.contains(event.target) && event.target !== button) {
      closeMenu();
    }
  };

  const copy = async (value, label, el) => {
    try {
      await navigator.clipboard.writeText(value);
      el.textContent = `${label} copié !`;
    } catch {
      // clipboard indisponible (contexte non securise) : on montre le lien.
      prompt(label, value);
    }
  };

  const openMenu = () => {
    if (menu) {
      closeMenu();
      return;
    }
    menu = document.createElement("div");
    menu.className = "share-menu";
    menu.innerHTML = `
      <p class="text-xs font-bold uppercase tracking-wide text-mutedfg px-1 pb-2">Partager</p>
      <button type="button" data-act="link" class="w-full text-left text-sm px-2.5 py-2 rounded-lg hover:bg-secondarybg">Copier le lien de l'annonce</button>
      <a href="${escapeHtml(links.mailto)}" class="block text-sm px-2.5 py-2 rounded-lg hover:bg-secondarybg">Envoyer par email</a>
      ${links.imageUrl ? `<button type="button" data-act="image" class="w-full text-left text-sm px-2.5 py-2 rounded-lg hover:bg-secondarybg">Copier le lien de la photo</button>` : ""}
      <div class="mt-2 pt-2 border-t border-appfg/10 text-center">
        <img src="${escapeHtml(links.qrUrl)}" alt="QR code de l'annonce" class="w-32 h-32 mx-auto rounded-lg border border-appfg/10" />
        <p class="text-[11px] text-mutedfg mt-1.5 break-all px-1">${escapeHtml(links.url)}</p>
      </div>
      <p data-feedback class="text-[11px] text-emerald-700 text-center mt-1"></p>
    `;
    (wrapper ?? document.body).appendChild(menu);

    const feedback = menu.querySelector("[data-feedback]");
    menu.querySelector('[data-act="link"]')?.addEventListener("click", () => {
      copy(links.url, "Lien", feedback);
    });
    menu.querySelector('[data-act="image"]')?.addEventListener("click", () => {
      copy(links.imageUrl, "Lien de la photo", feedback);
    });

    setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  };

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (navigator.share) {
      try {
        await navigator.share({ title: listing.title, url: links.url });
        return;
      } catch {
        // Partage natif annule : on retombe sur le menu.
      }
    }
    openMenu();
  });
}

// ---------------------------------------------------------------------------
// En-tete du compte (coin haut droit sur desktop)
// ---------------------------------------------------------------------------

/** Affiche l'utilisateur connecte, ou un bouton de connexion. */
export async function mountAccountChip(container) {
  if (!container) return null;
  const user = await getCurrentUser();

  if (!user) {
    container.innerHTML = `
      <a href="login.html" class="text-sm font-bold bg-brand hover:bg-brand-dark text-white rounded-xl px-4 py-2 transition-colors">
        Se connecter
      </a>`;
    return null;
  }

  container.innerHTML = `
    <a href="profile.html" class="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-secondarybg transition-colors">
      <span class="w-8 h-8 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center">${escapeHtml(initials(user.displayName))}</span>
      <span class="hidden lg:block text-sm font-bold max-w-[10rem] truncate">${escapeHtml(user.displayName)}</span>
    </a>`;
  return user;
}

// ---------------------------------------------------------------------------
// Cloche de notifications
// ---------------------------------------------------------------------------

/**
 * Monte la cloche (avec pastille du nombre de non-lues) dans `container`.
 * N'affiche rien pour un visiteur anonyme : les notifications sont
 * personnelles, la cloche n'aurait rien a montrer.
 *
 * Le compteur est lu une fois au chargement de la page. La navigation se fait
 * en rechargement complet dans cette app : pas besoin de rafraichissement
 * periodique, chaque page repart d'un compteur frais.
 */
export async function mountNotificationBell(container) {
  if (!container) return;

  const user = await getCurrentUser();
  if (!user) {
    container.innerHTML = "";
    return;
  }

  let unread = 0;
  try {
    const data = await api.get("/notifications/unread-count");
    unread = Number(data?.unreadCount ?? 0);
  } catch {
    // Compteur indisponible : on montre la cloche sans pastille plutot que de
    // faire disparaitre l'acces aux notifications.
    unread = 0;
  }

  const badge =
    unread > 0
      ? `<span class="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">${unread > 99 ? "99+" : unread}</span>`
      : "";

  container.innerHTML = `
    <a href="notifications.html" title="Mes notifications"
       aria-label="Mes notifications${unread > 0 ? ` (${unread} non lues)` : ""}"
       class="relative w-9 h-9 rounded-full bg-secondarybg flex items-center justify-center text-mutedfg hover:text-appfg transition-colors">
      ${icon("bell")}${badge}
    </a>`;
}
