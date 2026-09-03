// Client pour le service d'envoi d'email  
const MAILER_BASE_URL =
  process.env.MAILER_BASE_URL ?? "https://mailer.echange.online";
const MAILER_API_KEY = process.env.MAILER_API_KEY;
const MAILER_FROM_EMAIL =
  process.env.MAILER_FROM_EMAIL ?? "no-reply@heig.echange.online";

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail({
  to,
  subject,
  body,
}: SendEmailInput): Promise<boolean> {
  if (!MAILER_API_KEY) {
    console.warn(
      "MAILER_API_KEY absente : email non envoye (voir .env.example)."
    );
    return false;
  }

  const params = new URLSearchParams({
    to,
    from: MAILER_FROM_EMAIL,
    subject,
    body,
  });

  const response = await fetch(`${MAILER_BASE_URL}/api/send.php`, {
    method: "POST",
    headers: {
      "X-API-Key": MAILER_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    console.error(
      `Echec envoi email a ${to} : ${response.status} ${response.statusText}`
    );
    return false;
  }

  return true;
}

// Envoi d'un gabarit (voir src/mailTemplates.ts). Ne jette jamais : un service
// mail indisponible ne doit pas faire echouer une inscription ou un job — on
// journalise et on renvoie false, l'utilisateur peut redemander un code.
export async function sendTemplate(
  to: string,
  template: { subject: string; body: string }
): Promise<boolean> {
  try {
    return await sendEmail({ to, ...template });
  } catch (err) {
    console.error(`Echec envoi email a ${to} :`, err);
    return false;
  }
}
