import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  accountEmailStatus,
  EMAIL_REVERIFICATION_INTERVAL_DAYS,
} from "../auth/emailVerification";
import { runEmailReverificationSweep } from "../jobs/emailReverification";
import {
  defaultAiSettings,
  readAiOverrides,
  setAiSetting,
  type AiSettingKey,
} from "../aiSettings";
import { aiConfigured } from "../ai";
import { notify } from "../notifications";

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
    reporter_id: number | null;
    listing_title: string | null;
  }
  const [reportRows] = await pool.query<ReportListingRow[]>(
    `SELECT r.listing_id, r.reporter_id, l.title AS listing_title
       FROM reports r
       LEFT JOIN listings l ON l.id = r.listing_id
      WHERE r.id = ?`,
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

  // La personne qui a signale apprend ce qui a ete decide : sans retour, elle
  // ne sait pas si son signalement a servi a quelque chose.
  if (report.reporter_id) {
    await notify({
      userId: report.reporter_id,
      type: "report_reviewed",
      title:
        status === "dismissed"
          ? "Votre signalement a ete classe sans suite"
          : "Votre signalement a ete traite",
      body: [
        report.listing_title ? `Annonce : ${report.listing_title}` : null,
        note ?? null,
      ]
        .filter(Boolean)
        .join("\n") || null,
      link: `listing.html?id=${report.listing_id}`,
      listingId: report.listing_id,
      actorId: req.session.userId,
    });
  }

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

  // Le compte bloque ne peut plus se connecter : la notification l'attend a la
  // levee du blocage, avec le motif.
  await notify({
    userId: id,
    type: "account_blocked",
    title: "Votre compte a ete bloque",
    body: `Motif : ${reason}`,
    actorId: req.session.userId,
  });

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

  await notify({
    userId: id,
    type: "account_unblocked",
    title: "Votre compte a ete debloque",
    body: reason ?? null,
    actorId: req.session.userId,
  });

  res.status(204).send();
});

interface AdminUserRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  role: "user" | "admin";
  is_blocked: number | boolean;
  blocked_reason: string | null;
  email_verified_at: string | null;
  created_at: string;
  deleted_at: string | null;
  listings_count: number;
  open_reports: number;
}

// GET /admin/users — annuaire de moderation. ?q= filtre sur le nom ou l'email,
// ?blocked=true ne garde que les comptes bloques. C'est ce que consomme la page
// /admin.html pour proposer "bloquer / debloquer" sans avoir a deviner un id.
adminRouter.get("/users", async (req, res) => {
  const { q, blocked } = req.query;

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (typeof q === "string" && q.trim()) {
    where.push("(u.display_name LIKE ? OR u.email LIKE ?)");
    const like = `%${q.trim()}%`;
    params.push(like, like);
  }

  if (blocked === "true") {
    where.push("u.is_blocked = TRUE");
  }

  const [rows] = await pool.query<AdminUserRow[]>(
    `SELECT u.id, u.email, u.display_name, u.role, u.is_blocked, u.blocked_reason,
            u.email_verified_at, u.created_at, u.deleted_at,
            (SELECT COUNT(*) FROM listings l
              WHERE l.owner_id = u.id AND l.deleted_at IS NULL) AS listings_count,
            (SELECT COUNT(*) FROM reports r
               JOIN listings l2 ON l2.id = r.listing_id
              WHERE l2.owner_id = u.id AND r.status = 'open') AS open_reports
       FROM users u
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY u.is_blocked DESC, u.created_at DESC
      LIMIT 200`,
    params
  );

  res.json(
    rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      isBlocked: Boolean(u.is_blocked),
      blockedReason: u.blocked_reason,
      emailStatus: accountEmailStatus(u.email_verified_at),
      createdAt: u.created_at,
      deletedAt: u.deleted_at,
      listingsCount: u.listings_count,
      openReports: u.open_reports,
    }))
  );
});

interface LogRow extends RowDataPacket {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  // La colonne est un JSON MariaDB : selon la facon dont la table a ete creee
  // (type JSON, ou LONGTEXT + CHECK json_valid comme dans certains exports),
  // le driver renvoie soit la chaine brute, soit l'objet deja decode.
  details: string | Record<string, unknown> | null;
  created_at: string;
}

