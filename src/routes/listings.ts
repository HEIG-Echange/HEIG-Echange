import fs from "fs";
import path from "path";
import { Router } from "express";
import type { Request, Response } from "express";
import QRCode from "qrcode";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { uploadImage } from "../upload";
import { aiConfigured, analyzeItemPhoto } from "../ai";
import { sendEmail } from "../mail";
import { PUBLIC_BASE_URL, UPLOAD_DIR, absoluteUrl } from "../config";
import { activeAccountSql } from "../auth/emailVerification";

export const listingsRouter = Router();

const MIME_TO_MEDIA = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
} as const;

// Plafond de photos par annonce. Le carrousel reste lisible, et un utilisateur
// ne peut pas remplir le volume d'uploads a lui seul.
export const MAX_PHOTOS_PER_LISTING = 10;

// En miroir de l'ENUM item_condition dans db/init/01-schema.sql.
const ITEM_CONDITIONS = [
  "neuf",
  "tres_bon",
  "bon",
  "usage",
  "a_reparer",
] as const;
type ItemCondition = (typeof ITEM_CONDITIONS)[number];

// En miroir de l'ENUM status. "reserved" et "closed" sont pilotables par le
// proprietaire depuis l'edition de son annonce.
const LISTING_STATUSES = ["available", "reserved", "closed"] as const;
type ListingStatus = (typeof LISTING_STATUSES)[number];

function isItemCondition(value: unknown): value is ItemCondition {
  return (
    typeof value === "string" &&
    (ITEM_CONDITIONS as readonly string[]).includes(value)
  );
}

function isListingStatus(value: unknown): value is ListingStatus {
  return (
    typeof value === "string" &&
    (LISTING_STATUSES as readonly string[]).includes(value)
  );
}

