import { describe, it, expect } from "vitest";
import {
  accountEmailStatus,
  daysUntilEmailExpiry,
  emailExpiresAt,
  isAccountSuspended,
  verificationCodeExpiry,
  activeAccountSql,
  emailStillValidSql,
  toDate,
  EMAIL_REVERIFICATION_INTERVAL_DAYS,
  EMAIL_REVERIFICATION_REMINDER_DAYS,
  VERIFICATION_CODE_TTL_MINUTES,
} from "../src/auth/emailVerification";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-23T12:00:00.000Z");

/** Date de confirmation situee `days` jours avant NOW. */
function verifiedDaysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe("accountEmailStatus", () => {
  it("considere un compte jamais confirme comme 'unverified'", () => {
    expect(accountEmailStatus(null, NOW)).toBe("unverified");
    expect(accountEmailStatus(undefined, NOW)).toBe("unverified");
    expect(accountEmailStatus("", NOW)).toBe("unverified");
  });

  it("considere une confirmation recente comme 'verified'", () => {
    expect(accountEmailStatus(verifiedDaysAgo(0), NOW)).toBe("verified");
    expect(accountEmailStatus(verifiedDaysAgo(30), NOW)).toBe("verified");
  });

  it("bascule en 'expiring' a l'entree de la fenetre de rappel", () => {
    const justBefore = verifiedDaysAgo(
      EMAIL_REVERIFICATION_INTERVAL_DAYS - EMAIL_REVERIFICATION_REMINDER_DAYS - 1
    );
    const justInside = verifiedDaysAgo(
      EMAIL_REVERIFICATION_INTERVAL_DAYS - EMAIL_REVERIFICATION_REMINDER_DAYS
    );

    expect(accountEmailStatus(justBefore, NOW)).toBe("verified");
    expect(accountEmailStatus(justInside, NOW)).toBe("expiring");
  });

  it("bascule en 'expired' une fois les 6 mois ecoules", () => {
    const justBeforeExpiry = verifiedDaysAgo(EMAIL_REVERIFICATION_INTERVAL_DAYS - 1);
    const exactlyAtExpiry = verifiedDaysAgo(EMAIL_REVERIFICATION_INTERVAL_DAYS);
    const wellPast = verifiedDaysAgo(EMAIL_REVERIFICATION_INTERVAL_DAYS + 40);

    expect(accountEmailStatus(justBeforeExpiry, NOW)).toBe("expiring");
    // A la seconde pres, l'expiration est inclusive : la confirmation ne vaut
    // plus au moment ou elle atteint 180 jours.
    expect(accountEmailStatus(exactlyAtExpiry, NOW)).toBe("expired");
    expect(accountEmailStatus(wellPast, NOW)).toBe("expired");
  });

  it("accepte une date sous forme de chaine (ce que renvoie MySQL)", () => {
    expect(accountEmailStatus(verifiedDaysAgo(10).toISOString(), NOW)).toBe(
      "verified"
    );
  });
});

describe("isAccountSuspended", () => {
  it("suspend un compte jamais confirme", () => {
    expect(isAccountSuspended(null, NOW)).toBe(true);
  });

  it("suspend un compte dont la confirmation a plus de 6 mois", () => {
    expect(
      isAccountSuspended(verifiedDaysAgo(EMAIL_REVERIFICATION_INTERVAL_DAYS + 1), NOW)
    ).toBe(true);
  });

  it("ne suspend pas un compte encore dans la fenetre de rappel", () => {
    expect(
      isAccountSuspended(verifiedDaysAgo(EMAIL_REVERIFICATION_INTERVAL_DAYS - 3), NOW)
    ).toBe(false);
  });
});

describe("emailExpiresAt / daysUntilEmailExpiry", () => {
  it("place l'expiration a 180 jours apres la confirmation", () => {
    const verifiedAt = verifiedDaysAgo(0);
    const expires = emailExpiresAt(verifiedAt);
    expect(expires?.getTime()).toBe(
      verifiedAt.getTime() + EMAIL_REVERIFICATION_INTERVAL_DAYS * DAY_MS
    );
  });

  it("renvoie null quand l'adresse n'a jamais ete confirmee", () => {
    expect(emailExpiresAt(null)).toBeNull();
    expect(daysUntilEmailExpiry(null)).toBeNull();
  });

  it("compte les jours restants, et 0 une fois l'echeance passee", () => {
    expect(daysUntilEmailExpiry(verifiedDaysAgo(170), NOW)).toBe(10);
    expect(
      daysUntilEmailExpiry(verifiedDaysAgo(EMAIL_REVERIFICATION_INTERVAL_DAYS + 5), NOW)
    ).toBe(0);
  });
});

describe("verificationCodeExpiry", () => {
  it("expire au bout du TTL annonce", () => {
    const expiry = verificationCodeExpiry(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(
      VERIFICATION_CODE_TTL_MINUTES * 60_000
    );
  });
});

describe("toDate", () => {
  it("renvoie null pour une valeur vide ou invalide", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("pas une date")).toBeNull();
  });
});

describe("fragments SQL", () => {
  it("emailStillValidSql filtre sur l'intervalle configure", () => {
    const sql = emailStillValidSql("u");
    expect(sql).toContain("u.email_verified_at IS NOT NULL");
    expect(sql).toContain(`INTERVAL ${EMAIL_REVERIFICATION_INTERVAL_DAYS} DAY`);
  });

  it("activeAccountSql exclut aussi les comptes supprimes et bloques", () => {
    const sql = activeAccountSql("u");
    expect(sql).toContain("u.deleted_at IS NULL");
    expect(sql).toContain("u.is_blocked = FALSE");
    expect(sql).toContain("u.email_verified_at IS NOT NULL");
  });

  it("respecte l'alias de table fourni", () => {
    expect(activeAccountSql("owner")).toContain("owner.is_blocked = FALSE");
    expect(activeAccountSql("owner")).not.toContain("u.");
  });
});
