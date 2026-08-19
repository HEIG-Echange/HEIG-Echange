import { Router } from "express";
import QRCode from "qrcode";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { PUBLIC_BASE_URL } from "../config";

export const usersRouter = Router();

interface PublicUserRow extends RowDataPacket {
  id: number;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  is_blocked: number | boolean;
  active_listings: number;
}

const PUBLIC_USER_SELECT = `
  SELECT
    u.id, u.display_name, u.avatar_url, u.created_at, u.is_blocked,
    (SELECT COUNT(*) FROM listings l
       WHERE l.owner_id = u.id AND l.deleted_at IS NULL) AS active_listings
  FROM users u
  WHERE u.id = ? AND u.deleted_at IS NULL
`;

// URL publique du profil d'un utilisateur (page frontend), encodee dans le QR.
function profileUrl(id: number): string {
  return `${PUBLIC_BASE_URL}/u.html?id=${id}`;
}

// GET /users/:id — profil public. Ne renvoie aucune information de contact
// (email) : le profil est consultable par n'importe qui, y compris non connecte.
usersRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const [rows] = await pool.query<PublicUserRow[]>(PUBLIC_USER_SELECT, [id]);
  const user = rows[0];

  if (!user || user.is_blocked) {
    res.status(404).json({ error: "utilisateur introuvable" });
    return;
  }

  res.json({
    id: user.id,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
    activeListings: user.active_listings,
    profileUrl: profileUrl(user.id),
  });
});

// GET /users/:id/qr — QR code (SVG) pointant vers le profil public. Le domaine
// provient de PUBLIC_BASE_URL (variable d'environnement).
usersRouter.get("/:id/qr", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const [rows] = await pool.query<PublicUserRow[]>(PUBLIC_USER_SELECT, [id]);
  const user = rows[0];

  if (!user || user.is_blocked) {
    res.status(404).json({ error: "utilisateur introuvable" });
    return;
  }

  const svg = await QRCode.toString(profileUrl(id), {
    type: "svg",
    margin: 1,
    color: { dark: "#1a1816", light: "#ffffff" },
  });

  res.type("image/svg+xml");
  // Cache court : le contenu est stable pour un id donne.
  res.set("Cache-Control", "public, max-age=3600");
  res.send(svg);
});