interface ListingRow extends RowDataPacket {
  id: number;
  owner_id: number;
  owner_name: string | null;
  owner_email: string | null;
  category_id: number;
  category_slug: string | null;
  category_label: string | null;
  title: string;
  description: string;
  item_condition: ItemCondition;
  status: ListingStatus;
  location: string | null;
  is_priority: number;
  end_priority_at: string | null;
  photo_url: string | null;
  photo_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface PhotoRow extends RowDataPacket {
  id: number;
  url: string;
  position: number;
}

const DEFAULT_PRIORITY_DURATION_HOURS = 48;

// check si une annonce est retreinte au groupes de priorité
function isPriorityActive(listing: {
  is_priority: number;
  end_priority_at: string | null;
}): boolean {
  return (
    Boolean(listing.is_priority) &&
    listing.end_priority_at !== null &&
    new Date(listing.end_priority_at).getTime() > Date.now()
  );
}

// check si un utilisateur est admin
async function isAdminUser(userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  interface RoleRow extends RowDataPacket {
    role: "user" | "admin";
  }
  const [rows] = await pool.query<RoleRow[]>(
    "SELECT role FROM users WHERE id = ?",
    [userId]
  );
  return rows[0]?.role === "admin";
}

// check si un utilisateur peut voir un listing
async function canAccessListing(
  listing: { id: number; owner_id: number; is_priority: number; end_priority_at: string | null },
  userId: number | undefined
): Promise<boolean> {
  if (!isPriorityActive(listing)) return true;
  // si le listing est retreint au groupes de priorite, le utilisateur doit etre connectee
  if (!userId) return false;
  //les proprietaires et les admin peuvent voir les annonces restreintes
  if (listing.owner_id === userId) return true;
  if (await isAdminUser(userId)) return true;

  interface AccessRow extends RowDataPacket {
    one: number;
  }
  const [rows] = await pool.query<AccessRow[]>(
    `SELECT 1 AS one
     FROM priority_groups pg
     JOIN friends_group_members m ON m.friends_group_id = pg.friends_group_id
     WHERE pg.listing_id = ? AND m.user_id = ?
     LIMIT 1`,
    [listing.id, userId]
  );
  //si l'utilisateur est mebre d'au moins un des groupes de priorite
  return rows.length > 0;
}

// URL publique de la fiche annonce. Construite sur PUBLIC_BASE_URL et non sur
// l'hote de la requete : un lien partage par mail ou encode dans un QR code
// doit pointer sur le domaine reel, jamais sur le localhost du visiteur.
export function listingShareUrl(id: number): string {
  return `${PUBLIC_BASE_URL}/listing.html?id=${id}`;
}

// includeContact : n'expose le nom et l'email du proprietaire qu'aux visiteurs
// connectes. Un visiteur anonyme voit l'annonce mais aucune info de contact
// (req: laisser voir les annonces sans etre connecte, sans divulguer nom/email).
function toListingJson(row: ListingRow, includeContact: boolean) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: includeContact ? row.owner_name : null,
    ownerEmail: includeContact ? row.owner_email : null,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryLabel: row.category_label,
    title: row.title,
    description: row.description,
    itemCondition: row.item_condition,
    status: row.status,
    location: row.location,
    isPriority: isPriorityActive(row),
    endPriorityAt: row.end_priority_at,
    // Chemin relatif : c'est ce que consomme le frontend pour afficher.
    photoUrl: row.photo_url,
    // Meme image en absolu : pour un partage (mail, reseau social, QR) ou une
    // balise og:image, un chemin relatif ne veut rien dire hors du site.
    photoAbsoluteUrl: absoluteUrl(row.photo_url),
    photoCount: Number(row.photo_count ?? 0),
    shareUrl: listingShareUrl(row.id),
    qrUrl: `${PUBLIC_BASE_URL}/listings/${row.id}/qr`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

const LISTING_SELECT = `
  SELECT
    l.id, l.owner_id, u.display_name AS owner_name, u.email AS owner_email,
    l.category_id, c.slug AS category_slug, c.label AS category_label,
    l.title, l.description, l.item_condition, l.status, l.location,
    l.is_priority, l.end_priority_at,
    (SELECT p.url FROM listing_photos p
       WHERE p.listing_id = l.id ORDER BY p.position ASC LIMIT 1) AS photo_url,
    (SELECT COUNT(*) FROM listing_photos p
       WHERE p.listing_id = l.id) AS photo_count,
    l.created_at, l.updated_at, l.closed_at
  FROM listings l
  LEFT JOIN users u ON u.id = l.owner_id
  LEFT JOIN categories c ON c.id = l.category_id
`;

// valide et normalise les champs de priorite envoyes par le client 
interface PriorityInput {
  isPriority: boolean;
  endPriorityAt: Date | null;
  groupIds: number[];
}

async function parsePriorityInput(
  body: Record<string, unknown>,
  ownerId: number,
  res: import("express").Response
): Promise<PriorityInput | null | undefined> {
  const { isPriority, priorityGroupIds, priorityDurationHours } = body;

  if (isPriority === undefined) {
    return null;
  }

  if (!isPriority) {
    return { isPriority: false, endPriorityAt: null, groupIds: [] };
  }

  // if priority is true 
  //verifier que le utilisateur a choisit des groupes de priorite
  if (
    !Array.isArray(priorityGroupIds) ||
    priorityGroupIds.length === 0 
  ) {
    res.status(400).json({
      error: "priorityGroupIds est requis quand isPriority est actif",
    });
    return undefined;
  }

  //verifier la duree 
  if (
    priorityDurationHours !== undefined &&
    (typeof priorityDurationHours !== "number" )
  ) {
    res.status(400).json({ error: "priorityDurationHours doit etre un nombre positif" });
    return undefined;
  }

  // Le frontend ne propose que les groupes de l'utilisateur connecte, donc
  // on verifie seulement que les groupes existent (et ne sont pas supprimes).
  interface GroupIdRow extends RowDataPacket {
    id: number;
  }
  const placeholders = priorityGroupIds.map(() => "?").join(",");
  const [existingGroups] = await pool.query<GroupIdRow[]>(
    `SELECT id FROM friends_groups WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    priorityGroupIds
  );
  if (existingGroups.length !== new Set(priorityGroupIds).size) {
    res.status(400).json({
      error: "priorityGroupIds invalide : un ou plusieurs groupes sont introuvables",
    });
    return undefined;
  }

  const hours = priorityDurationHours ?? DEFAULT_PRIORITY_DURATION_HOURS;
  return {
    isPriority: true,
    endPriorityAt: new Date(Date.now() + hours * 3600_000),
    groupIds: [...new Set(priorityGroupIds)],
  };
}

async function replacePriorityGroups(listingId: number, groupIds: number[]): Promise<void> {
  await pool.query("DELETE FROM priority_groups WHERE listing_id = ?", [listingId]);
  if (groupIds.length === 0) return;
  const values = groupIds.map(() => "(?, ?)").join(", ");
  const params = groupIds.flatMap((groupId) => [listingId, groupId]);
  await pool.query(
    `INSERT INTO priority_groups (listing_id, friends_group_id) VALUES ${values}`,
    params
  );
}

// Une annonce n'est visible publiquement que si son proprietaire est un compte
// actif : ni supprime, ni bloque, ni suspendu faute d'avoir reconfirme son
// adresse email dans les 6 mois. Les annonces ne sont pas supprimees pour
// autant — elles reapparaissent des que le compte est reactive.
const VISIBLE_OWNER = activeAccountSql("u");

// POST /listings — cree une annonce , faut etre connecte
listingsRouter.post("/", requireAuth, async (req, res) => {
  const { categoryId, title, description, itemCondition, location } =
    req.body ?? {};

  if (
    typeof categoryId !== "number" ||
    !Number.isInteger(categoryId) ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof description !== "string" ||
    !description.trim() ||
    !isItemCondition(itemCondition)
  ) {
    res.status(400).json({
      error: `categoryId (nombre), title, description et itemCondition (${ITEM_CONDITIONS.join(", ")}) sont requis`,
    });
    return;
  }

  // location : champ libre optionnel (req: le lieu doit etre libre a la creation).
  if (location !== undefined && location !== null && typeof location !== "string") {
    res.status(400).json({ error: "location doit etre une chaine" });
    return;
  }
  const locationValue =
    typeof location === "string" && location.trim() ? location.trim() : null;

  const priority = await parsePriorityInput(
    req.body ?? {},
    req.session.userId as number,
    res
  );
  if (priority === undefined) return; // reponse d'erreur deja envoyee

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO listings
         (owner_id, category_id, title, description, item_condition, location, is_priority, end_priority_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.session.userId,
        categoryId,
        title,
        description,
        itemCondition,
        locationValue,
        priority?.isPriority ? 1 : 0,
        priority?.endPriorityAt ?? null,
      ]
    );

    if (priority?.isPriority) {
      await replacePriorityGroups(result.insertId, priority.groupIds);
    }

    res.status(201).json({
      id: result.insertId,
      ownerId: req.session.userId,
      categoryId,
      title,
      description,
      itemCondition,
      location: locationValue,
      status: "available",
      isPriority: priority?.isPriority ?? false,
      endPriorityAt: priority?.endPriorityAt ?? null,
      ...(priority?.isPriority ? { priorityGroupIds: priority.groupIds } : {}),
      photoCount: 0,
      shareUrl: listingShareUrl(result.insertId),
      qrUrl: `${PUBLIC_BASE_URL}/listings/${result.insertId}/qr`,
    });
  } catch (err) {
    // FK invalide (categoryId inexistant) -> erreur utilisateur, pas un 500.
    if ((err as { code?: string }).code === "ER_NO_REFERENCED_ROW_2") {
      res.status(400).json({ error: "categoryId invalide" });
      return;
    }
    throw err;
  }
});

/**
 * Verifie que l'appelant peut modifier l'annonce `id` : proprietaire, ou admin.
 * Repond lui-meme (404 / 403) et renvoie null si l'acces est refuse — l'appelant
 * n'a plus qu'a `return`.
 */
async function loadEditableListing(
  listingId: number,
  userId: number | undefined,
  res: Response,
  actionLabel: string
): Promise<{ ownerId: number; isAdmin: boolean } | null> {
  interface OwnerRow extends RowDataPacket {
    owner_id: number;
  }
  const [rows] = await pool.query<OwnerRow[]>(
    "SELECT owner_id FROM listings WHERE id = ? AND deleted_at IS NULL",
    [listingId]
  );
  const listing = rows[0];

  if (!listing) {
    res.status(404).json({ error: "annonce introuvable" });
    return null;
  }

  if (listing.owner_id === userId) {
    return { ownerId: listing.owner_id, isAdmin: false };
  }

  interface RoleRow extends RowDataPacket {
    role: "user" | "admin";
  }
  const [userRows] = await pool.query<RoleRow[]>(
    "SELECT role FROM users WHERE id = ?",
    [userId]
  );

  if (userRows[0]?.role !== "admin") {
    res.status(403).json({ error: `seul le proprietaire peut ${actionLabel}` });
    return null;
  }

  return { ownerId: listing.owner_id, isAdmin: true };
}

// PATCH /listings/:id — modifie une annonce existante, mise a jour partielle ,
// reserve au proprietaire ou a un admin. C'est ce qui permet a un.e etudiant.e
// de corriger ou de faire evoluer son annonce apres publication (changer le
// titre, la categorie, le lieu, ou la passer en "reservee" / "donnee").
listingsRouter.patch("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const access = await loadEditableListing(
    id,
    req.session.userId,
    res,
    "modifier cette annonce"
  );
  if (!access) return;

  const { categoryId, title, description, itemCondition, location, status } =
    req.body ?? {};
  const sets: string[] = [];
  const params: (string | number | null | Date)[] = [];

  if (categoryId !== undefined) {
    if (typeof categoryId !== "number" || !Number.isInteger(categoryId)) {
      res.status(400).json({ error: "categoryId doit etre un nombre" });
      return;
    }
    sets.push("category_id = ?");
    params.push(categoryId);
  }

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title ne peut pas etre vide" });
      return;
    }
    sets.push("title = ?");
    params.push(title);
  }

  if (description !== undefined) {
    if (typeof description !== "string" || !description.trim()) {
      res.status(400).json({ error: "description ne peut pas etre vide" });
      return;
    }
    sets.push("description = ?");
    params.push(description);
  }

  if (itemCondition !== undefined) {
    if (!isItemCondition(itemCondition)) {
      res.status(400).json({
        error: `itemCondition doit etre l'un de : ${ITEM_CONDITIONS.join(", ")}`,
      });
      return;
    }
    sets.push("item_condition = ?");
    params.push(itemCondition);
  }

  if (location !== undefined) {
    if (location !== null && typeof location !== "string") {
      res.status(400).json({ error: "location doit etre une chaine ou null" });
      return;
    }
    sets.push("location = ?");
    params.push(
      typeof location === "string" && location.trim() ? location.trim() : null
    );
  }

  // La restriction se modifie toujours en bloc (isPriority + groupIds) pour
  // rester coherente : cf. parsePriorityInput. owner_id ici est celui de
  // l'annonce (le proprietaire choisit parmi SES groupes), pas forcement
  // req.session.userId si c'est un admin qui modifie.
  const priority = await parsePriorityInput(req.body ?? {}, access.ownerId, res);
  if (priority === undefined) return; // reponse d'erreur deja envoyee
  if (priority !== null) {
    sets.push("is_priority = ?", "end_priority_at = ?");
    params.push(priority.isPriority ? 1 : 0, priority.endPriorityAt);
  }

  if (status !== undefined) {
    if (!isListingStatus(status)) {
      res.status(400).json({
        error: `status doit etre l'un de : ${LISTING_STATUSES.join(", ")}`,
      });
      return;
    }
    sets.push("status = ?");
    params.push(status);
    // closed_at suit le statut : renseigne a la cloture, efface si l'annonce
    // est remise en ligne (l'objet n'a finalement pas ete donne).
    sets.push(
      status === "closed"
        ? "closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)"
        : "closed_at = NULL"
    );
  }

  if (sets.length === 0) {
    res.status(400).json({ error: "aucun champ a modifier" });
    return;
  }

  try {
    params.push(id);
    await pool.query(`UPDATE listings SET ${sets.join(", ")} WHERE id = ?`, params);
  } catch (err) {
    if ((err as { code?: string }).code === "ER_NO_REFERENCED_ROW_2") {
      res.status(400).json({ error: "categoryId invalide" });
      return;
    }
    throw err;
  }

  if (priority !== null) {
    await replacePriorityGroups(id, priority.groupIds);
  }

  const [updatedRows] = await pool.query<ListingRow[]>(
    `${LISTING_SELECT} WHERE l.id = ?`,
    [id]
  );

  // Reponse a un proprietaire/admin connecte : contact inclus.
  res.json(toListingJson(updatedRows[0], true));
});