/** Normalise details en objet, quelle que soit la forme rendue par le driver. */
function parseLogDetails(details: LogRow["details"]): unknown {
  if (details === null || details === undefined) return null;
  if (typeof details !== "string") return details;
  try {
    return JSON.parse(details);
  } catch {
    // Ligne ecrite a la main ou tronquee : on rend le texte plutot que de
    // faire echouer toute la page d'historique.
    return details;
  }
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
      details: parseLogDetails(r.details),
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

// GET /admin/suspended-accounts — comptes dont l'adresse email n'est plus
// confirmee depuis plus de 6 mois. Ils restent en base mais sont suspendus :
// connexion refusee et annonces masquees des listes publiques.
adminRouter.get("/suspended-accounts", async (_req, res) => {
  interface SuspendedRow extends RowDataPacket {
    id: number;
    email: string;
    display_name: string;
    email_verified_at: string | null;
    reverification_reminder_sent_at: string | null;
    hidden_listings: number;
  }

  const [rows] = await pool.query<SuspendedRow[]>(
    `SELECT u.id, u.email, u.display_name, u.email_verified_at,
            u.reverification_reminder_sent_at,
            (SELECT COUNT(*) FROM listings l
              WHERE l.owner_id = u.id AND l.deleted_at IS NULL) AS hidden_listings
       FROM users u
      WHERE u.deleted_at IS NULL
        AND (u.email_verified_at IS NULL
             OR u.email_verified_at <= (NOW() - INTERVAL ? DAY))
      ORDER BY u.email_verified_at IS NULL DESC, u.email_verified_at ASC`,
    [EMAIL_REVERIFICATION_INTERVAL_DAYS]
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      emailStatus: accountEmailStatus(r.email_verified_at),
      emailVerifiedAt: r.email_verified_at,
      lastReminderAt: r.reverification_reminder_sent_at,
      hiddenListings: r.hidden_listings,
    }))
  );
});

// POST /admin/jobs/email-reverification — declenche a la main le balayage qui
// envoie les rappels de reconfirmation. Le meme balayage tourne tout seul une
// fois par jour (voir src/server.ts) ; cette route sert a le forcer depuis un
// cron externe ou pour une demo, sans attendre 24 h.
adminRouter.post("/jobs/email-reverification", async (_req, res) => {
  const result = await runEmailReverificationSweep();
  res.json(result);
});

// ---------------------------------------------------------------------------
// Reglages de l'analyse IA des photos
//
// Les prompts envoyes au modele Hugging Face sont modifiables en ligne par un
// administrateur (page /admin-ai.html) : pas besoin de redeployer pour ajuster
// la formulation ou changer de modele. Voir src/aiSettings.ts pour l'ordre de
// precedence base > environnement > defaut du code.
// ---------------------------------------------------------------------------

// GET /admin/ai-settings — valeurs effectives, defauts, et ce qui est surcharge
// en base (pour que l'interface puisse afficher "personnalise" / "par defaut").
adminRouter.get("/ai-settings", async (_req, res) => {
  const defaults = defaultAiSettings();
  const overrides = await readAiOverrides();

  res.json({
    provider: "huggingface",
    configured: aiConfigured(),
    effective: { ...defaults, ...overrides },
    defaults,
    overridden: {
      model: overrides.model !== undefined,
      systemPrompt: overrides.systemPrompt !== undefined,
      userPrompt: overrides.userPrompt !== undefined,
    },
    // Rappeles ici pour que la page d'edition puisse les documenter sans les
    // reecrire de son cote.
    placeholders: ["{{categories}}", "{{conditions}}"],
  });
});

// PUT /admin/ai-settings — enregistre les reglages. Un champ absent est laisse
// tel quel ; un champ a null (ou vide) efface la surcharge et fait revenir la
// valeur par defaut.
adminRouter.put("/ai-settings", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const FIELDS: { field: string; key: AiSettingKey }[] = [
    { field: "model", key: "ai.model" },
    { field: "systemPrompt", key: "ai.system_prompt" },
    { field: "userPrompt", key: "ai.user_prompt" },
  ];

  for (const { field } of FIELDS) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      res.status(400).json({ error: `${field} doit etre une chaine ou null` });
      return;
    }
  }

  for (const { field, key } of FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    const trimmed = typeof value === "string" ? value.trim() : null;
    await setAiSetting(key, trimmed ? trimmed : null, req.session.userId);
  }

  const defaults = defaultAiSettings();
  const overrides = await readAiOverrides();
  res.json({ effective: { ...defaults, ...overrides }, defaults });
});
