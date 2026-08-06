import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const listingsRouter = Router();

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
  category_id: number;
  title: string;
  description: string;
  item_condition: ItemCondition;
  status: "available" | "reserved" | "closed";
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

function toListingJson(row: ListingRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    itemCondition: row.item_condition,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

const LISTING_COLUMNS =
  "id, owner_id, category_id, title, description, item_condition, status, created_at, updated_at, closed_at";

// POST /listings — cree une annonce (req 1, 3). Il faut etre connecte :
// owner_id vient de la session, jamais du corps de la requete.
listingsRouter.post("/", requireAuth, async (req, res) => {
  const { categoryId, title, description, itemCondition } = req.body ?? {};

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

  try {
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO listings (owner_id, category_id, title, description, item_condition) VALUES (?, ?, ?, ?, ?)",
      [req.session.userId, categoryId, title, description, itemCondition]
    );

    res.status(201).json({
      id: result.insertId,
      ownerId: req.session.userId,
      categoryId,
      title,
      description,
      itemCondition,
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

// GET /listings — grille des annonces disponibles (req 1).
listingsRouter.get("/", async (_req, res) => {
  const [rows] = await pool.query<ListingRow[]>(
    `SELECT ${LISTING_COLUMNS} FROM listings WHERE deleted_at IS NULL ORDER BY created_at DESC`
  );

  res.json(rows.map(toListingJson));
});

// GET /listings/:id — fiche detail d'une annonce (req 4).
listingsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const [rows] = await pool.query<ListingRow[]>(
    `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );

  const listing = rows[0];

  if (!listing) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  res.json(toListingJson(listing));
});