// GET /listings — grille des annonces disponibles avec filtres
// optionnels pour la recherche et les onglets de categorie  et pour "mes objets" sur le profil (ownerId).
listingsRouter.get("/", async (req, res) => {
  const { categoryId, ownerId, q } = req.query;

  const where = ["l.deleted_at IS NULL", VISIBLE_OWNER];
  const params: (string | number)[] = [];

  if (typeof categoryId === "string" && categoryId.trim()) {
    const id = Number(categoryId);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "categoryId invalide" });
      return;
    }
    where.push("l.category_id = ?");
    params.push(id);
  }

  if (typeof ownerId === "string" && ownerId.trim()) {
    const id = Number(ownerId);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "ownerId invalide" });
      return;
    }
    where.push("l.owner_id = ?");
    params.push(id);
  }

  if (typeof q === "string" && q.trim()) {
    where.push("MATCH(l.title, l.description) AGAINST (? IN NATURAL LANGUAGE MODE)");
    params.push(q.trim());
  }

  // Annonces restreintes (is_priority + end_priority_at futur) : masquees de
  // la grille sauf pour le proprietaire, un admin, ou un membre d'un des
  // groupes autorises. 0 en repli pour un visiteur anonyme : ne correspond a
  // aucun id reel, donc les clauses OR ci-dessous ne le concernent jamais.
  const viewerId = req.session.userId;
  if (!(await isAdminUser(viewerId))) {
    where.push(`(
      NOT (l.is_priority = 1 AND l.end_priority_at IS NOT NULL AND l.end_priority_at > NOW())
      OR l.owner_id = ?
      OR EXISTS (
        SELECT 1 FROM priority_groups pg
        JOIN friends_group_members m ON m.friends_group_id = pg.friends_group_id
        WHERE pg.listing_id = l.id AND m.user_id = ?
      )
    )`);
    params.push(viewerId ?? 0, viewerId ?? 0);
  }

  const [rows] = await pool.query<ListingRow[]>(
    `${LISTING_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC`,
    params
  );

  const includeContact = Boolean(req.session.userId);
  res.json(rows.map((row) => toListingJson(row, includeContact)));
});

