import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";
import { isAccountSuspended } from "../auth/emailVerification";

interface AccountRow extends RowDataPacket {
  email: string;
  email_verified_at: string | null;
  is_blocked: number | boolean;
}

// A poser devant toute route qui necessite un utilisateur connecte ET actif.
//
// "Actif" ne se resume pas a "a une session" : un compte peut avoir ete bloque
// par un admin, ou avoir laisse sa confirmation d'email depasser les 6 mois,
// pendant que sa session etait encore ouverte. On revalide donc a chaque appel
// plutot que de faire confiance au cookie.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.session.userId) {
    res.status(401).json({ error: "vous devez etre connecte" });
    return;
  }

  const [rows] = await pool.query<AccountRow[]>(
    "SELECT email, email_verified_at, is_blocked FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );
  const account = rows[0];

  if (!account) {
    res.status(401).json({ error: "vous devez etre connecte" });
    return;
  }

  if (account.is_blocked) {
    res.status(403).json({ error: "ce compte est bloque" });
    return;
  }

  if (isAccountSuspended(account.email_verified_at)) {
    res.status(403).json({
      error: "compte suspendu : ton adresse email doit etre reconfirmee",
      code: "EMAIL_REVERIFICATION_REQUIRED",
      email: account.email,
    });
    return;
  }

  next();
}
