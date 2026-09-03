import { api, requireUser, escapeHtml } from "../api.js";
import { mountNav, mountAccountChip, icon } from "../ui.js";

mountNav("profile");
mountAccountChip(document.getElementById("account-chip"));

// Page personnelle : sans session, requireUser renvoie sur la connexion.
await requireUser();

const listEl = document.getElementById("list");
const readAllBtn = document.getElementById("read-all-btn");

let notifications = [];

// Pastille de couleur par famille d'evenement : d'un coup d'oeil on distingue
// "quelqu'un veut mon objet" d'une decision de moderation.
const TYPE_STYLES = {
  listing_interest: { icon: "starFilled", class: "bg-amber-50 text-amber-600" },
  listing_removed: { icon: "trash", class: "bg-red-50 text-red-600" },
  report_created: { icon: "flag", class: "bg-red-50 text-red-600" },
  report_reviewed: { icon: "shield", class: "bg-sky-50 text-sky-700" },
  account_blocked: { icon: "shield", class: "bg-red-50 text-red-600" },
  account_unblocked: { icon: "shield", class: "bg-emerald-50 text-emerald-700" },
};

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-CH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function notificationHtml(item) {
  const style = TYPE_STYLES[item.type] ?? { icon: "bell", class: "bg-secondarybg text-mutedfg" };
  const unreadDot = item.read
    ? ""
    : `<span class="w-2 h-2 rounded-full bg-brand flex-shrink-0 mt-2" aria-label="Non lue"></span>`;

  return `
    <article data-id="${item.id}"
             class="flex items-start gap-3 bg-white border rounded-2xl px-4 py-3 ${item.read ? "border-appfg/10" : "border-brand/40 bg-brand/[0.03]"}">
      <span class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${style.class}">${icon(style.icon)}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-bold leading-snug">${escapeHtml(item.title)}</p>
        ${item.body ? `<p class="text-xs text-mutedfg mt-1 whitespace-pre-line">${escapeHtml(item.body)}</p>` : ""}
        <p class="text-[11px] text-mutedfg mt-1.5">${escapeHtml(formatDate(item.createdAt))}</p>
        <div class="flex items-center gap-3 mt-2">
          ${item.link ? `<a href="${escapeHtml(item.link)}" data-open class="text-xs font-bold text-brand hover:underline">Ouvrir</a>` : ""}
          ${item.read ? "" : `<button type="button" data-read class="text-xs font-bold text-mutedfg hover:text-appfg">Marquer comme lue</button>`}
          <button type="button" data-delete class="text-xs font-bold text-mutedfg hover:text-red-600">Supprimer</button>
        </div>
      </div>
      ${unreadDot}
    </article>`;
}

function render() {
  const unread = notifications.filter((n) => !n.read).length;
  readAllBtn.classList.toggle("hidden", unread === 0);

  if (notifications.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-16 border border-dashed border-appfg/15 rounded-2xl">
        <p class="text-sm text-mutedfg">Aucune notification pour l'instant.</p>
        <p class="text-xs text-mutedfg mt-1">Vous serez prévenu·e ici quand quelqu'un s'intéresse à un de vos objets.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = notifications.map(notificationHtml).join("");

  for (const article of listEl.querySelectorAll("article[data-id]")) {
    const id = Number(article.dataset.id);

    article.querySelector("[data-read]")?.addEventListener("click", () => markRead(id));

    // Ouvrir la cible marque aussi la notification comme lue : sans ca, la
    // pastille resterait allumee alors que l'utilisateur a vu l'information.
    article.querySelector("[data-open]")?.addEventListener("click", (event) => {
      const item = notifications.find((n) => n.id === id);
      if (item && !item.read) {
        event.preventDefault();
        markRead(id).finally(() => {
          window.location.href = item.link;
        });
      }
    });

    article.querySelector("[data-delete]")?.addEventListener("click", async () => {
      try {
        await api.del(`/notifications/${id}`);
        notifications = notifications.filter((n) => n.id !== id);
        render();
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

async function markRead(id) {
  try {
    await api.post(`/notifications/${id}/read`);
    const item = notifications.find((n) => n.id === id);
    if (item) {
      item.read = true;
      item.readAt = new Date().toISOString();
    }
    render();
  } catch (err) {
    alert(err.message);
  }
}

readAllBtn.addEventListener("click", async () => {
  try {
    await api.post("/notifications/read-all");
    notifications = notifications.map((n) => ({ ...n, read: true }));
    render();
  } catch (err) {
    alert(err.message);
  }
});

try {
  const data = await api.get("/notifications");
  notifications = data.notifications ?? [];
  render();
} catch (err) {
  listEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">${escapeHtml(err.message)}</p>`;
}
