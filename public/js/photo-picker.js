// ---------------------------------------------------------------------------
// Sélecteur de photos d'annonce.
//
// Utilisé par le formulaire de création ET par celui d'édition. Il gère deux
// listes distinctes :
//
//   - `existing` : les photos déjà en base (mode édition). Toute action sur
//     elles passe immédiatement par l'API (DELETE, PATCH de l'ordre).
//   - `pending`  : les fichiers choisis dans le navigateur, pas encore envoyés.
//     Ils ne partent qu'au moment de l'enregistrement, une fois que l'annonce
//     a un id (à la création, l'id n'existe pas avant le POST).
//
// Règles reprises telles quelles de l'API (GET /config en est la source) :
// nombre maximum de photos, taille maximale d'un fichier, types MIME acceptés.
// Un fichier hors limites est refusé au moment où l'utilisateur le choisit,
// avec un message qui nomme le fichier — plutôt que de laisser l'envoi échouer
// en 400 après la publication de l'annonce.
//
// Les envois sont séquentiels et fichier par fichier : l'ordre des positions
// est ainsi celui affiché à l'écran, et un fichier refusé par le serveur ne
// fait pas perdre les autres.
// ---------------------------------------------------------------------------
import { api, getConfig, escapeHtml } from "./api.js";

const FALLBACK = {
  maxPhotosPerListing: 10,
  maxPhotoSizeBytes: 5 * 1024 * 1024,
  acceptedPhotoMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
};

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} Mo`;
  return `${Math.round(bytes / 1024)} Ko`;
}

// "image/jpeg" -> "JPEG". Sert à écrire la liste des formats acceptés dans les
// messages d'erreur sans la coder en dur dans le frontend.
function mimeLabel(mime) {
  return String(mime).replace(/^image\//, "").toUpperCase();
}

/**
 * @param {object} options
 * @param {HTMLElement} options.dropzone     zone cliquable / de dépôt
 * @param {HTMLInputElement} options.input   <input type="file">
 * @param {HTMLElement} options.previews     conteneur des vignettes
 * @param {HTMLElement} options.hint         compteur "n / max"
 * @param {(msg: string) => void} options.onError    message d'erreur à afficher
 * @param {() => void} [options.onChange]    appelé après toute modification
 */
export function createPhotoPicker({
  dropzone,
  input,
  previews,
  hint,
  onError,
  onChange,
}) {
  let limits = { ...FALLBACK };
  let listingId = null;

  /** @type {{id:number, url:string}[]} photos déjà en base */
  let existing = [];
  /** @type {{file: File, url: string}[]} fichiers choisis, pas encore envoyés */
  let pending = [];

  const notifyChange = () => onChange?.();

  function total() {
    return existing.length + pending.length;
  }

  // -------------------------------------------------------------------------
  // Sélection de fichiers
  // -------------------------------------------------------------------------

  /**
   * Filtre une sélection selon les règles de l'API. Renvoie les fichiers
   * retenus et la liste des refus, chacun avec sa raison — l'utilisateur doit
   * savoir *quelle* photo pose problème quand il en dépose plusieurs.
   */
  function screen(files) {
    const accepted = [];
    const rejected = [];
    let room = limits.maxPhotosPerListing - total();

    for (const file of files) {
      if (room <= 0) {
        rejected.push(
          `« ${file.name} » : maximum ${limits.maxPhotosPerListing} photos par annonce.`
        );
        continue;
      }
      if (!limits.acceptedPhotoMimeTypes.includes(file.type)) {
        rejected.push(
          `« ${file.name} » : format non accepté (formats acceptés : ${limits.acceptedPhotoMimeTypes
            .map(mimeLabel)
            .join(", ")}).`
        );
        continue;
      }
      if (file.size > limits.maxPhotoSizeBytes) {
        rejected.push(
          `« ${file.name} » : ${formatSize(file.size)}, la limite est de ${formatSize(limits.maxPhotoSizeBytes)}.`
        );
        continue;
      }
      accepted.push(file);
      room -= 1;
    }

    return { accepted, rejected };
  }

  function addFiles(files) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;

    const { accepted, rejected } = screen(list);

    for (const file of accepted) {
      // Une URL d'objet par fichier, créée une seule fois et révoquée au
      // retrait : re-créer à chaque rendu ferait fuir de la mémoire.
      pending.push({ file, url: URL.createObjectURL(file) });
    }

    if (rejected.length > 0) onError(rejected.join("\n"));
    render();
    notifyChange();
  }

  function removePending(entry) {
    pending = pending.filter((p) => p !== entry);
    URL.revokeObjectURL(entry.url);
    render();
    notifyChange();
  }

  function movePending(entry, offset) {
    const index = pending.indexOf(entry);
    const target = index + offset;
    if (index === -1 || target < 0 || target >= pending.length) return;
    pending.splice(target, 0, ...pending.splice(index, 1));
    render();
  }

  // -------------------------------------------------------------------------
  // Photos déjà en ligne (mode édition) : chaque action part tout de suite
  // -------------------------------------------------------------------------

  async function removeExisting(photo) {
    if (!confirm("Supprimer cette photo de l'annonce ?")) return;
    try {
      await api.del(`/listings/${listingId}/photos/${photo.id}`);
      existing = existing.filter((p) => p.id !== photo.id);
      render();
      notifyChange();
    } catch (err) {
      onError(err.message);
    }
  }

  /**
   * Déplace une photo en ligne. L'API veut l'ordre complet
   * (PATCH /listings/:id/photos), on lui renvoie donc toute la liste.
   * L'affichage est mis à jour d'abord, puis remis dans l'état du serveur si
   * la requête échoue.
   */
  async function moveExisting(photo, offset) {
    const index = existing.indexOf(photo);
    const target = index + offset;
    if (index === -1 || target < 0 || target >= existing.length) return;

    const before = [...existing];
    existing.splice(target, 0, ...existing.splice(index, 1));
    render();

    try {
      const result = await api.patch(`/listings/${listingId}/photos`, {
        photoIds: existing.map((p) => p.id),
      });
      existing = result.photos ?? existing;
    } catch (err) {
      existing = before;
      onError(err.message);
    }
    render();
  }

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------

  // Une vignette = l'image, un bouton de retrait, les flèches de réordonnancement
  // et, pour la première, l'étiquette « Vignette » (c'est la photo qui
  // représente l'annonce dans les listes).
  function thumb({ src, alt, isCover, canLeft, canRight, onRemove, onLeft, onRight }) {
    const div = document.createElement("div");
    div.className = "photo-thumb";
    div.innerHTML = `
      <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />
      <button type="button" class="thumb-remove" title="Retirer cette photo" aria-label="Retirer ${escapeHtml(alt)}">&#10005;</button>
      <div class="thumb-move">
        <button type="button" data-left ${canLeft ? "" : "disabled"} title="Déplacer vers la gauche" aria-label="Déplacer ${escapeHtml(alt)} vers la gauche">&#8249;</button>
        <button type="button" data-right ${canRight ? "" : "disabled"} title="Déplacer vers la droite" aria-label="Déplacer ${escapeHtml(alt)} vers la droite">&#8250;</button>
      </div>
      ${isCover ? `<span class="thumb-cover">Vignette</span>` : ""}
    `;
    div.querySelector(".thumb-remove").addEventListener("click", onRemove);
    div.querySelector("[data-left]").addEventListener("click", onLeft);
    div.querySelector("[data-right]").addEventListener("click", onRight);
    return div;
  }

  function render() {
    previews.innerHTML = "";

    existing.forEach((photo, index) => {
      previews.appendChild(
        thumb({
          src: photo.url,
          alt: `Photo ${index + 1}`,
          isCover: index === 0,
          canLeft: index > 0,
          canRight: index < existing.length - 1,
          onRemove: () => removeExisting(photo),
          onLeft: () => moveExisting(photo, -1),
          onRight: () => moveExisting(photo, 1),
        })
      );
    });

    pending.forEach((entry, index) => {
      previews.appendChild(
        thumb({
          src: entry.url,
          alt: `Nouvelle photo ${index + 1}`,
          isCover: existing.length === 0 && index === 0,
          canLeft: index > 0,
          canRight: index < pending.length - 1,
          onRemove: () => removePending(entry),
          onLeft: () => movePending(entry, -1),
          onRight: () => movePending(entry, 1),
        })
      );
    });

    const count = total();
    hint.textContent = `${count} / ${limits.maxPhotosPerListing} photo${count > 1 ? "s" : ""}`;
    dropzone.classList.toggle("is-full", count >= limits.maxPhotosPerListing);
  }

  // -------------------------------------------------------------------------
  // Envoi
  // -------------------------------------------------------------------------

  /**
   * Envoie les fichiers en attente sur l'annonce `id`, un par un et dans
   * l'ordre affiché. Chaque fichier envoyé est retiré de la file : si l'envoi
   * s'arrête en cours de route, un nouvel essai ne renverra pas les photos
   * déjà en ligne.
   *
   * @param {number} id
   * @param {(done: number, totalCount: number) => void} [onProgress]
   */
  async function uploadPending(id, onProgress) {
    listingId = id;
    const queue = [...pending];

    for (const [index, entry] of queue.entries()) {
      onProgress?.(index, queue.length);

      const formData = new FormData();
      formData.append("photos", entry.file);
      const created = await api.upload(`/listings/${id}/photos`, formData);

      pending = pending.filter((p) => p !== entry);
      URL.revokeObjectURL(entry.url);
      // L'API renvoie un objet pour un fichier unique, { photos: [...] } sinon.
      existing.push(...(created.photos ?? [created]));
      render();
    }

    onProgress?.(queue.length, queue.length);
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  async function init({ listing } = {}) {
    const config = await getConfig();
    limits = {
      maxPhotosPerListing: config.maxPhotosPerListing ?? FALLBACK.maxPhotosPerListing,
      maxPhotoSizeBytes: config.maxPhotoSizeBytes ?? FALLBACK.maxPhotoSizeBytes,
      acceptedPhotoMimeTypes:
        config.acceptedPhotoMimeTypes ?? FALLBACK.acceptedPhotoMimeTypes,
    };

    // L'input reprend les types acceptés par l'API : le sélecteur de fichiers
    // du système grise directement ce que le serveur refuserait (un HEIC
    // d'iPhone, par exemple).
    input.accept = limits.acceptedPhotoMimeTypes.join(",");

    if (listing) {
      listingId = listing.id;
      existing = (listing.photos ?? []).map((p) => ({ id: p.id, url: p.url }));
    }

    // Clic : on relaie sur l'input caché. La zone est un <div> et non un
    // <label>, pour pouvoir aussi porter le dépôt de fichiers.
    dropzone.addEventListener("click", () => input.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });

    input.addEventListener("change", () => {
      addFiles(input.files);
      // On vide l'input : sans ça, re-choisir le même fichier après l'avoir
      // retiré ne déclencherait aucun événement "change".
      input.value = "";
    });

    // Glisser-déposer.
    for (const type of ["dragenter", "dragover"]) {
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragging");
      });
    }
    for (const type of ["dragleave", "drop"]) {
      dropzone.addEventListener(type, () => dropzone.classList.remove("is-dragging"));
    }
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      addFiles(e.dataTransfer?.files);
    });

    render();
  }

  return {
    init,
    uploadPending,
    addFiles,
    /** Fichiers en attente d'envoi (le premier sert à l'analyse IA). */
    pendingFiles: () => pending.map((p) => p.file),
    hasPending: () => pending.length > 0,
    photoCount: total,
  };
}
