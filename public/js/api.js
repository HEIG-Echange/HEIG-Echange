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
    // Code machine renvoye par l'API (EMAIL_NOT_VERIFIED,
    // EMAIL_REVERIFICATION_REQUIRED…) : permet d'aiguiller vers la bonne page
    // sans dependre du texte du message.
    error.code = data?.code ?? null;
    error.data = data ?? null;
    throw error;
  }

  return data;
}

// Envoi multipart (upload de fichier). N'ajoute pas de Content-Type : le
// navigateur pose lui-meme le boundary a partir du FormData.
async function upload(path, formData, method = "POST") {
  const res = await fetch(path, {
    method,
    credentials: "include",
    body: formData,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(data?.error ?? `Erreur ${res.status}`);
    error.status = res.status;
    error.code = data?.code ?? null;
    error.data = data ?? null;
    throw error;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),
  put: (path, body) => request("PUT", path, body),
  del: (path, body) => request("DELETE", path, body),
  upload,
};

// ---------------------------------------------------------------------------
// Configuration publique
// ---------------------------------------------------------------------------

// Memoisee : une seule requete /config par chargement de page. Le domaine vient
// du serveur (PUBLIC_BASE_URL) et non de window.location, pour que les liens
// partages hors du navigateur — QR code, mail, copie de lien — pointent sur le
// vrai domaine et pas sur "localhost:3000". window.location.origin ne sert que
// de secours si /config est injoignable.
let configPromise = null;
export function getConfig() {
  if (!configPromise) {
    configPromise = api.get("/config").catch(() => ({
      publicBaseUrl: window.location.origin,
      maxPhotosPerListing: 10,
      maxPhotoSizeBytes: 5 * 1024 * 1024,
      acceptedPhotoMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ],
      reverificationIntervalDays: 180,
    }));
  }
  return configPromise;
}

// Transforme un chemin renvoye par l'API ("/uploads/x.jpg") en URL absolue sur
// le domaine public. Une URL deja absolue est laissee telle quelle.
export function absoluteUrl(baseUrl, pathOrUrl) {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(pathOrUrl).replace(/^\/+/, "")}`;
}

// ---------------------------------------------------------------------------
// Liens de partage
// ---------------------------------------------------------------------------

// Construit un lien mailto d'invitation a rejoindre la plateforme. Ouvre le
// client mail du visiteur avec un message pre-rempli (req: invitation par mail).
export function buildInviteMailto(baseUrl) {
  const subject = "Rejoins HEIG-Échange";
  const body =
    "Salut !\n\n" +
    "Je t'invite à rejoindre HEIG-Échange, la plateforme de don et d'échange " +
    "d'objets entre étudiant·e·s.\n\n" +
    `Ça se passe ici : ${baseUrl}\n\n` +
    "À bientôt !";
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Tous les liens de partage d'une annonce, bases sur les champs absolus
// renvoyes par l'API (shareUrl / qrUrl / photoAbsoluteUrl). Le parametre
// baseUrl sert de secours pour les reponses anciennes qui n'auraient pas
// encore ces champs.
export function buildListingShareLinks(listing, baseUrl) {
  const url = listing.shareUrl ?? `${baseUrl}/listing.html?id=${listing.id}`;
  const qrUrl = listing.qrUrl ?? `${baseUrl}/listings/${listing.id}/qr`;
  const imageUrl =
    listing.photoAbsoluteUrl ?? absoluteUrl(baseUrl, listing.photoUrl);

  const subject = `HEIG-Échange — ${listing.title}`;
  const body =
    `Salut !\n\nRegarde cet objet donné sur HEIG-Échange : « ${listing.title} »\n\n` +
    `${url}\n\nÀ bientôt !`;

  return {
    url,
    qrUrl,
    imageUrl,
    mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

// Lien mailto pour contacter le donneur d'une annonce.
export function buildContactMailto(listing, shareUrl) {
  const subject = `HEIG-Échange — ${listing.title}`;
  const body =
    `Bonjour ${listing.ownerName ?? ""},\n\n` +
    `Je suis intéressé·e par votre annonce « ${listing.title} » sur HEIG-Échange. ` +
    "Est-elle toujours disponible ?\n\n" +
    `${shareUrl}\n\nMerci !`;
  return `mailto:${listing.ownerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Lien profond Teams ouvrant une conversation avec le donneur, message
// pré-rempli. Teams n'expose pas de nom d'utilisateur public : l'adresse
// e-mail est l'identifiant utilisé par le lien, et c'est justement celui que
// l'API renvoie (`ownerEmail`). Comme tout le monde ici est sur le même
// annuaire (@heig-vd.ch / @hes-so.ch), Teams retrouve la personne et ouvre le
// chat directement.
//
// Le lien s'ouvre dans Teams web ; si le client lourd est installé, c'est lui
// qui prend la main. Si l'adresse est absente (visiteur non connecté, l'API ne
// l'expose alors pas), on renvoie null et l'appelant n'affiche pas le bouton.
export function buildTeamsChatUrl(listing, shareUrl) {
  if (!listing.ownerEmail) return null;
  const message =
    `Bonjour ${listing.ownerName ?? ""}, je suis intéressé·e par « ${listing.title} » ` +
    `sur HEIG-Échange. Est-il toujours disponible ? ${shareUrl}`;
  return (
    "https://teams.microsoft.com/l/chat/0/0" +
    `?users=${encodeURIComponent(listing.ownerEmail)}` +
    `&message=${encodeURIComponent(message)}`
  );
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

// Renvoie l'utilisateur connecte, ou null. Ne jette jamais.
// Un compte suspendu (adresse email a reconfirmer) repond 403 : on le traite
// comme "non connecte" cote affichage, mais on conserve l'info pour que
// requireUser puisse rediriger vers la page de reconfirmation.
// Memoise pour la duree de la page : plusieurs briques d'interface veulent
// connaitre l'utilisateur (pastille de compte, bandeau d'expiration, actions
// du proprietaire) et il n'y a aucune raison d'interroger /auth/me autant de
// fois. La navigation etant en rechargement complet, le cache ne peut pas
// devenir obsolete apres une connexion ou une deconnexion.
let lastAuthError = null;
let currentUserPromise = null;
export function getCurrentUser() {
  if (!currentUserPromise) {
    currentUserPromise = api
      .get("/auth/me")
      .then((user) => {
        lastAuthError = null;
        return user;
      })
      .catch((err) => {
        lastAuthError = err;
        return null;
      });
  }
  return currentUserPromise;
}

// A appeler en haut des pages qui exigent une session active.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    if (lastAuthError?.code === "EMAIL_REVERIFICATION_REQUIRED") {
      const email = lastAuthError.data?.email ?? "";
      window.location.href = `verify.html?email=${encodeURIComponent(email)}&reason=reverification`;
      return null;
    }
    window.location.href = "login.html";
    return null;
  }
  return user;
}

export async function logout() {
  await api.post("/auth/logout");
  window.location.href = "login.html";
}

// ---------------------------------------------------------------------------
// Libelles et petits helpers d'affichage
// ---------------------------------------------------------------------------

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

// Statuts d'une annonce, pilotables par le proprietaire depuis l'edition.
export const STATUS_LABELS = {
  available: "Disponible",
  reserved: "Réservée",
  closed: "Donnée",
};

export const STATUS_BADGE_CLASSES = {
  available: "bg-emerald-50 text-emerald-700",
  reserved: "bg-amber-50 text-amber-700",
  closed: "bg-mutedbg text-mutedfg",
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
