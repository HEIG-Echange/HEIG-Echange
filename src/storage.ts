// ---------------------------------------------------------------------------
// Stockage des images d'annonces.
//
// Backend principal : MinIO (https://github.com/minio/minio), serveur de
// stockage objet compatible S3, lance a cote de l'app dans compose.yaml. Les
// fichiers ne vivent donc plus dans le conteneur applicatif : l'app redevient
// sans etat, plusieurs instances peuvent servir les memes photos, et la
// sauvegarde des images ne depend plus d'un volume Docker attache a un seul
// hote.
//
// Backend de repli : le disque local (UPLOAD_DIR), utilise automatiquement
// quand MINIO_ENDPOINT n'est pas defini. C'est ce qui permet a la suite de
// tests (et a un `npm start` sans Docker) de tourner sans MinIO.
//
// Dans les deux cas, une photo est designee par une CLE d'objet
// ("listings/2026/08/1712-ab12.jpg") et l'URL publique reste
// "/uploads/<cle>" : les lignes deja en base, les liens partages et le
// frontend ne changent pas. Les images ne sont jamais servies par MinIO
// directement — c'est l'app qui les relaie (voir src/routes/media.ts), donc
// le bucket reste prive et MinIO n'a pas besoin d'etre expose sur Internet.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import type { Client as MinioClient } from "minio";
import { UPLOAD_DIR } from "./config";

// Prefixe d'URL publique des images. Historique : c'etait le point de montage
// d'express.static. Conserve tel quel pour ne casser ni les URL deja stockees
// en base, ni les liens partages a l'exterieur.
export const PHOTO_URL_PREFIX = "/uploads/";

// Extensions/types MIME acceptes, source unique pour l'upload (src/upload.ts)
// et pour deviner le Content-Type d'un fichier relu depuis le disque.
export const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MINIO_ENDPOINT = (process.env.MINIO_ENDPOINT ?? "").trim();
const MINIO_PORT = Number(process.env.MINIO_PORT ?? 9000);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === "true";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "";
const MINIO_REGION = process.env.MINIO_REGION ?? "us-east-1";
export const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "heig-echange";

export type StorageBackend = "minio" | "local";

// MinIO des que son endpoint est renseigne. Les identifiants sont exiges avec :
// un endpoint sans clefs est une erreur de configuration, pas une invitation a
// retomber silencieusement sur le disque (les photos finiraient dans un
// conteneur ephemere sans que personne ne le remarque).
export const storageBackend: StorageBackend = MINIO_ENDPOINT ? "minio" : "local";

if (storageBackend === "minio" && (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY)) {
  throw new Error(
    "MINIO_ENDPOINT est defini mais MINIO_ACCESS_KEY / MINIO_SECRET_KEY manquent"
  );
}

let clientPromise: Promise<MinioClient> | null = null;

// Le SDK MinIO n'est charge qu'en mode "minio". C'est une dependance lourde :
// l'importer statiquement rallongerait le demarrage de tout le monde, y compris
// des tests et d'un lancement local sans stockage objet.
function minio(): Promise<MinioClient> {
  if (!clientPromise) {
    clientPromise = import("minio").then(
      ({ Client }) =>
        new Client({
          endPoint: MINIO_ENDPOINT,
          port: MINIO_PORT,
          useSSL: MINIO_USE_SSL,
          accessKey: MINIO_ACCESS_KEY,
          secretKey: MINIO_SECRET_KEY,
          region: MINIO_REGION,
        })
    );
  }
  return clientPromise;
}

export function storageDescription(): string {
  return storageBackend === "minio"
    ? `MinIO ${MINIO_ENDPOINT}:${MINIO_PORT}/${MINIO_BUCKET}`
    : `disque local ${UPLOAD_DIR}`;
}

// ---------------------------------------------------------------------------
// Clefs d'objet
// ---------------------------------------------------------------------------

// Une cle valide : segments alphanumeriques separes par "/", pas de ".." ni de
// segment vide. Tout le reste est refuse — c'est la seule barriere entre une
// URL fabriquee a la main et le systeme de fichiers (backend local) ou un
// objet arbitraire du bucket.
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function isValidKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 255 &&
    !key.includes("..") &&
    KEY_PATTERN.test(key)
  );
}

// Cle d'une nouvelle photo. Le rangement par annee/mois evite un prefixe unique
// contenant des dizaines de milliers d'objets, et le nom aleatoire garantit
// qu'aucun nom fourni par le client n'atteint le stockage.
export function buildObjectKey(mimetype: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = MIME_TO_EXT[mimetype] ?? ".bin";
  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  return `listings/${year}/${month}/${name}`;
}

