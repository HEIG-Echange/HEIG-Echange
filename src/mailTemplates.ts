// ---------------------------------------------------------------------------
// Gabarits des emails transactionnels.
//
// Fonctions pures (aucun I/O) : elles se contentent de fabriquer sujet + corps.
// L'envoi reste dans src/mail.ts. Tous les liens sont construits sur
// PUBLIC_BASE_URL pour ne jamais pointer vers localhost en production.
// ---------------------------------------------------------------------------
import { PUBLIC_BASE_URL } from "./config";
import {
  EMAIL_REVERIFICATION_INTERVAL_DAYS,
  VERIFICATION_CODE_TTL_MINUTES,
} from "./auth/emailVerification";

export interface MailTemplate {
  subject: string;
  body: string;
}

/** Lien vers la page de saisie du code, avec l'adresse pre-remplie. */
export function verifyPageUrl(email: string): string {
  return `${PUBLIC_BASE_URL}/verify.html?email=${encodeURIComponent(email)}`;
}

const MONTHS = Math.round(EMAIL_REVERIFICATION_INTERVAL_DAYS / 30);

/** Email envoye juste apres l'inscription : le compte n'est pas encore actif. */
export function welcomeVerificationEmail(
  email: string,
  displayName: string,
  code: string
): MailTemplate {
  return {
    subject: "HEIG-Echange — confirmez votre adresse email",
    body: [
      `Bonjour ${displayName},`,
      "",
      "Bienvenue sur HEIG-Echange, la plateforme de don d'objets entre",
      "etudiant.e.s de la HEIG-VD.",
      "",
      `Votre code de confirmation est : ${code}`,
      "",
      `Ce code expire dans ${VERIFICATION_CODE_TTL_MINUTES} minutes. Saisissez-le ici :`,
      verifyPageUrl(email),
      "",
      "Tant que votre adresse n'est pas confirmee, votre compte n'est pas",
      "active : vous ne pouvez pas vous connecter ni publier d'annonce.",
      "",
      `Pour rappel, une confirmation reste valable ${MONTHS} mois.`,
      "",
      "A bientot,",
      "L'equipe HEIG-Echange",
    ].join("\n"),
  };
}

/** Renvoi d'un code a la demande de l'utilisateur. */
export function resendCodeEmail(email: string, code: string): MailTemplate {
  return {
    subject: "HEIG-Echange — votre nouveau code de confirmation",
    body: [
      "Bonjour,",
      "",
      `Voici votre nouveau code de confirmation : ${code}`,
      "",
      `Il expire dans ${VERIFICATION_CODE_TTL_MINUTES} minutes. Saisissez-le ici :`,
      verifyPageUrl(email),
      "",
      "Si vous n'avez rien demande, ignorez simplement ce message.",
      "",
      "L'equipe HEIG-Echange",
    ].join("\n"),
  };
}

/** Rappel envoye quelques jours avant l'expiration de la confirmation. */
export function reverificationReminderEmail(
  email: string,
  displayName: string,
  code: string,
  daysLeft: number
): MailTemplate {
  const delay =
    daysLeft <= 1 ? "moins de 24 heures" : `${daysLeft} jours`;
  return {
    subject: `HEIG-Echange — reconfirmez votre adresse (${delay})`,
    body: [
      `Bonjour ${displayName},`,
      "",
      `Pour garder la plateforme reservee aux etudiant.e.s de la HEIG-VD, une`,
      `adresse email doit etre reconfirmee tous les ${MONTHS} mois.`,
      "",
      `La votre expire dans ${delay}.`,
      "",
      `Votre code de reconfirmation : ${code}`,
      "",
      "Saisissez-le ici :",
      verifyPageUrl(email),
      "",
      "Sans reconfirmation, votre compte sera suspendu et vos annonces ne",
      "seront plus visibles par la communaute (elles ne sont pas supprimees :",
      "elles reapparaissent des que vous reconfirmez).",
      "",
      "L'equipe HEIG-Echange",
    ].join("\n"),
  };
}

/** Notification envoyee au moment ou le compte bascule en suspendu. */
export function accountSuspendedEmail(
  email: string,
  displayName: string,
  code: string
): MailTemplate {
  return {
    subject: "HEIG-Echange — compte suspendu, adresse a reconfirmer",
    body: [
      `Bonjour ${displayName},`,
      "",
      `Votre adresse n'a pas ete reconfirmee depuis ${MONTHS} mois : votre compte`,
      "est desormais suspendu et vos annonces ne sont plus visibles.",
      "",
      "Rien n'est perdu. Reconfirmez votre adresse pour tout reactiver :",
      "",
      `Code : ${code}`,
      verifyPageUrl(email),
      "",
      "L'equipe HEIG-Echange",
    ].join("\n"),
  };
}

/** Confirmation que le compte est (re)active. */
export function accountReactivatedEmail(displayName: string): MailTemplate {
  return {
    subject: "HEIG-Echange — votre compte est actif",
    body: [
      `Bonjour ${displayName},`,
      "",
      "Votre adresse est confirmee : votre compte est actif et vos annonces",
      "sont de nouveau visibles par la communaute.",
      "",
      PUBLIC_BASE_URL,
      "",
      "L'equipe HEIG-Echange",
    ].join("\n"),
  };
}
