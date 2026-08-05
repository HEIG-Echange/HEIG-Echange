// Domaines acceptes pour un compte HEIG-Echange (accepte aussi les
// sous-domaines, ex. edu.hes-so.ch), en miroir du CHECK SQL sur users.email
// dans db/init/01-schema.sql.
const ALLOWED_DOMAINS = ["heig-vd.ch", "hes-so.ch"];

export function isAllowedEmailDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) {
    return false;
  }

  const domain = email.slice(at + 1).toLowerCase();

  return ALLOWED_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );
}