// GET /listings/interested — ids des annonces (encore actives)  sur lesquelles l'utilisateur connecte a manifeste son interet
listingsRouter.get("/interested", requireAuth, async (req, res) => {
  interface InterestedRow extends RowDataPacket {
    listing_id: number;
  }
  const [rows] = await pool.query<InterestedRow[]>(
    `SELECT li.listing_id
     FROM listing_interests li
     JOIN listings l ON l.id = li.listing_id AND l.deleted_at IS NULL
     WHERE li.user_id = ?
     ORDER BY li.created_at DESC`,
    [req.session.userId]
  );

  res.json(rows.map((row) => row.listing_id));
});

// GET /listings/:id — fiche detail d'une annonce
listingsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const [rows] = await pool.query<ListingRow[]>(
    `${LISTING_SELECT} WHERE l.id = ? AND l.deleted_at IS NULL AND ${VISIBLE_OWNER}`,
    [id]
  );

  const listing = rows[0];

  if (!listing || !(await canAccessListing(listing, req.session.userId))) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  const [photos] = await pool.query<PhotoRow[]>(
    "SELECT id, url, position FROM listing_photos WHERE listing_id = ? ORDER BY position ASC",
    [id]
  );

  const includeContact = Boolean(req.session.userId);

  let priorityGroupIds: number[] | undefined;
  if (req.session.userId === listing.owner_id) {
    interface GroupIdRow extends RowDataPacket {
      friends_group_id: number;
    }
    const [groupRows] = await pool.query<GroupIdRow[]>(
      "SELECT friends_group_id FROM priority_groups WHERE listing_id = ?",
      [id]
    );
    priorityGroupIds = groupRows.map((r) => r.friends_group_id);
  }

  res.json({
    ...toListingJson(listing, includeContact),
    photos: photos.map((p) => ({
      id: p.id,
      url: p.url,
      // Version partageable de la meme image (voir photoAbsoluteUrl).
      absoluteUrl: absoluteUrl(p.url),
      position: p.position,
    })),
    ...(priorityGroupIds ? { priorityGroupIds } : {}),
  });
});

