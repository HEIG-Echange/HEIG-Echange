import { requireUser, initials, escapeHtml } from "../api.js";
import { mountNav } from "../ui.js";

mountNav("friends");
await requireUser();

// Fonctionnalite en apercu : aucune table "groupes d'amis" n'existe encore
// cote API/base de donnees. On persiste localement (par appareil) pour que
// la maquette soit interactive en attendant le vrai backend.
const STORAGE_KEY = "heig-echange:priority-groups";

const COLORS = [
  { id: "blue", swatch: "bg-blue-500", header: "bg-blue-50", text: "text-blue-700" },
  { id: "pink", swatch: "bg-pink-500", header: "bg-pink-50", text: "text-pink-700" },
  { id: "amber", swatch: "bg-amber-500", header: "bg-amber-50", text: "text-amber-700" },
  { id: "emerald", swatch: "bg-emerald-500", header: "bg-emerald-50", text: "text-emerald-700" },
  { id: "purple", swatch: "bg-purple-500", header: "bg-purple-50", text: "text-purple-700" },
  { id: "orange", swatch: "bg-orange-500", header: "bg-orange-50", text: "text-orange-700" },
];

function colorFor(id) {
  return COLORS.find((c) => c.id === id) ?? COLORS[0];
}

function defaultGroups() {
  return [
    {
      id: crypto.randomUUID(),
      name: "Amis",
      color: "pink",
      members: [{ id: crypto.randomUUID(), name: "Lucas Favre", email: "lucas.favre@heig-vd.ch" }],
    },
    {
      id: crypto.randomUUID(),
      name: "Classe TIC-B",
      color: "blue",
      members: [
        { id: crypto.randomUUID(), name: "Amina Berrada", email: "amina.berrada@heig-vd.ch" },
        { id: crypto.randomUUID(), name: "Tom Müller", email: "tom.muller@heig-vd.ch" },
      ],
    },
  ];
}

function loadGroups() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = defaultGroups();
      saveGroups(seeded);
      return seeded;
    }
    return JSON.parse(raw);
  } catch {
    return defaultGroups();
  }
}

function saveGroups(groups) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

let groups = loadGroups();

const container = document.getElementById("groups-container");
const newGroupBtn = document.getElementById("new-group-btn");
const newGroupForm = document.getElementById("new-group-form");
const newGroupName = document.getElementById("new-group-name");
const colorPicker = document.getElementById("color-picker");
const cancelGroupBtn = document.getElementById("cancel-group-btn");
const createGroupBtn = document.getElementById("create-group-btn");

let selectedColor = COLORS[0].id;

for (const color of COLORS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `w-9 h-9 rounded-full ${color.swatch} border-2 ${color.id === selectedColor ? "border-appfg" : "border-transparent"}`;
  btn.addEventListener("click", () => {
    selectedColor = color.id;
    [...colorPicker.children].forEach((c) => c.classList.remove("border-appfg"));
    [...colorPicker.children].forEach((c) => c.classList.add("border-transparent"));
    btn.classList.remove("border-transparent");
    btn.classList.add("border-appfg");
  });
  colorPicker.appendChild(btn);
}

function render() {
  container.innerHTML = "";

  for (const group of groups) {
    const color = colorFor(group.color);
    const card = document.createElement("div");
    card.className = "bg-white border border-appfg/10 rounded-xl overflow-hidden";
    card.innerHTML = `
      <div class="${color.header} ${color.text} px-4 py-2.5 flex items-center justify-between">
        <span class="font-bold text-sm flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${color.swatch}"></span> ${escapeHtml(group.name)}
        </span>
        <button type="button" data-action="delete-group" class="text-xs opacity-70 hover:opacity-100">Supprimer</button>
      </div>
      <div class="divide-y divide-appfg/5">
        ${group.members.map((m) => `
          <div class="flex items-center gap-3 px-4 py-2.5">
            <div class="w-8 h-8 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(initials(m.name))}</div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-bold truncate">${escapeHtml(m.name)}</p>
              <p class="text-xs text-mutedfg truncate">${escapeHtml(m.email)}</p>
            </div>
            <button type="button" data-action="remove-member" data-member-id="${m.id}" class="text-mutedfg hover:text-brand w-6 h-6 flex items-center justify-center flex-shrink-0">✕</button>
          </div>
        `).join("") || `<p class="px-4 py-3 text-xs text-mutedfg">Aucun membre pour l'instant.</p>`}
      </div>
      <form data-action="add-member-form" class="flex gap-2 px-4 py-2.5 bg-secondarybg/50">
        <input type="email" required placeholder="email@heig-vd.ch" class="flex-1 min-w-0 bg-white border border-appfg/15 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand/30" />
        <button type="submit" class="text-xs font-bold bg-white border border-appfg/15 rounded-lg px-3 py-1.5 hover:border-brand/40">Ajouter</button>
      </form>
    `;

    card.querySelector('[data-action="delete-group"]').addEventListener("click", () => {
      if (!confirm(`Supprimer le groupe "${group.name}" ?`)) return;
      groups = groups.filter((g) => g.id !== group.id);
      saveGroups(groups);
      render();
    });

    card.querySelectorAll('[data-action="remove-member"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        group.members = group.members.filter((m) => m.id !== btn.dataset.memberId);
        saveGroups(groups);
        render();
      });
    });

    card.querySelector('[data-action="add-member-form"]').addEventListener("submit", (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const email = input.value.trim();
      if (!email) return;
      const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      group.members.push({ id: crypto.randomUUID(), name, email });
      saveGroups(groups);
      render();
    });

    container.appendChild(card);
  }
}

newGroupBtn.addEventListener("click", () => {
  newGroupForm.classList.remove("hidden");
  newGroupBtn.classList.add("hidden");
  newGroupName.focus();
});

cancelGroupBtn.addEventListener("click", () => {
  newGroupForm.classList.add("hidden");
  newGroupBtn.classList.remove("hidden");
  newGroupName.value = "";
});

createGroupBtn.addEventListener("click", () => {
  const name = newGroupName.value.trim();
  if (!name) {
    newGroupName.focus();
    return;
  }
  groups.push({ id: crypto.randomUUID(), name, color: selectedColor, members: [] });
  saveGroups(groups);
  newGroupName.value = "";
  newGroupForm.classList.add("hidden");
  newGroupBtn.classList.remove("hidden");
  render();
});

render();
