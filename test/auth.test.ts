import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import type { MockPool } from "./support/mockPool";

process.env.PUBLIC_BASE_URL = "https://echange.heig-vd.ch";

vi.mock("../src/db", async () => {
  const { createMockPool } = await import("./support/mockPool");
  return { pool: createMockPool() };
});

const sendTemplate = vi.fn().mockResolvedValue(true);
vi.mock("../src/mail", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendTemplate: (...args: unknown[]) => sendTemplate(...args),
}));

let app: Express;
let pool: MockPool;

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "motdepasse123";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  ({ pool } = (await import("../src/db")) as unknown as { pool: MockPool });
});

beforeEach(() => {
  pool.reset();
  sendTemplate.mockClear();
});

// ---------------------------------------------------------------------------
// Inscription
// ---------------------------------------------------------------------------

describe("POST /auth/register", () => {
  beforeEach(() => {
    pool.on(/SELECT id FROM users WHERE email/, []);
    pool.on(/INSERT INTO users/, { insertId: 12 });
  });

  it("cree un compte NON actif et envoie un code par email", async () => {
    const res = await request(app).post("/auth/register").send({
      email: "nouveau@heig-vd.ch",
      displayName: "Nouvelle Etudiante",
      password: PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(res.body.emailVerified).toBe(false);
    expect(res.body.emailStatus).toBe("unverified");

    expect(sendTemplate).toHaveBeenCalledTimes(1);
    const [to, template] = sendTemplate.mock.calls[0];
    expect(to).toBe("nouveau@heig-vd.ch");
    expect(template.subject).toMatch(/confirmez/i);

    // Le code stocke en base est bien celui envoye par email.
    const insert = pool.calls.find((c) => /INSERT INTO users/.test(c.sql));
    const storedCode = insert?.params[3] as string;
    expect(storedCode).toMatch(/^\d{8}$/);
    expect(template.body).toContain(storedCode);
  });

  it("ne divulgue pas le code dans la reponse hors mode test", async () => {
    const res = await request(app).post("/auth/register").send({
      email: "nouveau@heig-vd.ch",
      displayName: "Nouvelle Etudiante",
      password: PASSWORD,
    });

    // EXPOSE_VERIFICATION_CODE_FOR_TESTING n'est pas actif dans les tests
    // unitaires : le code ne doit sortir que par email.
    expect(res.body.devVerificationCode).toBeUndefined();
  });

  it("refuse un domaine hors ecole", async () => {
    const res = await request(app).post("/auth/register").send({
      email: "quelquun@gmail.com",
      displayName: "Externe",
      password: PASSWORD,
    });

    expect(res.status).toBe(403);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

describe("POST /auth/verify-email", () => {
  it("active un compte fraichement inscrit", async () => {
    pool.on(/SELECT id, email, display_name, email_verified_at/, [
      {
        id: 12,
        email: "nouveau@heig-vd.ch",
        display_name: "Nouvelle Etudiante",
        email_verified_at: null,
        verification_code: "12345678",
        verification_code_expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    ]);
    pool.on(/UPDATE users/, { affectedRows: 1 });

    const res = await request(app)
      .post("/auth/verify-email")
      .send({ email: "nouveau@heig-vd.ch", code: "12345678" });

    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
    expect(res.body.emailStatus).toBe("verified");
    expect(res.body.reactivated).toBe(false);
    // Premiere confirmation : pas d'email "compte reactive".
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("reactive un compte suspende et le lui annonce", async () => {
    pool.on(/SELECT id, email, display_name, email_verified_at/, [
      {
        id: 12,
        email: "vieux@heig-vd.ch",
        display_name: "Ancien Etudiant",
        // Confirme il y a plus de 6 mois : le compte etait suspendu.
        email_verified_at: daysAgo(200),
        verification_code: "87654321",
        verification_code_expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    ]);
    pool.on(/UPDATE users/, { affectedRows: 1 });

    const res = await request(app)
      .post("/auth/verify-email")
      .send({ email: "vieux@heig-vd.ch", code: "87654321" });

    expect(res.status).toBe(200);
    expect(res.body.reactivated).toBe(true);

    const [, template] = sendTemplate.mock.calls[0];
    expect(template.subject).toMatch(/actif/i);

    // La reconfirmation remet aussi le marqueur de rappel a zero, sinon le job
    // ne relancerait plus jamais ce compte.
    const update = pool.calls.find((c) => /UPDATE users/.test(c.sql));
    expect(update?.sql).toContain("reverification_reminder_sent_at = NULL");
  });

  it("rejette un code errone", async () => {
    pool.on(/SELECT id, email, display_name, email_verified_at/, [
      {
        id: 12,
        email: "nouveau@heig-vd.ch",
        display_name: "N",
        email_verified_at: null,
        verification_code: "12345678",
        verification_code_expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    ]);

    const res = await request(app)
      .post("/auth/verify-email")
      .send({ email: "nouveau@heig-vd.ch", code: "00000000" });

    expect(res.status).toBe(400);
  });

  it("rejette un code expire", async () => {
    pool.on(/SELECT id, email, display_name, email_verified_at/, [
      {
        id: 12,
        email: "nouveau@heig-vd.ch",
        display_name: "N",
        email_verified_at: null,
        verification_code: "12345678",
        verification_code_expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    ]);

    const res = await request(app)
      .post("/auth/verify-email")
      .send({ email: "nouveau@heig-vd.ch", code: "12345678" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expire/);
  });

  it("refuse une confirmation quand il n'y a rien a confirmer", async () => {
    pool.on(/SELECT id, email, display_name, email_verified_at/, [
      {
        id: 12,
        email: "actif@heig-vd.ch",
        display_name: "A",
        email_verified_at: daysAgo(3),
        verification_code: null,
        verification_code_expires_at: null,
      },
    ]);

    const res = await request(app)
      .post("/auth/verify-email")
      .send({ email: "actif@heig-vd.ch", code: "12345678" });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Renvoi de code
// ---------------------------------------------------------------------------

describe("POST /auth/resend-code", () => {
  it("renvoie un code a un compte pas encore confirme", async () => {
    pool.on(/SELECT id, email_verified_at FROM users/, [
      { id: 12, email_verified_at: null },
    ]);
    pool.on(/UPDATE users SET verification_code/, { affectedRows: 1 });

    const res = await request(app)
      .post("/auth/resend-code")
      .send({ email: "nouveau@heig-vd.ch" });

    expect(res.status).toBe(200);
    expect(res.body.emailStatus).toBe("unverified");
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("renvoie un code a un compte dont la confirmation a expire", async () => {
    pool.on(/SELECT id, email_verified_at FROM users/, [
      { id: 12, email_verified_at: daysAgo(200) },
    ]);
    pool.on(/UPDATE users SET verification_code/, { affectedRows: 1 });

    const res = await request(app)
      .post("/auth/resend-code")
      .send({ email: "vieux@heig-vd.ch" });

    expect(res.status).toBe(200);
    expect(res.body.emailStatus).toBe("expired");
  });

  it("refuse d'en renvoyer un a un compte deja valide", async () => {
    pool.on(/SELECT id, email_verified_at FROM users/, [
      { id: 12, email_verified_at: daysAgo(3) },
    ]);

    const res = await request(app)
      .post("/auth/resend-code")
      .send({ email: "actif@heig-vd.ch" });

    expect(res.status).toBe(409);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Connexion et suspension a 6 mois
// ---------------------------------------------------------------------------

describe("POST /auth/login", () => {
  function userRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      email: "martin@heig-vd.ch",
      display_name: "Martin Dupont",
      password_hash: PASSWORD_HASH,
      email_verified_at: daysAgo(10),
      role: "user",
      is_blocked: 0,
      ...overrides,
    };
  }

  it("connecte un compte confirme et renvoie l'etat de son adresse", async () => {
    pool.on(/SELECT id, email, display_name, password_hash/, [userRow()]);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.emailStatus).toBe("verified");
    expect(res.body.reverificationIntervalDays).toBe(180);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("signale une adresse qui approche de l'echeance", async () => {
    pool.on(/SELECT id, email, display_name, password_hash/, [
      userRow({ email_verified_at: daysAgo(175) }),
    ]);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.emailStatus).toBe("expiring");
    expect(res.body.daysUntilEmailExpiry).toBeLessThanOrEqual(14);
  });

  it("refuse un compte jamais confirme", async () => {
    pool.on(/SELECT id, email, display_name, password_hash/, [
      userRow({ email_verified_at: null }),
    ]);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("suspend un compte non reconfirme depuis 6 mois et renvoie un code", async () => {
    pool.on(/SELECT id, email, display_name, password_hash/, [
      userRow({ email_verified_at: daysAgo(190) }),
    ]);
    pool.on(/UPDATE users SET verification_code/, { affectedRows: 1 });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_REVERIFICATION_REQUIRED");
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Un code part immediatement : l'utilisateur peut se debloquer sans etape
    // supplementaire.
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("refuse un mot de passe incorrect avant tout controle d'email", async () => {
    pool.on(/SELECT id, email, display_name, password_hash/, [
      userRow({ email_verified_at: null }),
    ]);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: "mauvais-mot-de-passe" });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Session en cours
// ---------------------------------------------------------------------------

describe("GET /auth/me", () => {
  it("coupe l'acces si la confirmation expire pendant la session", async () => {
    const agent = request.agent(app);

    // Connexion avec une adresse encore valide.
    pool.once(/SELECT id, email, display_name, password_hash/, [
      {
        id: 7,
        email: "martin@heig-vd.ch",
        display_name: "Martin Dupont",
        password_hash: PASSWORD_HASH,
        email_verified_at: daysAgo(10),
        role: "user",
        is_blocked: 0,
      },
    ]);
    await agent
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: PASSWORD });

    // Le temps passe : a la requete suivante l'adresse a depasse les 6 mois.
    pool.on(/SELECT id, email, display_name, avatar_url/, [
      {
        id: 7,
        email: "martin@heig-vd.ch",
        display_name: "Martin Dupont",
        avatar_url: null,
        email_verified_at: daysAgo(200),
        role: "user",
        is_blocked: 0,
      },
    ]);

    const res = await agent.get("/auth/me");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_REVERIFICATION_REQUIRED");
  });

  it("refuse un visiteur sans session", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Middleware requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  it("bloque une action d'un compte suspendu, meme avec une session ouverte", async () => {
    const agent = request.agent(app);

    pool.once(/SELECT id, email, display_name, password_hash/, [
      {
        id: 7,
        email: "martin@heig-vd.ch",
        display_name: "Martin Dupont",
        password_hash: PASSWORD_HASH,
        email_verified_at: daysAgo(10),
        role: "user",
        is_blocked: 0,
      },
    ]);
    await agent
      .post("/auth/login")
      .send({ email: "martin@heig-vd.ch", password: PASSWORD });

    pool.on(/SELECT email, email_verified_at, is_blocked FROM users/, [
      {
        email: "martin@heig-vd.ch",
        email_verified_at: daysAgo(200),
        is_blocked: 0,
      },
    ]);

    const res = await agent.post("/listings").send({
      categoryId: 1,
      title: "Objet",
      description: "Description",
      itemCondition: "bon",
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_REVERIFICATION_REQUIRED");
  });
});
