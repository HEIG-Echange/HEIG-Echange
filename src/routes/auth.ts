import { Router } from "express";
import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { isAllowedEmailDomain } from "../auth/validateEmail";

export const authRouter = Router();

const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 10;

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  password_hash: string;
  role: "user" | "admin";
  is_blocked: number | boolean;
}

// POST /auth/register — cree un compte
authRouter.post("/register", async (req, res) => {
  const { email, displayName, password } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH
  ) {
    res.status(400).json({
      error: `email, displayName et password (min. ${MIN_PASSWORD_LENGTH} caracteres) sont requis`,
    });
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

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)",
    [email, displayName, passwordHash]
  );

  req.session.userId = result.insertId;

  res.status(201).json({
    id: result.insertId,
    email,
    displayName,
    role: "user",
  });
});

// POST /auth/login
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email et password sont requis" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email, display_name, password_hash, role, is_blocked FROM users WHERE email = ? AND deleted_at IS NULL",
    [email]
  );

  const user = rows[0];

  if (!user) {
    res
      .status(404)
      .json({ error: "aucun compte pour cet email, inscris-toi d'abord" });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    res.status(401).json({ error: "mot de passe incorrect" });
    return;
  }

  if (user.is_blocked) {
    res.status(403).json({ error: "malheuresement ce compte est bloque" });
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
    res.status(401).json({ error: "vous n'etes pas connecte" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email, display_name, avatar_url, role, is_blocked FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );

  const user = rows[0];

  if (!user || user.is_blocked) {
    res.status(401).json({ error: "vous n'etes pas connecte" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
  });
});

// PATCH /auth/me — modifie le profil du compte connecte - displayName et/ou avatarUrl, mise a jour partielle.
authRouter.patch("/me", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "vous n'etes pas connecte" });
    return;
  }

  const { displayName, avatarUrl, password, currentPassword } = req.body ?? {};
  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (displayName !== undefined) {
    if (typeof displayName !== "string" || !displayName.trim()) {
      res.status(400).json({ error: "displayName ne peut pas etre vide" });
      return;
    }
    sets.push("display_name = ?");
    params.push(displayName);
  }

  if (avatarUrl !== undefined) {
    if (avatarUrl !== null && typeof avatarUrl !== "string") {
      res.status(400).json({ error: "avatarUrl doit etre une chaine ou null" });
      return;
    }
    sets.push("avatar_url = ?");
    params.push(avatarUrl);
  }

  if (password !== undefined) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `password doit faire au moins ${MIN_PASSWORD_LENGTH} caracteres`,
      });
      return;
    }

    if (typeof currentPassword !== "string" || !currentPassword) {
      res
        .status(400)
        .json({ error: "currentPassword est requis pour changer de mot de passe" });
      return;
    }

    const [currentRows] = await pool.query<UserRow[]>(
      "SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL",
      [req.session.userId]
    );
    const currentHash = currentRows[0]?.password_hash;

    if (!currentHash || !(await bcrypt.compare(currentPassword, currentHash))) {
      res.status(401).json({ error: "mot de passe actuel incorrect" });
      return;
    }

    const newPasswordHash = await bcrypt.hash(password, SALT_ROUNDS);
    sets.push("password_hash = ?");
    params.push(newPasswordHash);
  }

  if (sets.length === 0) {
    res.status(400).json({ error: "aucun champ a modifier" });
    return;
  }

  params.push(String(req.session.userId));
  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email, display_name, avatar_url, role, is_blocked FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );
  const user = rows[0];

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
  });
});

// DELETE /auth/me — suppression du compte par son proprietaire 
// soft delete (deleted_at),fermeture des annonces encore actives, puis destruction de la session.
authRouter.delete("/me", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "vous n'etes pas connecte" });
    return;
  }

  const userId = req.session.userId;

  await pool.query(
    "UPDATE listings SET deleted_at = CURRENT_TIMESTAMP, status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND deleted_at IS NULL",
    [userId]
  );

  await pool.query(
    "UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
    [userId]
  );

  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "compte supprime mais impossible de terminer la session" });
      return;
    }
    res.clearCookie("connect.sid");
    res.status(204).send();
  });
});