interface PriorityCheckRow extends RowDataPacket {
  id: number;
  owner_id: number;
  is_priority: number;
  end_priority_at: string | null;
}

// Charge l'annonce (non supprimee) et verifie l'acces (restriction de
// priorite). Ecrit une reponse 404 et renvoie null si l'annonce n'existe pas
// OU si elle est restreinte et inaccessible a l'appelant — meme reponse dans
// les deux cas, pour ne pas reveler l'existence d'une annonce restreinte.
async function loadAccessibleListing(
  id: number,
  userId: number | undefined,
  res: import("express").Response
): Promise<PriorityCheckRow | null> {
  const [rows] = await pool.query<PriorityCheckRow[]>(
    "SELECT id, owner_id, is_priority, end_priority_at FROM listings WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  const listing = rows[0];

  if (!listing || !(await canAccessListing(listing, userId))) {
    res.status(404).json({ error: "annonce introuvable" });
    return null;
  }

  return listing;
}

// GET /listings/:id/qr — QR code (SVG) pointant vers la fiche de l'annonce.
// Le domaine encode provient de PUBLIC_BASE_URL : scanner le code depuis un
// telephone doit ouvrir le site public, pas l'adresse locale du serveur.
listingsRouter.get("/:id/qr", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  interface ExistsRow extends RowDataPacket {
    id: number;
  }
  const [rows] = await pool.query<ExistsRow[]>(
    `SELECT l.id FROM listings l
       LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.id = ? AND l.deleted_at IS NULL AND ${VISIBLE_OWNER}`,
    [id]
  );

  if (!rows[0]) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  const svg = await QRCode.toString(listingShareUrl(id), {
    type: "svg",
    margin: 1,
    color: { dark: "#1a1816", light: "#ffffff" },
  });

  res.type("image/svg+xml");
  // Cache court : le contenu est stable pour un id donne.
  res.set("Cache-Control", "public, max-age=3600");
  res.send(svg);
});

