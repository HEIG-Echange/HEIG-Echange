// ---------------------------------------------------------------------------
// Job de reverification d'email.
//
// Passe une fois par jour sur les comptes dont la confirmation d'adresse
// approche de ses 6 mois ou les a depasses, et envoie le message qui va bien :
//
//   - "expiring" (J-14 avant expiration) -> rappel + code de reconfirmation
//   - "expired"                          -> notification de suspension + code
//
// La suspension elle-meme n'est pas un champ que ce job ecrit : elle se deduit
// de email_verified_at (voir src/auth/emailVerification.ts) et s'applique donc
// immediatement, meme si le job n'a pas encore tourne. Le job ne sert qu'a
// PREVENIR l'utilisateur — la regle metier, elle, ne depend d'aucun cron.
//
// reverification_reminder_sent_at evite de renvoyer le meme message tous les
// jours : on y ecrit la date d'envoi, et verify-email la remet a NULL.
// ---------------------------------------------------------------------------
import type { RowDataPacket } from "mysql2";
import crypto from "crypto";
import { pool } from "../db";
import {
  accountEmailStatus,
  daysUntilEmailExpiry,
  emailExpiresAt,
  verificationCodeExpiry,
  EMAIL_REVERIFICATION_INTERVAL_DAYS,
  EMAIL_REVERIFICATION_REMINDER_DAYS,
  toDate,
} from "../auth/emailVerification";
import { sendTemplate } from "../mail";
import {
  reverificationReminderEmail,
  accountSuspendedEmail,
} from "../mailTemplates";

export interface SweepCandidate {
  id: number;
  email: string;
  display_name: string;
  email_verified_at: Date | string | null;
  reverification_reminder_sent_at: Date | string | null;
}

/** Ce que le job doit faire d'un compte donne. */
export type SweepAction = "reminder" | "suspension" | "none";

/**
 * Decide l'action a prendre pour un compte, sans toucher a la base : tout le
 * raisonnement de dates est ici pour pouvoir etre teste avec un `now` fixe.
 *
 * Un rappel n'est envoye qu'une fois par periode :
 *   - phase "expiring" : seulement si aucun rappel n'a encore ete envoye
 *     depuis la derniere confirmation ;
 *   - phase "expired"  : seulement si le dernier envoi date d'AVANT la date
 *     d'expiration, autrement dit si c'etait le rappel J-14 et pas deja la
 *     notification de suspension.
 */
export function decideSweepAction(
  candidate: SweepCandidate,
  now: Date = new Date()
): SweepAction {
  const status = accountEmailStatus(candidate.email_verified_at, now);
  const expiresAt = emailExpiresAt(candidate.email_verified_at);
  const lastSent = toDate(candidate.reverification_reminder_sent_at);

  if (status === "expiring") {
    return lastSent ? "none" : "reminder";
  }

  if (status === "expired" && expiresAt) {
    // Deja notifie apres l'expiration : on n'insiste pas.
    if (lastSent && lastSent.getTime() > expiresAt.getTime()) return "none";
    return "suspension";
  }

  // "verified" (encore loin de l'echeance) ou "unverified" (jamais confirme :
  // gere par l'inscription et /auth/resend-code, pas par ce job).
  return "none";
}

export interface SweepResult {
  scanned: number;
  reminders: number;
  suspensions: number;
}

function generateVerificationCode(): string {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

/**
 * Balaye les comptes concernes et envoie les emails. Renvoie un compte-rendu
 * chiffre (utilise par la route admin et par les logs du demarrage).
 */
export async function runEmailReverificationSweep(
  now: Date = new Date()
): Promise<SweepResult> {
  // On ne charge que les comptes potentiellement concernes : confirmes il y a
  // plus de (180 - 14) jours. Les comptes bloques ou supprimes sont exclus,
  // les relancer n'aurait pas de sens.
  const [rows] = await pool.query<(SweepCandidate & RowDataPacket)[]>(
    `SELECT id, email, display_name, email_verified_at, reverification_reminder_sent_at
       FROM users
      WHERE deleted_at IS NULL
        AND is_blocked = FALSE
        AND email_verified_at IS NOT NULL
        AND email_verified_at <= (NOW() - INTERVAL ? DAY)`,
    [EMAIL_REVERIFICATION_INTERVAL_DAYS - EMAIL_REVERIFICATION_REMINDER_DAYS]
  );

  const result: SweepResult = {
    scanned: rows.length,
    reminders: 0,
    suspensions: 0,
  };

  for (const candidate of rows) {
    const action = decideSweepAction(candidate, now);
    if (action === "none") continue;

    const code = generateVerificationCode();
    await pool.query(
      `UPDATE users
          SET verification_code = ?,
              verification_code_expires_at = ?,
              reverification_reminder_sent_at = NOW()
        WHERE id = ?`,
      [code, verificationCodeExpiry(now), candidate.id]
    );

    if (action === "reminder") {
      const daysLeft = daysUntilEmailExpiry(candidate.email_verified_at, now) ?? 0;
      await sendTemplate(
        candidate.email,
        reverificationReminderEmail(
          candidate.email,
          candidate.display_name,
          code,
          daysLeft
        )
      );
      result.reminders += 1;
    } else {
      await sendTemplate(
        candidate.email,
        accountSuspendedEmail(candidate.email, candidate.display_name, code)
      );
      result.suspensions += 1;
    }
  }

  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Planifie le balayage quotidien. Appele par src/server.ts uniquement (jamais
 * a l'import de src/app.ts, sinon les tests declencheraient un timer et des
 * requetes SQL). Renvoie de quoi arreter le timer.
 */
export function scheduleEmailReverificationSweep(
  intervalMs: number = DAY_MS
): NodeJS.Timeout {
  const run = () => {
    runEmailReverificationSweep()
      .then(({ scanned, reminders, suspensions }) => {
        console.log(
          `[reverification] ${scanned} compte(s) examine(s), ${reminders} rappel(s), ${suspensions} suspension(s)`
        );
      })
      .catch((err) => {
        // Un job qui echoue ne doit pas faire tomber le serveur : il repassera.
        console.error("[reverification] balayage echoue :", err);
      });
  };

  // Un premier passage peu apres le demarrage rattrape les comptes arrives a
  // echeance pendant que l'app etait arretee.
  const timer = setInterval(run, intervalMs);
  setTimeout(run, 30_000).unref();
  return timer;
}
