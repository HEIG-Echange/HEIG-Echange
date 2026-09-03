// ---------------------------------------------------------------------------
// Centre de notifications de l'utilisateur connecte.
//
// Toutes les routes sont derriere requireAuth et ne voient QUE les lignes dont
// user_id = session : une notification est personnelle, il n'existe pas de vue
// "toutes les notifications", meme pour un admin.
// ---------------------------------------------------------------------------
import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

interface NotificationRow extends RowDataPacket {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  listing_id: number | null;
  actor_id: number | null;
  actor_name: string | null;
  read_at: string | null;
  created_at: string;
}

// Plafond de lignes renvoyees : la page affiche un historique, pas une archive.
const MAX_NOTIFICATIONS = 100;

function toJson(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    listingId: row.listing_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    read: row.read_at !== null,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// GET /notifications — mes notifications, les plus recentes d'abord.
// ?unread=true ne renvoie que les non lues.
notificationsRouter.get("/", async (req, res) => {
  const unreadOnly = req.query.unread === "true";

  const [rows] = await pool.query<NotificationRow[]>(
    `SELECT n.id, n.type, n.title, n.body, n.link, n.listing_id,
            n.actor_id, a.display_name AS actor_name,
            n.read_at, n.created_at
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ?
        ${unreadOnly ? "AND n.read_at IS NULL" : ""}
      ORDER BY n.created_at DESC
      LIMIT ${MAX_NOTIFICATIONS}`,
    [req.session.userId]
  );

  interface CountRow extends RowDataPacket {
    unread: number;
  }
  const [countRows] = await pool.query<CountRow[]>(
    "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL",
    [req.session.userId]
  );

  res.json({
    unreadCount: Number(countRows[0]?.unread ?? 0),
    notifications: rows.map(toJson),
  });
});

// GET /notifications/unread-count — pastille de la cloche, appelee sur chaque
// page : requete volontairement minimale.
notificationsRouter.get("/unread-count", async (req, res) => {
  interface CountRow extends RowDataPacket {
    unread: number;
  }
  const [rows] = await pool.query<CountRow[]>(
    "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL",
    [req.session.userId]
  );

  res.json({ unreadCount: Number(rows[0]?.unread ?? 0) });
});

// POST /notifications/read-all — marque tout comme lu.
// Declaree avant /:id/read : sinon "read-all" serait capture comme un :id.
notificationsRouter.post("/read-all", async (req, res) => {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL",
    [req.session.userId]
  );

  res.json({ updated: result.affectedRows });
});

// POST /notifications/:id/read — marque une notification comme lue.
notificationsRouter.post("/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    [id, req.session.userId]
  );

  // 0 ligne : soit elle n'est pas a moi (on ne le dit pas), soit elle etait
  // deja lue. On verifie l'appartenance pour distinguer 404 et succes.
  if (result.affectedRows === 0) {
    interface ExistsRow extends RowDataPacket {
      id: number;
    }
    const [rows] = await pool.query<ExistsRow[]>(
      "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
      [id, req.session.userId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "notification introuvable" });
      return;
    }
  }

  res.status(204).send();
});

// DELETE /notifications/:id — retire une notification de ma liste.
notificationsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM notifications WHERE id = ? AND user_id = ?",
    [id, req.session.userId]
  );

  if (result.affectedRows === 0) {
    res.status(404).json({ error: "notification introuvable" });
    return;
  }

  res.status(204).send();
});
