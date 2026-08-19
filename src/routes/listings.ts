import fs from "fs";
import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { uploadImage } from "../upload";
import { aiConfigured, analyzeItemPhoto } from "../ai";

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
    (SELECT p.url FROM listing_photos p
       WHERE p.listing_id = l.id ORDER BY p.position ASC LIMIT 1) AS photo_url,
    l.created_at, l.updated_at, l.closed_at
  FROM listings l
  LEFT JOIN users u ON u.id = l.owner_id
  LEFT JOIN categories c ON c.id = l.category_id
`;

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

  try {
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO listings (owner_id, category_id, title, description, item_condition, location) VALUES (?, ?, ?, ?, ?, ?)",
      [req.session.userId, categoryId, title, description, itemCondition, locationValue]
    );

    res.status(201).json({
      id: result.insertId,
      ownerId: req.session.userId,
      categoryId,
      title,
      description,
      itemCondition,
      location: locationValue,
      status: "available",
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
  const params: (string | number | null)[] = [];

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

  const [rows] = await pool.query<ListingRow[]>(
    `${LISTING_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC`,
    params
  );

  const includeContact = Boolean(req.session.userId);
  res.json(rows.map((row) => toListingJson(row, includeContact)));
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

  if (!listing) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  const [photos] = await pool.query<PhotoRow[]>(
    "SELECT id, url, position FROM listing_photos WHERE listing_id = ? ORDER BY position ASC",
    [id]
  );

  const includeContact = Boolean(req.session.userId);
  res.json({
    ...toListingJson(listing, includeContact),
    photos: photos.map((p) => ({ id: p.id, url: p.url, position: p.position })),
  });
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
