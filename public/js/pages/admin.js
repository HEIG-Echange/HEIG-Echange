// ---------------------------------------------------------------------------
// Console de moderation (reservee aux administrateurs).
//
// Elle ne fait qu'habiller des endpoints qui existaient deja cote API :
//   GET   /admin/reports            file des signalements
//   PATCH /admin/reports/:id        traiter / classer un signalement
//   GET   /admin/users              annuaire des comptes
//   POST  /admin/users/:id/block    bloquer   (motif obligatoire)
//   POST  /admin/users/:id/unblock  debloquer
//   GET   /admin/moderation-logs    historique des actions
//   DELETE /listings/:id            retirer une annonce (motif obligatoire)
//
// Le controle d'acces reste cote serveur (middleware requireAdmin) : masquer
// la page ne protege rien, c'est l'API qui refuse.
// ---------------------------------------------------------------------------
import { api, requireUser, escapeHtml } from "../api.js";
import { mountNav, mountAccountChip, mountNotificationBell, icon } from "../ui.js";

mountNav("profile");
mountAccountChip(document.getElementById("account-chip"));
mountNotificationBell(document.getElementById("notif-bell"));

const user = await requireUser();

const tabsEl = document.getElementById("tabs");
const panelEl = document.getElementById("panel");

const TABS = [
  { key: "reports", label: "Signalements" },
  { key: "users", label: "Comptes" },
  { key: "logs", label: "Historique" },
];

// ?tab=... : les notifications "nouveau signalement" pointent directement sur
// la bonne section.
let activeTab = new URLSearchParams(window.location.search).get("tab");
if (!TABS.some((t) => t.key === activeTab)) activeTab = "reports";

let reportStatusFilter = "open";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderTabs() {
  tabsEl.innerHTML = TABS.map(
    (tab) => `
      <button type="button" data-tab="${tab.key}" aria-pressed="${tab.key === activeTab}"
              class="flex-shrink-0 rounded-full px-4 py-2 whitespace-nowrap transition-colors ${
                tab.key === activeTab
                  ? "bg-brand text-white"
                  : "bg-white text-mutedfg border border-appfg/10 hover:border-brand/40 hover:text-appfg"
              }">${escapeHtml(tab.label)}</button>`
  ).join("");

  for (const btn of tabsEl.querySelectorAll("button[data-tab]")) {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      renderTabs();
      loadPanel();
    });
  }
}

function loading() {
  panelEl.innerHTML = `<p class="text-center text-sm text-mutedfg py-10">Chargement…</p>`;
}

function showError(err) {
  panelEl.innerHTML = `<p class="text-center text-sm text-red-600 py-10">${escapeHtml(err.message)}</p>`;
}

function emptyState(message) {
  return `<div class="text-center py-14 border border-dashed border-appfg/15 rounded-2xl">
            <p class="text-sm text-mutedfg">${escapeHtml(message)}</p>
          </div>`;
}

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

const REPORT_STATUS_LABELS = {
  open: "En attente",
  reviewed: "Traité",
  dismissed: "Classé sans suite",
};

const REPORT_STATUS_CLASSES = {
  open: "bg-amber-50 text-amber-700",
  reviewed: "bg-emerald-50 text-emerald-700",
  dismissed: "bg-mutedbg text-mutedfg",
};

