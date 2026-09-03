import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { isAllowedEmailDomain } from "../auth/validateEmail";
import { sendEmail } from "../mail";

export const authRouter = Router();

const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 10;
const VERIFICATION_CODE_TTL_MINUTES = 15;

// En dev/staging seulement !!!!! renvoie le code dans la reponse API pour pouvoir
// tester sans acces a une vraie boite mail , nécessaire pour les test bruno
const EXPOSE_VERIFICATION_CODE =
  process.env.EXPOSE_VERIFICATION_CODE_FOR_TESTING === "true";

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  password_hash: string;
  email_verified_at: string | null;
  verification_code: string | null;
  verification_code_expires_at: string | null;
  role: "user" | "admin";
  is_blocked: number | boolean;
}

function generateVerificationCode(): string {
  // 8 chiffres, zeros non-significatifs conserves
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}


function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}

async function sendVerificationEmail(
  email: string,
  code: string
): Promise<void> {
  try {
    await sendEmail({
      to: email,
      subject: "Confirmation d'adresse email",
      body: `Bienvenue sur HEIG-Echange ! Voici votre code de verification : ${code}. Ce code expire dans ${VERIFICATION_CODE_TTL_MINUTES} minutes.`,
    });
  } catch (err) {
    console.error(`Echec envoi email de verification a ${email}`, err);
  }
}

// POST /auth/register — cree un compte
authRouter.post("/register", async (req, res) => {
  const { email, displayName, password } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    !isValidPassword(password)
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
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60_000);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users
       (email, display_name, password_hash, verification_code, verification_code_expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [email, displayName, passwordHash, code, expiresAt]
  );

  await sendVerificationEmail(email, code);

  res.status(201).json({
    id: result.insertId,
    email,
    displayName,
    role: "user",
    emailVerified: false,
    message: "compte cree, verifie ton email avec le code recu",
    ...(EXPOSE_VERIFICATION_CODE ? { devVerificationCode: code } : {}),
  });
});

// POST /auth/verify-email — confirme l'adresse email avec le code recu
authRouter.post("/verify-email", async (req, res) => {
  const { email, code } = req.body ?? {};

  if (typeof email !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "email et code sont requis" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, email_verified_at, verification_code, verification_code_expires_at
     FROM users WHERE email = ? AND deleted_at IS NULL`,
    [email]
  );

  const user = rows[0];

  if (!user) {
    res.status(404).json({ error: "aucun compte pour cet email" });
    return;
  }

  if (user.email_verified_at) {
    res.status(409).json({ error: "cet email est deja verifie" });
    return;
  }

  const isExpired =
    !user.verification_code_expires_at ||
    new Date(user.verification_code_expires_at).getTime() < Date.now();

  if (!user.verification_code || user.verification_code !== code || isExpired) {
    res.status(400).json({ error: "code invalide ou expire" });
    return;
  }

  await pool.query(
    `UPDATE users
     SET email_verified_at = NOW(), verification_code = NULL, verification_code_expires_at = NULL
     WHERE id = ?`,
    [user.id]
  );

  res.json({ emailVerified: true });
});

// POST /auth/resend-code — regenere et renvoie un code si besoin 
authRouter.post("/resend-code", async (req, res) => {
  const { email } = req.body ?? {};

  if (typeof email !== "string") {
    res.status(400).json({ error: "email est requis" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email_verified_at FROM users WHERE email = ? AND deleted_at IS NULL",
    [email]
  );

  const user = rows[0];

  if (!user) {
    res.status(404).json({ error: "aucun compte pour cet email" });
    return;
  }

  if (user.email_verified_at) {
    res.status(409).json({ error: "cet email est deja verifie" });
    return;
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60_000);

  await pool.query(
    "UPDATE users SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?",
    [code, expiresAt, user.id]
  );

  await sendVerificationEmail(email, code);

  res.json({
    message: "nouveau code envoye",
    ...(EXPOSE_VERIFICATION_CODE ? { devVerificationCode: code } : {}),
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
    "SELECT id, email, display_name, password_hash, email_verified_at, role, is_blocked FROM users WHERE email = ? AND deleted_at IS NULL",
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

  //verifie que l'email est bien verifie avant de creer la session
  if (!user.email_verified_at) {
    res.status(403).json({
      error: "email non verifie, verifie ta boite mail (ou POST /auth/resend-code)",
      code: "EMAIL_NOT_VERIFIED",
    });
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

// PATCH /auth/me — modifie le profil du compte connecte - displayName et/ou avatarUrl, mot de passe 
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
    if (!isValidPassword(password)) {
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
