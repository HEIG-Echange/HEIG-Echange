import fs from "fs";
import path from "path";

// URL publique de l'application. Sert a construire TOUT lien destine a sortir
// de l'app : QR codes, liens d'images partagees, corps des emails, liens de
// partage d'annonce. En dev on retombe sur localhost, mais en staging/prod la
// variable d'environnement PUBLIC_BASE_URL doit pointer sur le vrai domaine
// (voir .env.example et compose.yaml) — sinon les liens partages renvoient
// vers la machine du visiteur.
// Le slash final est retire pour eviter les "//" en concatenant des chemins.
export const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

// Transforme un chemin interne ("/uploads/x.jpg", "listing.html?id=1") en URL
// absolue basee sur PUBLIC_BASE_URL. Une URL deja absolue est renvoyee telle
// quelle : les avatars/photos peuvent venir d'un stockage externe.
export function absoluteUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${PUBLIC_BASE_URL}/${String(pathOrUrl).replace(/^\/+/, "")}`;
}

// Dossier de stockage des images uploadees par les utilisateurs. En Docker,
// pointe vers un volume persistant (voir compose.yaml). Cree au demarrage si
// absent : multer n'ecrit pas dans un dossier inexistant.
export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
