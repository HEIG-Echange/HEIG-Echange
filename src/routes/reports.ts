import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const reportsRouter = Router();

interface ListingRow extends RowDataPacket {
  id: number;
}

// POST /reports — signale une annonce 
reportsRouter.post("/", requireAuth, async (req, res) => {
  const { listingId, reason } = req.body ?? {};

  if (
    typeof listingId !== "number" ||
    !Number.isInteger(listingId) ||
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    res.status(400).json({ error: "listingId (nombre) et reason sont requis" });
    return;
  }

  const [listingRows] = await pool.query<ListingRow[]>(
    "SELECT id FROM listings WHERE id = ? AND deleted_at IS NULL",
    [listingId]
  );

  if (!listingRows[0]) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO reports (reporter_id, listing_id, reason) VALUES (?, ?, ?)",
    [req.session.userId, listingId, reason]
  );

  res.status(201).json({
    id: result.insertId,
    listingId,
    reason,
    status: "open",
  });
});