// GET /listings/:id/interest — voir les personne interesse par une anonce
listingsRouter.get("/:id/interest", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const listing = await loadAccessibleListing(id, req.session.userId, res);
  if (!listing) return;

  interface InterestRow extends RowDataPacket {
    id: number;
  }
  const [rows] = await pool.query<InterestRow[]>(
    "SELECT id FROM listing_interests WHERE listing_id = ? AND user_id = ?",
    [id, req.session.userId]
  );

  res.json({ interested: rows.length > 0 });
});

// Notifie le proprietaire par email quand quelqu'un manifeste son interet.
// N'echoue jamais l'appelant : une erreur d'envoi est juste loggee.
async function sendInterestNotification(
  ownerEmail: string,
  ownerName: string,
  interestedEmail: string,
  interestedName: string,
  listingTitle: string
): Promise<void> {
  try {
    await sendEmail({
      to: ownerEmail,
      subject: `${interestedName} est interesse par "${listingTitle}"`,
      body: `Bonjour ${ownerName},\n\n${interestedName} (${interestedEmail}) est interesse par votre annonce "${listingTitle}".\n\nContacte cette personne via Teams pour organiser la remise.`,
    });
  } catch (err) {
    console.error(`Echec envoi email de notification d'interet a ${ownerEmail}`, err);
  }
}

// POST /listings/:id/interest — un utilisateur connecte veut marquer son interet pr une annonce
listingsRouter.post("/:id/interest", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const listing = await loadAccessibleListing(id, req.session.userId, res);
  if (!listing) return;

  if (listing.owner_id === req.session.userId) {
    res.status(400).json({
      error: "impossible de manifester de l'interet pour sa propre annonce",
    });
    return;
  }

  try {
    await pool.query(
      "INSERT INTO listing_interests (listing_id, user_id) VALUES (?, ?)",
      [id, req.session.userId]
    );

    interface NotifyRow extends RowDataPacket {
      listing_title: string;
      owner_email: string;
      owner_name: string;
      interested_email: string;
      interested_name: string;
    }
    const [notifyRows] = await pool.query<NotifyRow[]>(
      `SELECT l.title AS listing_title,
              o.email AS owner_email, o.display_name AS owner_name,
              i.email AS interested_email, i.display_name AS interested_name
       FROM listings l
       JOIN users o ON o.id = l.owner_id
       JOIN users i ON i.id = ?
       WHERE l.id = ?`,
      [req.session.userId, id]
    );
    const notify = notifyRows[0];
    if (notify) {
      await sendInterestNotification(
        notify.owner_email,
        notify.owner_name,
        notify.interested_email,
        notify.interested_name,
        notify.listing_title
      );
    }

    res.status(201).json({ interested: true });
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      // Deja enregistre : on ne renvoie pas d'erreur pour un clic repete, et
      // on ne renvoie pas de nouvelle notification (deja envoyee la premiere
      // fois).
      res.status(200).json({ interested: true });
      return;
    }
    throw err;
  }
});

// DELETE /listings/:id/interest — un utilisateur connecte n'est plus interesse par une annonce
listingsRouter.delete("/:id/interest", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const listing = await loadAccessibleListing(id, req.session.userId, res);
  if (!listing) return;

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM listing_interests WHERE listing_id = ? AND user_id = ?",
    [id, req.session.userId]
  );

  if (result.affectedRows === 0) {
    res.status(404).json({ error: "aucun interet enregistre pour cette annonce" });
    return;
  }

  res.status(204).send();
});