// "/uploads/listings/2026/08/x.jpg" -> "listings/2026/08/x.jpg".
// Renvoie null pour une URL externe (avatar heberge ailleurs) ou trafiquee :
// l'appelant sait alors qu'il n'a rien a supprimer.
export function keyFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(PHOTO_URL_PREFIX)) return null;
  const key = url.slice(PHOTO_URL_PREFIX.length);
  return isValidKey(key) ? key : null;
}

export function urlFromKey(key: string): string {
  return `${PHOTO_URL_PREFIX}${key}`;
}

function contentTypeFromKey(key: string): string {
  return EXT_TO_MIME[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

// Chemin disque correspondant a une cle, pour le backend local. Verifie que le
// resultat reste sous UPLOAD_DIR meme si KEY_PATTERN laissait passer quelque
// chose (defense en profondeur).
function localPath(key: string): string | null {
  if (!isValidKey(key)) return null;
  const resolved = path.resolve(UPLOAD_DIR, ...key.split("/"));
  const root = path.resolve(UPLOAD_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

let bucketReady: Promise<void> | null = null;

async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const exists = await (await minio()).bucketExists(MINIO_BUCKET);
      if (!exists) await (await minio()).makeBucket(MINIO_BUCKET, MINIO_REGION);
    })().catch((err) => {
      // Un echec ne doit pas etre memoise : MinIO peut n'etre pas encore pret
      // au demarrage, le prochain upload retentera.
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

// Appelee au demarrage du serveur. Ne jette pas : si MinIO n'est pas encore
// joignable, l'app doit quand meme repondre (/health, pages, annonces) — seuls
// les uploads echoueront, et ils retenteront la creation du bucket.
export async function initStorage(): Promise<void> {
  if (storageBackend === "local") {
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    console.log(`Stockage images -> ${storageDescription()}`);
    return;
  }
  try {
    await ensureBucket();
    console.log(`Stockage images -> ${storageDescription()}`);
  } catch (err) {
    console.error(
      `Stockage images (${storageDescription()}) injoignable au demarrage :`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Ecriture / lecture / suppression
// ---------------------------------------------------------------------------

export async function saveObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (!isValidKey(key)) throw new Error("cle d'objet invalide");

  if (storageBackend === "local") {
    const target = localPath(key);
    if (!target) throw new Error("cle d'objet invalide");
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, body);
    return;
  }

  await ensureBucket();
  await (await minio()).putObject(MINIO_BUCKET, key, body, body.length, {
    "Content-Type": contentType,
  });
}

export interface StoredObject {
  stream: Readable;
  contentType: string;
  size: number | null;
  etag: string | null;
  lastModified: Date | null;
}

/**
 * Ouvre une image en lecture, ou null si elle n'existe pas.
 *
 * Avec MinIO, on retombe sur le disque local quand l'objet est absent : les
 * photos televersees avant la migration vivent encore dans le volume
 * "uploads-data", et elles doivent continuer a s'afficher sans script de
 * reprise. Une fois ce volume vide, ce repli ne sert plus a rien.
 */
export async function openObject(key: string): Promise<StoredObject | null> {
  if (!isValidKey(key)) return null;

  if (storageBackend === "minio") {
    try {
      const stat = await (await minio()).statObject(MINIO_BUCKET, key);
      const stream = await (await minio()).getObject(MINIO_BUCKET, key);
      return {
        stream,
        contentType:
          (stat.metaData?.["content-type"] as string | undefined) ??
          contentTypeFromKey(key),
        size: stat.size ?? null,
        etag: stat.etag ? `"${stat.etag.replace(/"/g, "")}"` : null,
        lastModified: stat.lastModified ?? null,
      };
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  return openLocal(key);
}

async function openLocal(key: string): Promise<StoredObject | null> {
  const target = localPath(key);
  if (!target) return null;
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return null;
    return {
      stream: fs.createReadStream(target),
      contentType: contentTypeFromKey(key),
      size: stat.size,
      etag: `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
      lastModified: stat.mtime,
    };
  } catch {
    return null;
  }
}

// Suppression best-effort : une photo deja absente du stockage ne doit pas
// faire echouer la suppression de sa ligne en base.
export async function deleteObject(key: string): Promise<void> {
  if (!isValidKey(key)) return;

  if (storageBackend === "minio") {
    try {
      await (await minio()).removeObject(MINIO_BUCKET, key);
    } catch (err) {
      if (!isNotFound(err)) {
        console.error(`Suppression de ${key} impossible :`, err);
      }
    }
  }

  // Aussi sur le disque : soit c'est le backend actif, soit c'est un reliquat
  // d'avant la migration (cf. openObject).
  const target = localPath(key);
  if (target) await fsp.rm(target, { force: true }).catch(() => {});
}

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "NotFound" || code === "NoSuchKey" || code === "ENOENT";
}
