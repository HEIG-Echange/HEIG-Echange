import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { notifyAdmins } from "../notifications";

export const reportsRouter = Router();

// Longueur max du motif : la colonne reason est un VARCHAR(255).
const MAX_REASON_LENGTH = 255;

interface ListingRow extends RowDataPacket {
  id: number;
  owner_id: number;
  title: string;
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

  const trimmedReason = reason.trim();
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    res.status(400).json({
      error: `reason ne peut pas depasser ${MAX_REASON_LENGTH} caracteres`,
    });
    return;
  }

  const [listingRows] = await pool.query<ListingRow[]>(
    "SELECT id, owner_id, title FROM listings WHERE id = ? AND deleted_at IS NULL",
    [listingId]
  );

  const listing = listingRows[0];

  if (!listing) {
    res.status(404).json({ error: "annonce introuvable" });
    return;
  }

  // Signaler sa propre annonce n'a pas de sens : le proprietaire peut la
  // retirer lui-meme, et ca ne ferait qu'encombrer la file de moderation.
  if (listing.owner_id === req.session.userId) {
    res.status(400).json({ error: "vous ne pouvez pas signaler votre propre annonce" });
    return;
  }

  // Un signalement deja en attente pour ce couple (annonce, auteur) : on ne
  // duplique pas la file de moderation sur un double-clic ou un renvoi.
  interface ExistingRow extends RowDataPacket {
    id: number;
  }
  const [existing] = await pool.query<ExistingRow[]>(
    "SELECT id FROM reports WHERE listing_id = ? AND reporter_id = ? AND status = 'open'",
    [listingId, req.session.userId]
  );

  if (existing[0]) {
    res.status(409).json({
      error: "vous avez deja signale cette annonce, elle attend d'etre traitee",
      id: existing[0].id,
    });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO reports (reporter_id, listing_id, reason) VALUES (?, ?, ?)",
    [req.session.userId, listingId, trimmedReason]
  );

  // La file de moderation ne se consulte pas toute seule : on previent les
  // admins pour qu'un signalement ne dorme pas jusqu'a la prochaine visite.
  await notifyAdmins(
    {
      type: "report_created",
      title: `Annonce signalee : ${listing.title}`,
      body: trimmedReason,
      link: `admin.html?tab=reports`,
      listingId,
      actorId: req.session.userId,
    },
    req.session.userId
  );

  res.status(201).json({
    id: result.insertId,
    listingId,
    reason: trimmedReason,
    status: "open",
  });
});

interface MyReportRow extends RowDataPacket {
  id: number;
  listing_id: number;
  listing_title: string | null;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  created_at: string;
  reviewed_at: string | null;
}

// GET /reports/mine — mes signalements et leur suivi. Permet au frontend de
// montrer "deja signale" sur une annonce sans exposer la file de moderation.
reportsRouter.get("/mine", requireAuth, async (req, res) => {
  const [rows] = await pool.query<MyReportRow[]>(
    `SELECT r.id, r.listing_id, l.title AS listing_title, r.reason, r.status,
            r.created_at, r.reviewed_at
       FROM reports r
       LEFT JOIN listings l ON l.id = r.listing_id
      WHERE r.reporter_id = ?
      ORDER BY r.created_at DESC`,
    [req.session.userId]
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      listingTitle: r.listing_title,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    }))
  );
});
