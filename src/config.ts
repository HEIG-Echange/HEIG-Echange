import fs from "fs";
import path from "path";

// URL publique de l'application, utilisee pour les QR codes (req: profil
// utilisateur) et les liens d'invitation. Configurable par variable
// d'environnement pour coller au domaine reel (staging / prod).
// Le slash final est retire pour eviter les "//" en concatenant des chemins.
export const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

// Dossier de stockage des images uploadees par les utilisateurs. En Docker,
// pointe vers un volume persistant (voir compose.yaml). Cree au demarrage si
// absent : multer n'ecrit pas dans un dossier inexistant.
export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
