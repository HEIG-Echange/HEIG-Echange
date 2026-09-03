import crypto from "crypto";
import multer from "multer";
import { UPLOAD_DIR } from "./config";

// Extensions autorisees, en miroir des types MIME acceptes ci-dessous.
const ALLOWED_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Nom aleatoire : evite toute collision et ne fait pas confiance au nom
    // fourni par le client (path traversal, caracteres exotiques).
    const ext = ALLOWED_EXT[file.mimetype] ?? ".bin";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

// Types MIME acceptes et taille maximale, publies tels quels par GET /config :
// le frontend refuse alors les fichiers hors limites au moment ou l'utilisateur
// les choisit, plutot que de laisser l'envoi echouer en 400 apres coup.
export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(ALLOWED_EXT);
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

// Upload d'une seule image, plafonnee a 5 Mo. Rejette tout ce qui n'est pas
// une image d'un format connu.
export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("format d'image non supporte (jpeg, png, webp ou gif)"));
    }
  },
});
