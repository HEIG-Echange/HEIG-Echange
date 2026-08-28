import multer from "multer";
import { MIME_TO_EXT } from "./storage";

// Les fichiers transitent en memoire, pas par un fichier temporaire : ils sont
// ensuite pousses tels quels dans MinIO (voir src/storage.ts). Avec un plafond
// de 5 Mo par image et 10 images par annonce, une requete d'upload occupe au
// pire ~50 Mo — acceptable, et cela evite d'avoir a nettoyer des fichiers
// orphelins quand une requete echoue en cours de route.
const storage = multer.memoryStorage();

// Types MIME acceptes et taille maximale, publies tels quels par GET /config :
// le frontend refuse alors les fichiers hors limites au moment ou l'utilisateur
// les choisit, plutot que de laisser l'envoi echouer en 400 apres coup.
export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(MIME_TO_EXT);
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

// Upload d'une seule image, plafonnee a 5 Mo. Rejette tout ce qui n'est pas
// une image d'un format connu.
export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("format d'image non supporte (jpeg, png, webp ou gif)"));
    }
  },
});
