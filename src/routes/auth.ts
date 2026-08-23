import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { isAllowedEmailDomain } from "../auth/validateEmail";
import {
  accountEmailStatus,
  daysUntilEmailExpiry,
  emailExpiresAt,
  isAccountSuspended,
  verificationCodeExpiry,
  VERIFICATION_CODE_TTL_MINUTES,
  EMAIL_REVERIFICATION_INTERVAL_DAYS,
} from "../auth/emailVerification";
import { sendTemplate } from "../mail";
import {
  welcomeVerificationEmail,
  resendCodeEmail,
  accountReactivatedEmail,
} from "../mailTemplates";

export const authRouter = Router();

const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 10;

// En dev/staging seulement !!!!! renvoie le code dans la reponse API pour pouvoir
// tester sans acces a une vraie boite mail , necessaire pour les test bruno
// et pour scripts/seed_demo_data.py.
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

// Genere un code, le pose sur le compte et renvoie sa valeur. Le meme mecanisme
// sert a la premiere confirmation et aux reconfirmations semestrielles : il n'y
// a jamais qu'un seul code en vol par compte.
async function issueVerificationCode(userId: number): Promise<string> {
  const code = generateVerificationCode();
  await pool.query(
    "UPDATE users SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?",
    [code, verificationCodeExpiry(), userId]
  );
  return code;
}

// Bloc decrivant l'etat de l'adresse email, ajoute a toutes les reponses qui
// decrivent le compte connecte. Le frontend s'en sert pour afficher le bandeau
// "votre adresse expire dans X jours".
function emailStatusPayload(verifiedAt: string | null) {
  const status = accountEmailStatus(verifiedAt);
  return {
    emailVerified: status !== "unverified",
    emailStatus: status,
    emailVerifiedAt: verifiedAt,
    emailExpiresAt: emailExpiresAt(verifiedAt)?.toISOString() ?? null,
    daysUntilEmailExpiry: daysUntilEmailExpiry(verifiedAt),
    reverificationIntervalDays: EMAIL_REVERIFICATION_INTERVAL_DAYS,
  };
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
  const code = generateVerificationCode();

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users
       (email, display_name, password_hash, verification_code, verification_code_expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [email, displayName, passwordHash, code, verificationCodeExpiry()]
  );

  await sendTemplate(email, welcomeVerificationEmail(email, displayName, code));

  res.status(201).json({
    id: result.insertId,
    email,
    displayName,
    role: "user",
    ...emailStatusPayload(null),
    message: "compte cree, verifie ton email avec le code recu",
    codeTtlMinutes: VERIFICATION_CODE_TTL_MINUTES,
    ...(EXPOSE_VERIFICATION_CODE ? { devVerificationCode: code } : {}),
  });
});

// POST /auth/verify-email — confirme l'adresse email avec le code recu.
// Sert AUSSI a la reconfirmation semestrielle : tant qu'un code est en vol sur
// le compte on le consomme, meme si l'adresse avait deja ete confirmee par le
// passe (cette confirmation-la est alors perimee ou sur le point de l'etre).
authRouter.post("/verify-email", async (req, res) => {
  const { email, code } = req.body ?? {};

  if (typeof email !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "email et code sont requis" });
    return;
  }

  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, email, display_name, email_verified_at, verification_code,
            verification_code_expires_at
     FROM users WHERE email = ? AND deleted_at IS NULL`,
    [email]
  );

  const user = rows[0];

  if (!user) {
    res.status(404).json({ error: "aucun compte pour cet email" });
    return;
  }

  // Rien a confirmer : adresse deja valide et aucun code en attente.
  if (!user.verification_code && user.email_verified_at) {
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

  const wasSuspended = isAccountSuspended(user.email_verified_at);
  const wasFirstVerification = !user.email_verified_at;

  await pool.query(
    `UPDATE users
     SET email_verified_at = NOW(),
         verification_code = NULL,
         verification_code_expires_at = NULL,
         reverification_reminder_sent_at = NULL
     WHERE id = ?`,
    [user.id]
  );

  // Un compte qui sortait de suspension est prevenu : ses annonces reapparaissent.
  if (wasSuspended && !wasFirstVerification) {
    await sendTemplate(user.email, accountReactivatedEmail(user.display_name));
  }

  res.json({
    ...emailStatusPayload(new Date().toISOString()),
    reactivated: wasSuspended && !wasFirstVerification,
  });
});

// POST /auth/resend-code — regenere et renvoie un code. Utilise aussi bien pour
// une inscription pas encore confirmee que pour une reconfirmation.
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

  // On ne renvoie un code que si l'adresse a reellement besoin d'etre
  // (re)confirmee : jamais confirmee, bientot perimee, ou deja perimee.
  const status = accountEmailStatus(user.email_verified_at);
  if (status === "verified") {
    res.status(409).json({ error: "cet email est deja verifie" });
    return;
  }

  const code = await issueVerificationCode(user.id);
  await sendTemplate(email, resendCodeEmail(email, code));

  res.json({
    message: "nouveau code envoye",
    emailStatus: status,
    codeTtlMinutes: VERIFICATION_CODE_TTL_MINUTES,
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

  const status = accountEmailStatus(user.email_verified_at);

  // Inscription jamais confirmee : le compte n'est pas actif.
  if (status === "unverified") {
    res.status(403).json({
      error:
        "email non verifie, verifie ta boite mail (ou POST /auth/resend-code)",
      code: "EMAIL_NOT_VERIFIED",
      email: user.email,
    });
    return;
  }

  // Confirmation perimee (> 6 mois) : compte suspendu. On envoie directement un
  // nouveau code pour que l'utilisateur puisse se debloquer sans etape en plus.
  if (status === "expired") {
    const code = await issueVerificationCode(user.id);
    await sendTemplate(user.email, resendCodeEmail(user.email, code));
    res.status(403).json({
      error: `ton adresse n'a pas ete reconfirmee depuis ${EMAIL_REVERIFICATION_INTERVAL_DAYS} jours : compte suspendu. Un nouveau code vient d'etre envoye.`,
      code: "EMAIL_REVERIFICATION_REQUIRED",
      email: user.email,
      ...(EXPOSE_VERIFICATION_CODE ? { devVerificationCode: code } : {}),
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
    ...emailStatusPayload(user.email_verified_at),
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
    "SELECT id, email, display_name, avatar_url, email_verified_at, role, is_blocked FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );

  const user = rows[0];

  if (!user || user.is_blocked) {
    res.status(401).json({ error: "vous n'etes pas connecte" });
    return;
  }

  // Le compte a pu expirer PENDANT une session ouverte : on coupe l'acces sans
  // attendre la prochaine connexion.
  if (isAccountSuspended(user.email_verified_at)) {
    res.status(403).json({
      error: "compte suspendu : ton adresse email doit etre reconfirmee",
      code: "EMAIL_REVERIFICATION_REQUIRED",
      email: user.email,
    });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    ...emailStatusPayload(user.email_verified_at),
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
    "SELECT id, email, display_name, avatar_url, email_verified_at, role, is_blocked FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );
  const user = rows[0];

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    ...emailStatusPayload(user.email_verified_at),
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
