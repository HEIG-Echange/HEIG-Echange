import fs from "fs";
import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { uploadImage } from "../upload";
import { aiConfigured, analyzeItemPhoto } from "../ai";
import { sendEmail } from "../mail";

export const listingsRouter = Router();

const MIME_TO_MEDIA = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
} as const;

// En miroir de l'ENUM item_condition dans db/init/01-schema.sql.
const ITEM_CONDITIONS = [
  "neuf",
  "tres_bon",
  "bon",
  "usage",
  "a_reparer",
] as const;
type ItemCondition = (typeof ITEM_CONDITIONS)[number];

function isItemCondition(value: unknown): value is ItemCondition {
  return (
    typeof value === "string" &&
    (ITEM_CONDITIONS as readonly string[]).includes(value)
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
  status: "available" | "reserved" | "closed";
  location: string | null;
  is_priority: number;
  end_priority_at: string | null;
  photo_url: string | null;
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
    photoUrl: row.photo_url,
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

// PATCH /listings/:id — modifie une annonce existante, mise a jour partielle , reservé aux proprietaire ou un admin.
listingsRouter.patch("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  interface OwnerRow extends RowDataPacket {
    owner_id: number;
  }
  const [rows] = await pool.query<OwnerRow[]>(
    "SELECT owner_id FROM listings WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  const listing = rows[0];

  if (!listing) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  if (listing.owner_id !== req.session.userId) {
    interface RoleRow extends RowDataPacket {
      role: "user" | "admin";
    }
    const [userRows] = await pool.query<RoleRow[]>(
      "SELECT role FROM users WHERE id = ?",
      [req.session.userId]
    );
    if (userRows[0]?.role !== "admin") {
      res.status(403).json({ error: "seul le proprietaire peut modifier cette annonce" });
      return;
    }
  }

  const { categoryId, title, description, itemCondition, location } =
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
  const priority = await parsePriorityInput(req.body ?? {}, listing.owner_id, res);
  if (priority === undefined) return; // reponse d'erreur deja envoyee
  if (priority !== null) {
    sets.push("is_priority = ?", "end_priority_at = ?");
    params.push(priority.isPriority ? 1 : 0, priority.endPriorityAt);
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

  const where = ["l.deleted_at IS NULL"];
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
    `${LISTING_SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`,
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
    photos: photos.map((p) => ({ id: p.id, url: p.url, position: p.position })),
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

  interface OwnerRow extends RowDataPacket {
    owner_id: number;
  }
  const [rows] = await pool.query<OwnerRow[]>(
    "SELECT owner_id FROM listings WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  const listing = rows[0];

  if (!listing) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  let deletedByAdmin = false;
  let reason: string | undefined;

  if (listing.owner_id !== req.session.userId) {
    interface RoleRow extends RowDataPacket {
      role: "user" | "admin";
    }
    const [userRows] = await pool.query<RoleRow[]>(
      "SELECT role FROM users WHERE id = ?",
      [req.session.userId]
    );
    if (userRows[0]?.role !== "admin") {
      res.status(403).json({ error: "seul le proprietaire peut retirer cette annonce" });
      return;
    }
    deletedByAdmin = true;

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

  if (deletedByAdmin) {
    await pool.query(
      "INSERT INTO moderation_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'delete_listing', 'listing', ?, ?)",
      [req.session.userId, id, JSON.stringify({ reason })]
    );
  }

  res.status(204).send();
});

// POST /listings/:id/photos — ajoute une photo (multipart, champ "photo") a une
// annonce existante. Reserve au proprietaire (ou admin). Le fichier est stocke
// sur disque (voir UPLOAD_DIR) et servi via /uploads.
listingsRouter.post(
  "/:id/photos",
  requireAuth,
  uploadImage.single("photo"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "id invalide" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "photo (fichier image) est requis" });
      return;
    }

    interface OwnerRow extends RowDataPacket {
      owner_id: number;
    }
    const [rows] = await pool.query<OwnerRow[]>(
      "SELECT owner_id FROM listings WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    const listing = rows[0];

    if (!listing) {
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: "annonce introuvable" });
      return;
    }

    if (listing.owner_id !== req.session.userId) {
      interface RoleRow extends RowDataPacket {
        role: "user" | "admin";
      }
      const [userRows] = await pool.query<RoleRow[]>(
        "SELECT role FROM users WHERE id = ?",
        [req.session.userId]
      );
      if (userRows[0]?.role !== "admin") {
        fs.unlink(req.file.path, () => {});
        res.status(403).json({ error: "seul le proprietaire peut ajouter une photo" });
        return;
      }
    }

    // Position = a la suite des photos existantes.
    interface MaxRow extends RowDataPacket {
      next_position: number;
    }
    const [maxRows] = await pool.query<MaxRow[]>(
      "SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM listing_photos WHERE listing_id = ?",
      [id]
    );
    const position = Number(maxRows[0]?.next_position ?? 0);

    const url = `/uploads/${req.file.filename}`;
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO listing_photos (listing_id, url, position) VALUES (?, ?, ?)",
      [id, url, position]
    );

    res.status(201).json({ id: result.insertId, url, position });
  }
);

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
