// Petit client fetch partage par toutes les pages. Pas de bundler dans ce
// projet : ce fichier est charge tel quel via <script type="module">.

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return null;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.error ?? `Erreur ${res.status}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  del: (path) => request("DELETE", path),
};

// Renvoie l'utilisateur connecte, ou null. Ne jette jamais.
export async function getCurrentUser() {
  try {
    return await api.get("/auth/me");
  } catch {
    return null;
  }
}

// A appeler en haut des pages qui exigent une session active.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }
  return user;
}

export async function logout() {
  await api.post("/auth/logout");
  window.location.href = "login.html";
}

// Libelles francais pour les valeurs ENUM de l'API.
export const CONDITION_LABELS = {
  neuf: "Neuf",
  tres_bon: "Très bon état",
  bon: "Bon état",
  usage: "Usagé",
  a_reparer: "À réparer",
};

export const CONDITION_BADGE_CLASSES = {
  neuf: "bg-emerald-50 text-emerald-700",
  tres_bon: "bg-sky-50 text-sky-700",
  bon: "bg-amber-50 text-amber-700",
  usage: "bg-orange-50 text-orange-700",
  a_reparer: "bg-red-50 text-red-700",
};

const CATEGORY_BADGE_PALETTE = [
  "bg-blue-50 text-blue-700 border-blue-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-purple-50 text-purple-700 border-purple-200",
  "bg-pink-50 text-pink-700 border-pink-200",
  "bg-teal-50 text-teal-700 border-teal-200",
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-orange-50 text-orange-700 border-orange-200",
];

// Couleur stable par categorie (deduite de l'id), sans dependre d'une liste
// figee cote frontend.
export function categoryBadgeClass(categoryId) {
  if (!categoryId) return CATEGORY_BADGE_PALETTE[0];
  return CATEGORY_BADGE_PALETTE[categoryId % CATEGORY_BADGE_PALETTE.length];
}

export function initials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
