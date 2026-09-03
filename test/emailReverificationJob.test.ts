import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Le job importe src/db (pool mysql2) et src/mail (fetch reseau) : on remplace
// les deux, ces tests portent sur la decision et l'enchainement, pas sur MySQL.
const query = vi.fn();
const sendTemplate = vi.fn().mockResolvedValue(true);

vi.mock("../src/db", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));
vi.mock("../src/mail", () => ({
  sendEmail: vi.fn(),
  sendTemplate: (...args: unknown[]) => sendTemplate(...args),
}));

import {
  decideSweepAction,
  runEmailReverificationSweep,
  type SweepCandidate,
} from "../src/jobs/emailReverification";
import { EMAIL_REVERIFICATION_INTERVAL_DAYS } from "../src/auth/emailVerification";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-23T12:00:00.000Z");

function candidate(overrides: Partial<SweepCandidate> = {}): SweepCandidate {
  return {
    id: 1,
    email: "etudiant@heig-vd.ch",
    display_name: "Martin Dupont",
    email_verified_at: new Date(NOW.getTime() - 170 * DAY_MS),
    reverification_reminder_sent_at: null,
    ...overrides,
  };
}

describe("decideSweepAction", () => {
  it("envoie un rappel quand l'echeance approche et qu'aucun rappel n'est parti", () => {
    expect(decideSweepAction(candidate(), NOW)).toBe("reminder");
  });

  it("n'envoie pas deux fois le rappel J-14", () => {
    const alreadyWarned = candidate({
      reverification_reminder_sent_at: new Date(NOW.getTime() - 2 * DAY_MS),
    });
    expect(decideSweepAction(alreadyWarned, NOW)).toBe("none");
  });

  it("ne fait rien tant que l'echeance est lointaine", () => {
    const fresh = candidate({
      email_verified_at: new Date(NOW.getTime() - 10 * DAY_MS),
    });
    expect(decideSweepAction(fresh, NOW)).toBe("none");
  });

  it("notifie la suspension une fois les 6 mois depasses", () => {
    const expired = candidate({
      email_verified_at: new Date(
        NOW.getTime() - (EMAIL_REVERIFICATION_INTERVAL_DAYS + 1) * DAY_MS
      ),
      // Le rappel J-14 etait parti avant l'expiration : la notification de
      // suspension, elle, n'a pas encore ete envoyee.
      reverification_reminder_sent_at: new Date(
        NOW.getTime() - (EMAIL_REVERIFICATION_INTERVAL_DAYS - 10) * DAY_MS
      ),
    });
    expect(decideSweepAction(expired, NOW)).toBe("suspension");
  });

  it("ne renvoie pas la notification de suspension a chaque passage", () => {
    const expired = candidate({
      email_verified_at: new Date(
        NOW.getTime() - (EMAIL_REVERIFICATION_INTERVAL_DAYS + 10) * DAY_MS
      ),
      // Envoi posterieur a la date d'expiration : c'etait deja la notification
      // de suspension.
      reverification_reminder_sent_at: new Date(NOW.getTime() - 3 * DAY_MS),
    });
    expect(decideSweepAction(expired, NOW)).toBe("none");
  });

  it("ignore les comptes jamais confirmes (traites a l'inscription)", () => {
    expect(decideSweepAction(candidate({ email_verified_at: null }), NOW)).toBe(
      "none"
    );
  });
});

describe("runEmailReverificationSweep", () => {
  beforeEach(() => {
    query.mockReset();
    sendTemplate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pose un code puis envoie le bon email pour chaque compte concerne", async () => {
    const rows = [
      candidate({ id: 1 }), // -> rappel
      candidate({
        id: 2,
        email: "vieux@heig-vd.ch",
        email_verified_at: new Date(
          NOW.getTime() - (EMAIL_REVERIFICATION_INTERVAL_DAYS + 5) * DAY_MS
        ),
      }), // -> suspension
      candidate({
        id: 3,
        reverification_reminder_sent_at: new Date(NOW.getTime() - DAY_MS),
      }), // -> rien
    ];

    // 1er appel : le SELECT des candidats. Les suivants : les UPDATE de code.
    query.mockResolvedValueOnce([rows]).mockResolvedValue([{}]);

    const result = await runEmailReverificationSweep(NOW);

    expect(result).toEqual({ scanned: 3, reminders: 1, suspensions: 1 });

    // Un UPDATE par compte traite, et rien pour celui deja relance.
    const updates = query.mock.calls
      .slice(1)
      .map((call) => String(call[0]));
    expect(updates).toHaveLength(2);
    for (const sql of updates) {
      expect(sql).toContain("verification_code");
      expect(sql).toContain("reverification_reminder_sent_at = NOW()");
    }

    expect(sendTemplate).toHaveBeenCalledTimes(2);
    const [reminderTo, reminderTemplate] = sendTemplate.mock.calls[0];
    expect(reminderTo).toBe("etudiant@heig-vd.ch");
    expect(reminderTemplate.subject).toMatch(/reconfirmez/i);

    const [suspendedTo, suspendedTemplate] = sendTemplate.mock.calls[1];
    expect(suspendedTo).toBe("vieux@heig-vd.ch");
    expect(suspendedTemplate.subject).toMatch(/suspendu/i);
  });

  it("n'ecrit rien quand aucun compte n'est concerne", async () => {
    query.mockResolvedValueOnce([[]]);

    const result = await runEmailReverificationSweep(NOW);

    expect(result).toEqual({ scanned: 0, reminders: 0, suspensions: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
