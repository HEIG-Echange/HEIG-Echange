import { api, getCurrentUser, initials, CONDITION_LABELS, CONDITION_BADGE_CLASSES, categoryBadgeClass, escapeHtml } from "../api.js";

const contentEl = document.getElementById("content");
const id = new URLSearchParams(window.location.search).get("id");

if (!id) {
  contentEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">Annonce introuvable.</p>`;
} else {
  render();
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

  const gallery = listing.photos.length
    ? `<div class="flex overflow-x-auto no-scrollbar snap-x snap-mandatory">
        ${listing.photos.map((p) => `<img src="${escapeHtml(p.url)}" class="w-full flex-shrink-0 h-64 object-cover snap-center" />`).join("")}
      </div>`
    : `<div class="w-full h-56 bg-mutedbg flex items-center justify-center text-5xl">📦</div>`;

  const conditionLabel = CONDITION_LABELS[listing.itemCondition] ?? listing.itemCondition;
  const conditionClass = CONDITION_BADGE_CLASSES[listing.itemCondition] ?? "bg-gray-50 text-gray-700";
  const badgeClass = categoryBadgeClass(listing.categoryId);

  contentEl.innerHTML = `
    ${gallery}
    <div class="px-4 py-4 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        ${listing.categoryLabel ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}">${escapeHtml(listing.categoryLabel)}</span>` : ""}
        <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${conditionClass}">${conditionLabel}</span>
        ${listing.status === "closed" ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-mutedbg text-mutedfg">Retirée</span>` : ""}
      </div>
      <h2 class="text-xl font-extrabold">${escapeHtml(listing.title)}</h2>
      <p class="text-sm text-appfg/80 whitespace-pre-line">${escapeHtml(listing.description)}</p>
      ${listing.location ? `<p class="text-sm text-mutedfg flex items-center gap-1.5">📍 ${escapeHtml(listing.location)}</p>` : ""}
      <div class="flex items-center gap-2 pt-2 border-t border-appfg/10">
        <a href="u.html?id=${listing.ownerId}" class="flex items-center gap-2 min-w-0">
          <div class="w-8 h-8 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(initials(listing.ownerName))}</div>
          <span class="text-sm text-mutedfg truncate">Proposé par ${escapeHtml(listing.ownerName ?? "un·e étudiant·e")}</span>
        </a>
      </div>
      <div id="action-zone" class="pt-2"></div>
    </div>
  `;

  const actionZone = document.getElementById("action-zone");
  if (isOwner) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "w-full border-2 border-red-200 text-red-600 font-bold rounded-xl py-3 hover:bg-red-50 transition-colors";
    btn.textContent = "Retirer l'annonce";
    btn.addEventListener("click", async () => {
      if (!confirm("Retirer cette annonce ?")) return;
      try {
        await api.del(`/listings/${listing.id}`);
        window.location.href = "profile.html";
      } catch (err) {
        alert(err.message);
      }
    });
    actionZone.appendChild(btn);
  } else if (user && listing.ownerEmail) {
    // Visiteur connecte : contact par mail du proprietaire, message pre-rempli.
    const subject = `HEIG-Échange — ${listing.title}`;
    const body =
      `Bonjour ${listing.ownerName ?? ""},\n\n` +
      `Je suis intéressé·e par votre annonce « ${listing.title} » sur HEIG-Échange. ` +
      "Est-elle toujours disponible ?\n\n" +
      `${window.location.href}\n\nMerci !`;
    const mailto = `mailto:${listing.ownerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    actionZone.innerHTML = `
      <a href="${mailto}"
         class="block text-center w-full bg-brand hover:bg-brand-dark text-white font-bold rounded-xl py-3 transition-colors">
        ✉️ Contacter par mail
      </a>
    `;
  } else {
    // Visiteur non connecte : les coordonnees ne sont pas exposees.
    actionZone.innerHTML = `
      <a href="login.html"
         class="block text-center w-full bg-brand hover:bg-brand-dark text-white font-bold rounded-xl py-3 transition-colors">
        Se connecter pour contacter le donneur
      </a>
      <p class="text-[11px] text-mutedfg text-center mt-2">Les coordonnées ne sont visibles que par les membres connectés.</p>
    `;
  }
}
