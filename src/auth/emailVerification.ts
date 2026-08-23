// ---------------------------------------------------------------------------
// Politique de (re)verification d'adresse email.
//
// Regle produit : un compte n'est pleinement valide que si son adresse est
// confirmee, et cette confirmation ne vaut que 6 mois. Passe ce delai le compte
// est suspendu : plus de connexion possible, et ses annonces disparaissent des
// listes publiques tant que l'adresse n'a pas ete reconfirmee.
//
// Toute la logique de dates vit ici, en fonctions pures : les routes et le job
// planifie s'en servent, et les tests peuvent injecter un "now" fixe.
// ---------------------------------------------------------------------------

/** Duree de validite d'une confirmation d'adresse email. */
export const EMAIL_REVERIFICATION_INTERVAL_DAYS = 180;

/** Delai avant expiration a partir duquel on envoie un rappel par email. */
export const EMAIL_REVERIFICATION_REMINDER_DAYS = 14;

/** Duree de vie d'un code de verification envoye par email. */
export const VERIFICATION_CODE_TTL_MINUTES = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccountEmailStatus =
  /** Inscription jamais confirmee : le compte n'est pas utilisable. */
  | "unverified"
  /** Confirmation valide. */
  | "verified"
  /** Confirmation valide mais bientot perimee : on relance l'utilisateur. */
  | "expiring"
  /** Confirmation perimee : compte suspendu jusqu'a reconfirmation. */
  | "expired";

/** Normalise une valeur de date venue de MySQL (Date, string ou null). */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date a laquelle une confirmation faite a `verifiedAt` cesse d'etre valable. */
export function emailExpiresAt(
  verifiedAt: Date | string | null | undefined
): Date | null {
  const date = toDate(verifiedAt);
  if (!date) return null;
  return new Date(date.getTime() + EMAIL_REVERIFICATION_INTERVAL_DAYS * DAY_MS);
}

/** Etat de l'adresse email d'un compte a l'instant `now`. */
export function accountEmailStatus(
  verifiedAt: Date | string | null | undefined,
  now: Date = new Date()
): AccountEmailStatus {
  const expiresAt = emailExpiresAt(verifiedAt);
  if (!expiresAt) return "unverified";
  if (expiresAt.getTime() <= now.getTime()) return "expired";

  const reminderFrom =
    expiresAt.getTime() - EMAIL_REVERIFICATION_REMINDER_DAYS * DAY_MS;
  return now.getTime() >= reminderFrom ? "expiring" : "verified";
}

/**
 * Un compte est suspendu tant que son adresse n'est pas (re)confirmee. C'est
 * ce booleen qui conditionne la connexion et la visibilite des annonces.
 */
export function isAccountSuspended(
  verifiedAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  const status = accountEmailStatus(verifiedAt, now);
  return status === "unverified" || status === "expired";
}

/** Nombre de jours entiers restants avant expiration (0 si deja expire). */
export function daysUntilEmailExpiry(
  verifiedAt: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  const expiresAt = emailExpiresAt(verifiedAt);
  if (!expiresAt) return null;
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

/** Date d'expiration d'un code de verification genere maintenant. */
export function verificationCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60_000);
}

/**
 * Fragment SQL (sans parametre) vrai pour un compte dont l'adresse est encore
 * valide. `alias` est l'alias de la table users dans la requete appelante.
 * Centralise ici pour que la regle des 6 mois ne soit pas dupliquee a la main
 * dans chaque requete.
 */
export function emailStillValidSql(alias: string): string {
  return `${alias}.email_verified_at IS NOT NULL AND ${alias}.email_verified_at > (NOW() - INTERVAL ${EMAIL_REVERIFICATION_INTERVAL_DAYS} DAY)`;
}

/** Fragment SQL vrai pour un compte actif : ni bloque, ni suspendu, ni supprime. */
export function activeAccountSql(alias: string): string {
  return `${alias}.deleted_at IS NULL AND ${alias}.is_blocked = FALSE AND ${emailStillValidSql(alias)}`;
}
