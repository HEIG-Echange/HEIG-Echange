// Domaines acceptes pour un compte HEIG-Echange
const ALLOWED_DOMAINS = ["heig-vd.ch", "hes-so.ch"];

export function isAllowedEmailDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) {
    return false;
  }

  const domain = email.slice(at + 1).toLowerCase();

  return ALLOWED_DOMAINS.some(
    (allowed) => domain === allowed 
  );
}