function reportCard(report) {
  const statusClass = REPORT_STATUS_CLASSES[report.status] ?? "bg-mutedbg text-mutedfg";

  return `
    <article data-report="${report.id}" class="bg-white border border-appfg/10 rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <a href="listing.html?id=${report.listingId}" class="text-sm font-bold hover:underline">
            ${escapeHtml(report.listingTitle ?? `Annonce #${report.listingId}`)}
          </a>
          <p class="text-xs text-mutedfg mt-0.5">
            Signalé par ${escapeHtml(report.reporterName ?? "un compte supprimé")} — ${escapeHtml(formatDate(report.createdAt))}
          </p>
        </div>
        <span class="text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusClass}">${REPORT_STATUS_LABELS[report.status] ?? report.status}</span>
      </div>

      <p class="text-sm mt-3 bg-secondarybg rounded-xl px-3 py-2 whitespace-pre-line">${escapeHtml(report.reason)}</p>

      ${
        report.status === "open"
          ? `<div class="flex flex-wrap gap-2 mt-3">
               <button type="button" data-act="review"
                       class="inline-flex items-center gap-1.5 text-sm font-bold bg-brand hover:bg-brand-dark text-white rounded-xl px-3.5 py-2 transition-colors">
                 ${icon("check")} Marquer traité
               </button>
               <button type="button" data-act="dismiss"
                       class="text-sm font-bold border border-appfg/15 rounded-xl px-3.5 py-2 hover:bg-secondarybg transition-colors">
                 Classer sans suite
               </button>
               <button type="button" data-act="remove-listing"
                       class="inline-flex items-center gap-1.5 text-sm font-bold border-2 border-red-200 text-red-600 rounded-xl px-3.5 py-2 hover:bg-red-50 transition-colors">
                 ${icon("trash")} Retirer l'annonce
               </button>
             </div>`
          : `<p class="text-xs text-mutedfg mt-3">Traité le ${escapeHtml(formatDate(report.reviewedAt))}</p>`
      }
      <p data-feedback class="text-xs mt-2"></p>
    </article>`;
}

async function loadReports() {
  loading();

  let reports;
  try {
    const query = reportStatusFilter === "all" ? "" : `?status=${reportStatusFilter}`;
    reports = await api.get(`/admin/reports${query}`);
  } catch (err) {
    showError(err);
    return;
  }

  const filters = ["open", "reviewed", "dismissed", "all"]
    .map(
      (value) => `
        <button type="button" data-filter="${value}"
                class="text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                  value === reportStatusFilter
                    ? "bg-white text-appfg shadow-sm"
                    : "text-mutedfg hover:text-appfg"
                }">${value === "all" ? "Tous" : REPORT_STATUS_LABELS[value]}</button>`
    )
    .join("");

  panelEl.innerHTML = `
    <div class="inline-flex items-center gap-1 bg-secondarybg border border-appfg/10 rounded-xl p-1 mb-4"
         role="group" aria-label="Filtrer les signalements">${filters}</div>
    <div class="space-y-3">
      ${reports.length ? reports.map(reportCard).join("") : emptyState("Aucun signalement dans cette catégorie.")}
    </div>`;

  for (const btn of panelEl.querySelectorAll("button[data-filter]")) {
    btn.addEventListener("click", () => {
      reportStatusFilter = btn.dataset.filter;
      loadReports();
    });
  }

  for (const article of panelEl.querySelectorAll("article[data-report]")) {
    const id = Number(article.dataset.report);
    const report = reports.find((r) => r.id === id);
    const feedback = article.querySelector("[data-feedback]");

    const fail = (message) => {
      feedback.className = "text-xs mt-2 text-red-600";
      feedback.textContent = message;
    };

    article.querySelector('[data-act="review"]')?.addEventListener("click", async () => {
      const note = prompt("Note interne (facultative) :") ?? "";
      try {
        await api.patch(`/admin/reports/${id}`, { status: "reviewed", note });
        loadReports();
      } catch (err) {
        fail(err.message);
      }
    });

    article.querySelector('[data-act="dismiss"]')?.addEventListener("click", async () => {
      const note = prompt("Pourquoi classer ce signalement sans suite ?") ?? "";
      try {
        await api.patch(`/admin/reports/${id}`, { status: "dismissed", note });
        loadReports();
      } catch (err) {
        fail(err.message);
      }
    });

    // Retirer l'annonce ET traiter le signalement : les deux actions vont
    // ensemble, sinon le signalement resterait "en attente" pour une annonce
    // qui n'existe plus.
    article.querySelector('[data-act="remove-listing"]')?.addEventListener("click", async () => {
      const reason = prompt("Motif du retrait (transmis au propriétaire) :");
      if (reason === null) return;
      if (!reason.trim()) {
        fail("Un motif est obligatoire pour retirer une annonce.");
        return;
      }
      try {
        await api.del(`/listings/${report.listingId}`, { reason: reason.trim() });
        await api.patch(`/admin/reports/${id}`, {
          status: "reviewed",
          note: `Annonce retirée : ${reason.trim()}`,
        });
        loadReports();
      } catch (err) {
        fail(err.message);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

const EMAIL_STATUS_LABELS = {
  unverified: "Email non confirmé",
  verified: "Email confirmé",
  expiring: "Confirmation bientôt expirée",
  expired: "Compte suspendu (email expiré)",
};

function userRow(account) {
  const badges = [
    account.role === "admin"
      ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">Admin</span>`
      : "",
    account.isBlocked
      ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">Bloqué</span>`
      : "",
    account.deletedAt
      ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-mutedbg text-mutedfg">Compte supprimé</span>`
      : "",
    account.openReports > 0
      ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">${account.openReports} signalement(s)</span>`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <article data-user="${account.id}" class="bg-white border border-appfg/10 rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <a href="u.html?id=${account.id}" class="text-sm font-bold hover:underline">${escapeHtml(account.displayName)}</a>
          <p class="text-xs text-mutedfg font-mono truncate">${escapeHtml(account.email)}</p>
          <p class="text-[11px] text-mutedfg mt-1">
            ${escapeHtml(EMAIL_STATUS_LABELS[account.emailStatus] ?? account.emailStatus)} —
            ${account.listingsCount} annonce(s) — inscrit le ${escapeHtml(formatDate(account.createdAt))}
          </p>
          ${account.blockedReason ? `<p class="text-xs text-red-700 mt-1">Motif du blocage : ${escapeHtml(account.blockedReason)}</p>` : ""}
        </div>
        <div class="flex flex-col items-end gap-2">
          <div class="flex gap-1.5 flex-wrap justify-end">${badges}</div>
          ${
            account.deletedAt
              ? ""
              : account.isBlocked
                ? `<button type="button" data-act="unblock"
                           class="text-sm font-bold border border-appfg/15 rounded-xl px-3.5 py-2 hover:bg-secondarybg transition-colors">Débloquer</button>`
                : `<button type="button" data-act="block"
                           class="text-sm font-bold border-2 border-red-200 text-red-600 rounded-xl px-3.5 py-2 hover:bg-red-50 transition-colors">Bloquer</button>`
          }
        </div>
      </div>
      <p data-feedback class="text-xs mt-2 text-red-600"></p>
    </article>`;
}

let userSearch = "";

async function loadUsers() {
  loading();

  let accounts;
  try {
    const query = userSearch ? `?q=${encodeURIComponent(userSearch)}` : "";
    accounts = await api.get(`/admin/users${query}`);
  } catch (err) {
    showError(err);
    return;
  }

  panelEl.innerHTML = `
    <input id="user-search" type="search" value="${escapeHtml(userSearch)}"
           placeholder="Rechercher un nom ou une adresse email…"
           class="w-full bg-secondarybg border border-appfg/10 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand/30" />
    <div class="space-y-3">
      ${accounts.length ? accounts.map(userRow).join("") : emptyState("Aucun compte ne correspond.")}
    </div>`;

  const search = document.getElementById("user-search");
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      userSearch = search.value.trim();
      loadUsers();
    }, 300);
  });

  for (const article of panelEl.querySelectorAll("article[data-user]")) {
    const id = Number(article.dataset.user);
    const feedback = article.querySelector("[data-feedback]");

    article.querySelector('[data-act="block"]')?.addEventListener("click", async () => {
      const reason = prompt("Motif du blocage (transmis à la personne) :");
      if (reason === null) return;
      if (!reason.trim()) {
        feedback.textContent = "Un motif est obligatoire pour bloquer un compte.";
        return;
      }
      try {
        await api.post(`/admin/users/${id}/block`, { reason: reason.trim() });
        loadUsers();
      } catch (err) {
        feedback.textContent = err.message;
      }
    });

    article.querySelector('[data-act="unblock"]')?.addEventListener("click", async () => {
      const reason = prompt("Motif du déblocage (facultatif) :") ?? "";
      try {
        await api.post(`/admin/users/${id}/unblock`, reason.trim() ? { reason: reason.trim() } : {});
        loadUsers();
      } catch (err) {
        feedback.textContent = err.message;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Historique des actions de moderation
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  block_user: "Compte bloqué",
  unblock_user: "Compte débloqué",
  delete_listing: "Annonce retirée",
  review_report: "Signalement traité",
  dismiss_report: "Signalement classé",
};

async function loadLogs() {
  loading();

  let logs;
  try {
    logs = await api.get("/admin/moderation-logs");
  } catch (err) {
    showError(err);
    return;
  }

  if (logs.length === 0) {
    panelEl.innerHTML = emptyState("Aucune action de modération enregistrée.");
    return;
  }

  panelEl.innerHTML = `
    <ol class="space-y-2">
      ${logs
        .map((log) => {
          const target =
            log.targetType === "user"
              ? `<a href="u.html?id=${log.targetId}" class="hover:underline">compte #${log.targetId}</a>`
              : `<a href="listing.html?id=${log.targetId}" class="hover:underline">annonce #${log.targetId}</a>`;
          const details =
            log.details && typeof log.details === "object"
              ? Object.entries(log.details)
                  .filter(([, value]) => value !== null && value !== "")
                  .map(([key, value]) => `${key} : ${value}`)
                  .join(" — ")
              : "";
          return `
            <li class="bg-white border border-appfg/10 rounded-xl px-4 py-3">
              <p class="text-sm font-bold">${escapeHtml(ACTION_LABELS[log.action] ?? log.action)}</p>
              <p class="text-xs text-mutedfg mt-0.5">
                ${escapeHtml(log.actorName ?? "compte supprimé")} — ${target} — ${escapeHtml(formatDate(log.createdAt))}
              </p>
              ${details ? `<p class="text-xs text-mutedfg mt-1">${escapeHtml(details)}</p>` : ""}
            </li>`;
        })
        .join("")}
    </ol>`;
}

function loadPanel() {
  if (activeTab === "users") return loadUsers();
  if (activeTab === "logs") return loadLogs();
  return loadReports();
}

// Garde-fou d'affichage. La vraie protection est cote API (requireAdmin) :
// un non-admin qui ouvre cette page ne recevrait de toute facon que des 403.
if (user.role !== "admin") {
  tabsEl.innerHTML = "";
  panelEl.innerHTML = `
    <div class="text-center py-16 border border-dashed border-appfg/15 rounded-2xl">
      <p class="text-sm font-bold">Cette page est réservée aux administrateurs.</p>
      <a href="index.html" class="inline-block mt-3 text-sm font-bold text-brand hover:underline">Retour aux annonces</a>
    </div>`;
} else {
  renderTabs();
  loadPanel();
}
