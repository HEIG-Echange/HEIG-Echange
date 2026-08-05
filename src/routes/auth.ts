import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { isAllowedEmailDomain } from "../auth/validateEmail";

export const authRouter = Router();

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  role: "user" | "admin";
  is_blocked: number | boolean;
}

// POST /auth/register — cree un compte (req 0 : domaine verifie).
authRouter.post("/register", async (req, res) => {
  const { email, displayName } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof displayName !== "string" ||
    !displayName.trim()
  ) {
    res.status(400).json({ error: "email et displayName sont requis" });
    return;
  }

  if (!isAllowedEmailDomain(email)) {
    res
      .status(403)
      .json({ error: "email doit appartenir a heig-vd.ch ou hes-so.ch" });
    return;
  }

  const [existing] = await pool.query<UserRow[]>(
    "SELECT id FROM users WHERE email = ? AND deleted_at IS NULL",
    [email]
  );

  if (existing.length > 0) {
    res.status(409).json({ error: "un compte existe deja pour cet email" });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (email, display_name) VALUES (?, ?)",
    [email, displayName]
  );

  req.session.userId = result.insertId;

  res.status(201).json({
    id: result.insertId,
    email,
    displayName,
    role: "user",
  });
});

// POST /auth/login — pas de mot de passe : on verifie juste le domaine et
// qu'un compte existe deja (cree via /auth/register).
authRouter.post("/login", async (req, res) => {
  const { email } = req.body ?? {};

  if (typeof email !== "string") {
    res.status(400).json({ error: "email est requis" });
    return;
  }

  if (!isAllowedEmailDomain(email)) {
    res
      .status(403)
      .json({ error: "email doit appartenir a heig-vd.ch ou hes-so.ch" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email, display_name, role, is_blocked FROM users WHERE email = ? AND deleted_at IS NULL",
    [email]
  );

  const user = rows[0];

  if (!user) {
    res
      .status(404)
      .json({ error: "aucun compte pour cet email, inscris-toi d'abord" });
    return;
  }

  if (user.is_blocked) {
    res.status(403).json({ error: "ce compte est bloque" });
    return;
  }

  req.session.userId = user.id;

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
  });
});

// POST /auth/logout — detruit la session serveur + le cookie.
authRouter.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "impossible de terminer la session" });
      return;
    }
    res.clearCookie("connect.sid");
    res.status(204).send();
  });
});

// GET /auth/me — renvoie le compte lie a la session en cours, si connecte.
authRouter.get("/me", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "non connecte" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email, display_name, role, is_blocked FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );

  const user = rows[0];

  if (!user || user.is_blocked) {
    res.status(401).json({ error: "non connecte" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
  });
});
