import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import type { MockPool } from "./support/mockPool";

vi.mock("../src/db", async () => {
  const { createMockPool } = await import("./support/mockPool");
  return { pool: createMockPool() };
});

vi.mock("../src/mail", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendTemplate: vi.fn().mockResolvedValue(true),
}));

let app: Express;
let pool: MockPool;

const PASSWORD = "motdepasse123";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const USER_ID = 7;

async function loginAgent() {
  const agent = request.agent(app);

  pool.once(/SELECT id, email, display_name, password_hash/, [
    {
      id: USER_ID,
      email: "martin@heig-vd.ch",
      display_name: "Martin Dupont",
      password_hash: PASSWORD_HASH,
      email_verified_at: new Date().toISOString(),
      role: "user",
      is_blocked: 0,
    },
  ]);

  const res = await agent
    .post("/auth/login")
    .send({ email: "martin@heig-vd.ch", password: PASSWORD });
  expect(res.status).toBe(200);

  // Toutes les requetes suivantes passeront par requireAuth.
  pool.on(/SELECT email, email_verified_at, is_blocked FROM users/, [
    {
      email: "martin@heig-vd.ch",
      email_verified_at: new Date().toISOString(),
      is_blocked: 0,
    },
  ]);

  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  ({ pool } = (await import("../src/db")) as unknown as { pool: MockPool });
});

beforeEach(() => {
  pool.reset();
});

// ---------------------------------------------------------------------------
// Centre de notifications
// ---------------------------------------------------------------------------

describe("GET /notifications", () => {
  it("refuse un visiteur non connecte", async () => {
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(401);
  });

  it("renvoie mes notifications et le nombre de non-lues", async () => {
    const agent = await loginAgent();

    pool.on(/FROM notifications n/, [
      {
        id: 3,
        type: "listing_interest",
        title: "Sofia est interesse par « Calculatrice »",
        body: null,
        link: "listing.html?id=42",
        listing_id: 42,
        actor_id: 9,
        actor_name: "Sofia",
        read_at: null,
        created_at: "2026-09-01T10:00:00.000Z",
      },
    ]);
    pool.on(/COUNT\(\*\) AS unread FROM notifications/, [{ unread: 1 }]);

    const res = await agent.get("/notifications");

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0]).toMatchObject({
      id: 3,
      type: "listing_interest",
      link: "listing.html?id=42",
      read: false,
    });
  });

  it("ne lit que les notifications de la session", async () => {
    const agent = await loginAgent();

    pool.on(/FROM notifications n/, []);
    pool.on(/COUNT\(\*\) AS unread FROM notifications/, [{ unread: 0 }]);

    await agent.get("/notifications");

    const call = pool.calls.find((c) => /FROM notifications n/.test(c.sql));
    expect(call?.sql).toContain("WHERE n.user_id = ?");
    expect(call?.params).toContain(USER_ID);
  });
});

describe("POST /notifications/read-all", () => {
  it("marque toutes mes notifications comme lues", async () => {
    const agent = await loginAgent();

    pool.on(/UPDATE notifications SET read_at/, { affectedRows: 4 });

    const res = await agent.post("/notifications/read-all");

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(4);
    const call = pool.calls.find((c) => /UPDATE notifications/.test(c.sql));
    expect(call?.params).toContain(USER_ID);
  });
});

describe("DELETE /notifications/:id", () => {
  it("renvoie 404 quand la notification n'est pas la mienne", async () => {
    const agent = await loginAgent();

    pool.on(/DELETE FROM notifications/, { affectedRows: 0 });

    const res = await agent.delete("/notifications/999");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Signalement d'une annonce
// ---------------------------------------------------------------------------

describe("POST /reports", () => {
  it("refuse un visiteur non connecte", async () => {
    const res = await request(app)
      .post("/reports")
      .send({ listingId: 42, reason: "contenu inapproprie" });
    expect(res.status).toBe(401);
  });

  it("refuse de signaler sa propre annonce", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT id, owner_id, title FROM listings/, [
      { id: 42, owner_id: USER_ID, title: "Calculatrice" },
    ]);

    const res = await agent
      .post("/reports")
      .send({ listingId: 42, reason: "test" });

    expect(res.status).toBe(400);
  });

  it("refuse un second signalement encore en attente", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT id, owner_id, title FROM listings/, [
      { id: 42, owner_id: 99, title: "Calculatrice" },
    ]);
    pool.on(/FROM reports WHERE listing_id = \? AND reporter_id/, [{ id: 5 }]);

    const res = await agent
      .post("/reports")
      .send({ listingId: 42, reason: "arnaque" });

    expect(res.status).toBe(409);
  });

  it("enregistre le signalement et previent les administrateurs", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT id, owner_id, title FROM listings/, [
      { id: 42, owner_id: 99, title: "Calculatrice" },
    ]);
    pool.on(/FROM reports WHERE listing_id = \? AND reporter_id/, []);
    pool.on(/INSERT INTO reports/, { insertId: 11 });
    pool.on(/FROM users WHERE role = 'admin'/, [{ id: 1 }]);
    pool.on(/INSERT INTO notifications/, { insertId: 21 });

    const res = await agent
      .post("/reports")
      .send({ listingId: 42, reason: "arnaque" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 11, listingId: 42, status: "open" });

    const notification = pool.calls.find((c) =>
      /INSERT INTO notifications/.test(c.sql)
    );
    // L'admin (id 1) est bien le destinataire, l'auteur du signalement l'acteur.
    expect(notification?.params[0]).toBe(1);
    expect(notification?.params[1]).toBe("report_created");
  });
});
