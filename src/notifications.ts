// ---------------------------------------------------------------------------
// Notifications in-app.
//
// Ecriture d'une ligne dans `notifications` (voir db/init/01-schema-v2.sql) a
// chaque evenement qui concerne un utilisateur : quelqu'un s'interesse a son
// annonce, un admin a retire son annonce ou bloque son compte, son
// signalement a ete traite...
//
// Regle : notifier n'est jamais critique. Une notification qui ne part pas ne
// doit pas faire echouer l'action metier qui l'a declenchee (le meme choix que
// pour l'envoi d'email dans src/mail.ts) — on logge et on continue.
//
// Le texte est fige au moment de l'ecriture plutot que reconstruit a
// l'affichage : une notification doit rester lisible meme si l'annonce a
// disparu depuis.
// ---------------------------------------------------------------------------
import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

export type NotificationType =
  /** Quelqu'un a mis une annonce en favori ("interesse"). */
  | "listing_interest"
  /** Une annonce a ete retiree par un administrateur. */
  | "listing_removed"
  /** Un nouveau signalement attend la moderation (destine aux admins). */
  | "report_created"
  /** Un signalement a ete traite (destine a la personne qui l'a envoye). */
  | "report_reviewed"
  | "account_blocked"
  | "account_unblocked";

export interface NotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Page a ouvrir au clic, relative au site (ex. "listing.html?id=42"). */
  link?: string | null;
  listingId?: number | null;
  /** Utilisateur a l'origine de l'evenement (admin, personne interessee...). */
  actorId?: number | null;
}

// Colonne VARCHAR(160) : on coupe plutot que de laisser MariaDB refuser la
// ligne (mode strict) pour un titre un peu long.
const MAX_TITLE_LENGTH = 160;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Ecrit une notification. Ne jette jamais : une erreur est seulement loggee. */
export async function notify(input: NotificationInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications
         (user_id, type, title, body, link, listing_id, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.type,
        truncate(input.title, MAX_TITLE_LENGTH),
        input.body ?? null,
        input.link ?? null,
        input.listingId ?? null,
        input.actorId ?? null,
      ]
    );
  } catch (err) {
    console.error("echec d'ecriture d'une notification", err);
  }
}

/**
 * Notifie tous les administrateurs actifs (file de moderation). `exceptUserId`
 * evite qu'un admin se notifie lui-meme pour sa propre action.
 */
export async function notifyAdmins(
  input: Omit<NotificationInput, "userId">,
  exceptUserId?: number
): Promise<void> {
  try {
    interface AdminRow extends RowDataPacket {
      id: number;
    }
    const [admins] = await pool.query<AdminRow[]>(
      "SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL AND is_blocked = FALSE"
    );

    for (const admin of admins) {
      if (admin.id === exceptUserId) continue;
      await notify({ ...input, userId: admin.id });
    }
  } catch (err) {
    console.error("echec de notification des administrateurs", err);
  }
}