// DELETE /listings/:id — le proprietaire ferme/retire son annonce soft delete (deleted_at) : l'historique reste disponible pour la moderation
listingsRouter.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const access = await loadEditableListing(
    id,
    req.session.userId,
    res,
    "retirer cette annonce"
  );
  if (!access) return;

  let reason: string | undefined;

  if (access.isAdmin) {
    const bodyReason = (req.body ?? {}).reason;
    if (typeof bodyReason !== "string" || !bodyReason.trim()) {
      res.status(400).json({ error: "reason est requis pour une suppression par un admin" });
      return;
    }
    reason = bodyReason;
  }

  await pool.query(
    "UPDATE listings SET deleted_at = CURRENT_TIMESTAMP, status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?",
    [id]
  );

  if (access.isAdmin) {
    await pool.query(
      "INSERT INTO moderation_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'delete_listing', 'listing', ?, ?)",
      [req.session.userId, id, JSON.stringify({ reason })]
    );
  }

  res.status(204).send();
});

// Accepte indifferemment un champ "photo" (une image, compatibilite avec les
// clients existants) et un champ "photos" (plusieurs images d'un coup, ce
// qu'envoie le formulaire web).
const acceptPhotos = uploadImage.fields([
  { name: "photo", maxCount: MAX_PHOTOS_PER_LISTING },
  { name: "photos", maxCount: MAX_PHOTOS_PER_LISTING },
]);

function collectUploadedFiles(req: Request) {
  const files = req.files as
    | Record<string, Express.Multer.File[]>
    | undefined;
  if (!files) return [];
  return [...(files.photo ?? []), ...(files.photos ?? [])];
}

function discardFiles(files: Express.Multer.File[]) {
  for (const file of files) {
    fs.unlink(file.path, () => {});
  }
}

