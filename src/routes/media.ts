// ---------------------------------------------------------------------------
// Service des images d'annonces : GET /uploads/<cle>
//
// Remplace l'ancien express.static(UPLOAD_DIR). Les octets viennent maintenant
// du stockage objet (MinIO), relayes par l'app : le bucket reste prive, aucune
// URL signee n'a besoin d'etre generee, et les liens deja partages
// ("<PUBLIC_BASE_URL>/uploads/...") continuent de fonctionner a l'identique.
//
// Le cout de ce relais est un aller-retour de plus par image ; en echange, les
// droits d'acces et le domaine public restent entierement geres par l'app.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { openObject, keyFromUrl, PHOTO_URL_PREFIX } from "../storage";

export const mediaRouter = Router();

// Une image ne change jamais de contenu : sa cle est aleatoire et une
// modification passe par un nouvel upload. On peut donc la mettre en cache
// agressivement (un an, immutable).
const CACHE_CONTROL = "public, max-age=31536000, immutable";

mediaRouter.get(/^\/uploads\/(.+)$/, async (req, res, next) => {
  // On repasse par keyFromUrl pour que la validation de la cle (pas de "..",
  // charset restreint) soit exactement la meme qu'a l'ecriture.
  const key = keyFromUrl(`${PHOTO_URL_PREFIX}${req.params[0]}`);
  if (!key) {
    res.status(404).json({ error: "image introuvable" });
    return;
  }

  let object;
  try {
    object = await openObject(key);
  } catch (err) {
    next(err);
    return;
  }

  if (!object) {
    res.status(404).json({ error: "image introuvable" });
    return;
  }

  res.setHeader("Content-Type", object.contentType);
  res.setHeader("Cache-Control", CACHE_CONTROL);
  if (object.size !== null) res.setHeader("Content-Length", String(object.size));
  if (object.etag) res.setHeader("ETag", object.etag);
  if (object.lastModified) {
    res.setHeader("Last-Modified", object.lastModified.toUTCString());
  }

  // Revalidation conditionnelle : le navigateur qui a deja l'image renvoie son
  // ETag et repart avec un 304 sans retelecharger les octets.
  if (object.etag && req.headers["if-none-match"] === object.etag) {
    object.stream.destroy();
    res.status(304).end();
    return;
  }

  // Une coupure cote client (onglet ferme en plein chargement) ne doit pas
  // laisser le flux MinIO ouvert.
  res.on("close", () => object.stream.destroy());
  object.stream.on("error", (err) => {
    if (!res.headersSent) next(err);
    else res.destroy();
  });
  object.stream.pipe(res);
});
