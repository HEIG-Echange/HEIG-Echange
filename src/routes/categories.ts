import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";

export const categoriesRouter = Router();

interface CategoryRow extends RowDataPacket {
  id: number;
  slug: string;
  label: string;
}

// GET /categories — reference fixe utilisee pour les filtres (req 2) et le
// formulaire de creation d'annonce.
categoriesRouter.get("/", async (_req, res) => {
  const [rows] = await pool.query<CategoryRow[]>(
    "SELECT id, slug, label FROM categories ORDER BY label ASC"
  );

  res.json(rows);
});
