import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { requireAdmin } from "../middleware/requireAdmin";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const REPORT_STATUSES = ["open", "reviewed", "dismissed"] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];

function isReportStatus(value: unknown): value is ReportStatus {
  return (
    typeof value === "string" &&
    (REPORT_STATUSES as readonly string[]).includes(value)
  );
}

interface ReportRow extends RowDataPacket {
  id: number;
  listing_id: number;
  listing_title: string | null;
  reporter_id: number | null;
  reporter_name: string | null;
  reason: string;
  status: ReportStatus;
  created_at: string;
  reviewed_at: string | null;
}

// GET /admin/reports — file de moderation, filtrable par statut.
adminRouter.get("/reports", async (req, res) => {
  const { status } = req.query;

  const where: string[] = [];
  const params: string[] = [];

  if (typeof status === "string" && status.trim()) {
    if (!isReportStatus(status)) {
      res.status(400).json({ error: `status doit etre l'un de : ${REPORT_STATUSES.join(", ")}` });
      return;
    }
    where.push("r.status = ?");
    params.push(status);
  }

  const [rows] = await pool.query<ReportRow[]>(
    `SELECT r.id, r.listing_id, l.title AS listing_title,
            r.reporter_id, u.display_name AS reporter_name,
            r.reason, r.status, r.created_at, r.reviewed_at
     FROM reports r
     LEFT JOIN listings l ON l.id = r.listing_id
     LEFT JOIN users u ON u.id = r.reporter_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY r.created_at DESC`,
    params
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      listingTitle: r.listing_title,
      reporterId: r.reporter_id,
      reporterName: r.reporter_name,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    }))
  );
});

// PATCH /admin/reports/:id — marque un signalement comme traite
adminRouter.patch("/reports/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status, note } = req.body ?? {};

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  if (!isReportStatus(status) || status === "open") {
    res.status(400).json({ error: "status doit etre 'reviewed' ou 'dismissed'" });
    return;
  }

  if (note !== undefined && typeof note !== "string") {
    res.status(400).json({ error: "note doit etre une chaine" });
    return;
  }

  interface ReportListingRow extends RowDataPacket {
    listing_id: number;
  }
  const [reportRows] = await pool.query<ReportListingRow[]>(
    "SELECT listing_id FROM reports WHERE id = ?",
    [id]
  );
  const report = reportRows[0];

  if (!report) {
    res.status(404).json({ error: "signalement introuvable" });
    return;
  }

  await pool.query(
    "UPDATE reports SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
    [status, id]
  );

  await pool.query(
    "INSERT INTO moderation_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, 'listing', ?, ?)",
    [
      req.session.userId,
      status === "dismissed" ? "dismiss_report" : "review_report",
      report.listing_id,
      JSON.stringify({ reportId: id, status, note: note ?? null }),
    ]
  );

  res.status(204).send();
});

// POST /admin/users/:id/block — bloque un utilisateur 
adminRouter.post("/users/:id/block", async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body ?? {};

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  if (typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason est requis" });
    return;
  }

  const [result] = await pool.query(
    "UPDATE users SET is_blocked = TRUE, blocked_reason = ? WHERE id = ? AND deleted_at IS NULL",
    [reason, id]
  );

  if ((result as { affectedRows: number }).affectedRows === 0) {
    res.status(404).json({ error: "utilisateur introuvable" });
    return;
  }

  await pool.query(
    "INSERT INTO moderation_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'block_user', 'user', ?, ?)",
    [req.session.userId, id, JSON.stringify({ reason })]
  );

  res.status(204).send();
});

// POST /admin/users/:id/unblock — debloque un utilisateur. reason optionnel
adminRouter.post("/users/:id/unblock", async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body ?? {};

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  if (reason !== undefined && typeof reason !== "string") {
    res.status(400).json({ error: "reason doit etre une chaine" });
    return;
  }

  const [result] = await pool.query(
    "UPDATE users SET is_blocked = FALSE, blocked_reason = NULL WHERE id = ? AND deleted_at IS NULL",
    [id]
  );

  if ((result as { affectedRows: number }).affectedRows === 0) {
    res.status(404).json({ error: "utilisateur introuvable" });
    return;
  }

  await pool.query(
    "INSERT INTO moderation_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'unblock_user', 'user', ?, ?)",
    [req.session.userId, id, reason ? JSON.stringify({ reason }) : null]
  );

  res.status(204).send();
});

interface LogRow extends RowDataPacket {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  target_type: "user" | "listing";
  target_id: number;
  details: string | null;
  created_at: string;
}

// GET /admin/moderation-logs — historique des actions de moderation filtrable par cible 
adminRouter.get("/moderation-logs", async (req, res) => {
  const { targetType, targetId } = req.query;

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (typeof targetType === "string" && targetType.trim()) {
    if (targetType !== "user" && targetType !== "listing") {
      res.status(400).json({ error: "targetType doit etre 'user' ou 'listing'" });
      return;
    }
    where.push("m.target_type = ?");
    params.push(targetType);
  }

  if (typeof targetId === "string" && targetId.trim()) {
    const id = Number(targetId);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "targetId invalide" });
      return;
    }
    where.push("m.target_id = ?");
    params.push(id);
  }

  const [rows] = await pool.query<LogRow[]>(
    `SELECT m.id, m.actor_id, u.display_name AS actor_name,
            m.action, m.target_type, m.target_id, m.details, m.created_at
     FROM moderation_logs m
     LEFT JOIN users u ON u.id = m.actor_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY m.created_at DESC`,
    params
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: r.details ? JSON.parse(r.details) : null,
      createdAt: r.created_at,
    }))
  );
});

interface AdminListingRow extends RowDataPacket {
  id: number;
  owner_id: number;
  owner_name: string | null;
  title: string;
  status: "available" | "reserved" | "closed";
  created_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

// GET /admin/listings — acces aux anciennes annonces, y compris supprimees. filtrable par proprietaire pour l'historique d'un utilisateur
adminRouter.get("/listings", async (req, res) => {
  const { ownerId } = req.query;

  const where: string[] = [];
  const params: number[] = [];

  if (typeof ownerId === "string" && ownerId.trim()) {
    const id = Number(ownerId);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "ownerId invalide" });
      return;
    }
    where.push("l.owner_id = ?");
    params.push(id);
  }

  const [rows] = await pool.query<AdminListingRow[]>(
    `SELECT l.id, l.owner_id, u.display_name AS owner_name, l.title, l.status,
            l.created_at, l.closed_at, l.deleted_at
     FROM listings l
     LEFT JOIN users u ON u.id = l.owner_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY l.created_at DESC`,
    params
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      deletedAt: r.deleted_at,
    }))
  );
});