// POST /listings/:id/photos — ajoute une ou plusieurs photos (multipart, champ
// "photo" ou "photos") a une annonce existante. Reserve au proprietaire (ou
// admin). Les fichiers sont stockes sur disque (voir UPLOAD_DIR) et servis via
// /uploads. Les positions se suivent : la photo en position 0 sert de vignette.
listingsRouter.post(
  "/:id/photos",
  requireAuth,
  acceptPhotos,
  async (req, res) => {
    const id = Number(req.params.id);
    const uploaded = collectUploadedFiles(req);

    if (!Number.isInteger(id)) {
      discardFiles(uploaded);
      res.status(400).json({ error: "id invalide" });
      return;
    }
    if (uploaded.length === 0) {
      res.status(400).json({ error: "photo (fichier image) est requis" });
      return;
    }

    const access = await loadEditableListing(
      id,
      req.session.userId,
      res,
      "ajouter une photo"
    );
    if (!access) {
      discardFiles(uploaded);
      return;
    }

    // Position = a la suite des photos existantes.
    interface CountRow extends RowDataPacket {
      total: number;
      next_position: number;
    }
    const [countRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total, COALESCE(MAX(position) + 1, 0) AS next_position
         FROM listing_photos WHERE listing_id = ?`,
      [id]
    );
    const existing = Number(countRows[0]?.total ?? 0);
    let position = Number(countRows[0]?.next_position ?? 0);

    if (existing + uploaded.length > MAX_PHOTOS_PER_LISTING) {
      discardFiles(uploaded);
      res.status(400).json({
        error: `une annonce ne peut pas depasser ${MAX_PHOTOS_PER_LISTING} photos (${existing} deja presente(s))`,
      });
      return;
    }

    const created = [];
    for (const file of uploaded) {
      const url = `/uploads/${file.filename}`;
      const [result] = await pool.query<ResultSetHeader>(
        "INSERT INTO listing_photos (listing_id, url, position) VALUES (?, ?, ?)",
        [id, url, position]
      );
      created.push({
        id: result.insertId,
        url,
        absoluteUrl: absoluteUrl(url),
        position,
      });
      position += 1;
    }

    // Un seul fichier envoye : on garde la forme de reponse historique (objet),
    // pour ne casser aucun client existant. Sinon, la liste des photos creees.
    res.status(201).json(created.length === 1 ? created[0] : { photos: created });
  }
);

// DELETE /listings/:id/photos/:photoId — retire une photo d'une annonce.
// Necessaire pour pouvoir corriger une annonce apres publication. Le fichier
// est efface du disque et les positions restantes sont retassees pour rester
// contigues (la premiere reste la vignette).
listingsRouter.delete("/:id/photos/:photoId", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const photoId = Number(req.params.photoId);

  if (!Number.isInteger(id) || !Number.isInteger(photoId)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const access = await loadEditableListing(
    id,
    req.session.userId,
    res,
    "supprimer une photo"
  );
  if (!access) return;

  const [rows] = await pool.query<PhotoRow[]>(
    "SELECT id, url, position FROM listing_photos WHERE id = ? AND listing_id = ?",
    [photoId, id]
  );
  const photo = rows[0];

  if (!photo) {
    res.status(404).json({ error: "photo introuvable" });
    return;
  }

  await pool.query("DELETE FROM listing_photos WHERE id = ?", [photoId]);
  await pool.query(
    "UPDATE listing_photos SET position = position - 1 WHERE listing_id = ? AND position > ?",
    [id, photo.position]
  );

  // Le fichier n'est efface que s'il vit bien dans UPLOAD_DIR : une url
  // externe (ou trafiquee) ne doit pas pouvoir faire supprimer un fichier
  // arbitraire du serveur.
  const filename = path.basename(photo.url);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (photo.url.startsWith("/uploads/") && path.dirname(filePath) === path.resolve(UPLOAD_DIR)) {
    fs.unlink(filePath, () => {});
  }

  res.status(204).send();
});

// PATCH /listings/:id/photos — reordonne le carrousel. Body : { photoIds: [...] }
// dans l'ordre souhaite. Permet notamment de choisir la vignette (premiere
// photo) sans avoir a tout re-televerser.
listingsRouter.patch("/:id/photos", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const { photoIds } = req.body ?? {};
  if (
    !Array.isArray(photoIds) ||
    photoIds.length === 0 ||
    !photoIds.every((value) => Number.isInteger(value))
  ) {
    res.status(400).json({ error: "photoIds doit etre un tableau d'identifiants" });
    return;
  }

  const access = await loadEditableListing(
    id,
    req.session.userId,
    res,
    "reordonner les photos"
  );
  if (!access) return;

  const [rows] = await pool.query<PhotoRow[]>(
    "SELECT id, url, position FROM listing_photos WHERE listing_id = ?",
    [id]
  );

  const known = new Set(rows.map((row) => row.id));
  const unique = new Set(photoIds);

  // On exige la liste complete : un ordre partiel laisserait des positions
  // ambigues entre les photos citees et les autres.
  if (unique.size !== photoIds.length || unique.size !== known.size ||
      !photoIds.every((photoId: number) => known.has(photoId))) {
    res.status(400).json({
      error: "photoIds doit contenir exactement une fois chaque photo de l'annonce",
    });
    return;
  }

  for (const [index, photoId] of photoIds.entries()) {
    await pool.query(
      "UPDATE listing_photos SET position = ? WHERE id = ? AND listing_id = ?",
      [index, photoId, id]
    );
  }

  const [updated] = await pool.query<PhotoRow[]>(
    "SELECT id, url, position FROM listing_photos WHERE listing_id = ? ORDER BY position ASC",
    [id]
  );

  res.json({
    photos: updated.map((p) => ({
      id: p.id,
      url: p.url,
      absoluteUrl: absoluteUrl(p.url),
      position: p.position,
    })),
  });
});

// POST /listings/ai/analyze — envoie une photo (multipart, champ "photo") a une
// IA et renvoie une categorie, un etat et une description proposes, pour
// pre-remplir le formulaire. Ne cree aucune annonce. Reserve aux connectes.
listingsRouter.post(
  "/ai/analyze",
  requireAuth,
  uploadImage.single("photo"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "photo (fichier image) est requis" });
      return;
    }

    const filePath = req.file.path;
    const mediaType =
      MIME_TO_MEDIA[req.file.mimetype as keyof typeof MIME_TO_MEDIA];

    try {
      if (!aiConfigured()) {
        res
          .status(503)
          .json({ error: "analyse IA indisponible (ANTHROPIC_API_KEY non configuree)" });
        return;
      }
      if (!mediaType) {
        res.status(400).json({ error: "format d'image non supporte" });
        return;
      }

      interface CategoryRow extends RowDataPacket {
        id: number;
        slug: string;
        label: string;
      }
      const [categories] = await pool.query<CategoryRow[]>(
        "SELECT id, slug, label FROM categories ORDER BY label ASC"
      );

      const base64 = fs.readFileSync(filePath).toString("base64");
      const analysis = await analyzeItemPhoto(base64, mediaType, categories);

      const categoryId =
        categories.find((c) => c.slug === analysis.categorySlug)?.id ?? null;

      res.json({
        categorySlug: analysis.categorySlug,
        categoryId,
        itemCondition: analysis.itemCondition,
        description: analysis.description,
      });
    } catch (err) {
      console.error("analyse IA echouee:", err);
      res.status(502).json({ error: "l'analyse IA a echoue" });
    } finally {
      // Photo d'analyse : temporaire, jamais rattachee a une annonce.
      fs.unlink(filePath, () => {});
    }
  }
);
