import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import type { MockPool } from "./support/mockPool";

// Domaine public fixe pour tout ce fichier : c'est lui qui doit apparaitre
// dans les liens de partage, jamais "localhost".
const BASE_URL = "https://echange.heig-vd.ch";
process.env.PUBLIC_BASE_URL = BASE_URL;

vi.mock("../src/db", async () => {
  const { createMockPool } = await import("./support/mockPool");
  return { pool: createMockPool() };
});

// L'envoi d'email part en HTTP vers un service externe : hors sujet ici.
vi.mock("../src/mail", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendTemplate: vi.fn().mockResolvedValue(true),
}));

let app: Express;
let pool: MockPool;

const PASSWORD = "motdepasse123";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

/** Ligne telle que la renvoie LISTING_SELECT. */
function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    owner_id: 7,
    owner_name: "Martin Dupont",
    owner_email: "martin@heig-vd.ch",
    category_id: 3,
    category_slug: "electronique",
    category_label: "Electronique & informatique",
    title: "Calculatrice HP Prime G2",
    description: "Utilisee pendant 2 semestres, en parfait etat.",
    item_condition: "tres_bon",
    status: "available",
    location: "Y-Parc",
    photo_url: "/uploads/calc.jpg",
    photo_count: 3,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    closed_at: null,
    ...overrides,
  };
}

/** Ouvre une session pour l'utilisateur 7, actif et confirme. */
async function loginAgent() {
  const agent = request.agent(app);

  pool.once(/SELECT id, email, display_name, password_hash/, [
    {
      id: 7,
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
// Liens de partage
// ---------------------------------------------------------------------------

describe("liens de partage d'une annonce", () => {
  beforeEach(() => {
    pool.on(/FROM listings l/, [listingRow()]);
    pool.on(/FROM listing_photos WHERE listing_id/, [
      { id: 1, url: "/uploads/calc.jpg", position: 0 },
      { id: 2, url: "/uploads/calc-2.jpg", position: 1 },
    ]);
  });

  it("construit shareUrl et qrUrl sur PUBLIC_BASE_URL", async () => {
    const res = await request(app).get("/listings/42");

    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toBe(`${BASE_URL}/listing.html?id=42`);
    expect(res.body.qrUrl).toBe(`${BASE_URL}/listings/42/qr`);
    expect(JSON.stringify(res.body)).not.toContain("localhost");
  });

  it("expose les photos en relatif ET en absolu", async () => {
    const res = await request(app).get("/listings/42");

    // Le chemin relatif reste celui que consomme le frontend...
    expect(res.body.photoUrl).toBe("/uploads/calc.jpg");
    // ...et la version absolue sert au partage (mail, QR, og:image).
    expect(res.body.photoAbsoluteUrl).toBe(`${BASE_URL}/uploads/calc.jpg`);
    expect(res.body.photos).toHaveLength(2);
    expect(res.body.photos[1].absoluteUrl).toBe(`${BASE_URL}/uploads/calc-2.jpg`);
  });

  it("remonte le nombre de photos pour la pastille '+N' des cartes", async () => {
    const res = await request(app).get("/listings/42");
    expect(res.body.photoCount).toBe(3);
  });

  it("masque les coordonnees du proprietaire a un visiteur anonyme", async () => {
    const res = await request(app).get("/listings/42");
    expect(res.body.ownerEmail).toBeNull();
    expect(res.body.ownerName).toBeNull();
  });
});

describe("GET /listings/:id/qr", () => {
  it("renvoie un SVG", async () => {
    pool.on(/FROM listings l/, [{ id: 42 }]);

    const res = await request(app).get("/listings/42/qr");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    // supertest traite l'image/svg+xml comme du binaire : le contenu arrive
    // dans res.body sous forme de Buffer, pas dans res.text.
    expect(res.body.toString("utf8")).toContain("<svg");
  });

  it("encode bien l'URL publique de l'annonce, pas localhost", async () => {
    // Le QR est genere a partir de listingShareUrl : on verifie la source du
    // lien plutot que d'essayer de decoder l'image.
    const { listingShareUrl } = await import("../src/routes/listings");
    expect(listingShareUrl(42)).toBe(`${BASE_URL}/listing.html?id=42`);
  });

  it("renvoie 404 pour une annonce inexistante ou masquee", async () => {
    pool.on(/FROM listings l/, []);
    const res = await request(app).get("/listings/999/qr");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Masquage des annonces des comptes suspendus
// ---------------------------------------------------------------------------

describe("visibilite selon l'etat du proprietaire", () => {
  it("filtre les annonces sur un proprietaire actif et confirme", async () => {
    pool.on(/FROM listings l/, [listingRow()]);

    await request(app).get("/listings");

    const sql = pool.calls[0].sql;
    expect(sql).toContain("u.deleted_at IS NULL");
    expect(sql).toContain("u.is_blocked = FALSE");
    // C'est ce fragment qui masque les annonces d'un compte non reconfirme
    // depuis 6 mois.
    expect(sql).toContain("u.email_verified_at IS NOT NULL");
    expect(sql).toContain("INTERVAL 180 DAY");
  });

  it("applique le meme filtre a la fiche detail", async () => {
    pool.on(/FROM listings l/, []);

    const res = await request(app).get("/listings/42");

    expect(res.status).toBe(404);
    expect(pool.calls[0].sql).toContain("INTERVAL 180 DAY");
  });
});

// ---------------------------------------------------------------------------
// Edition d'une annonce publiee
// ---------------------------------------------------------------------------

describe("PATCH /listings/:id", () => {
  it("refuse un visiteur non connecte", async () => {
    const res = await request(app).patch("/listings/42").send({ title: "Nouveau" });
    expect(res.status).toBe(401);
  });

  it("laisse le proprietaire modifier son annonce", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/UPDATE listings SET/, { affectedRows: 1 });
    pool.on(/FROM listings l/, [listingRow({ title: "Titre corrige" })]);

    const res = await agent
      .patch("/listings/42")
      .send({ title: "Titre corrige", location: "  HEIG-VD  " });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Titre corrige");

    const update = pool.calls.find((c) => /UPDATE listings SET/.test(c.sql));
    expect(update?.sql).toContain("title = ?");
    // Le lieu est nettoye de ses espaces avant enregistrement.
    expect(update?.params).toContain("HEIG-VD");
  });

  it("refuse la modification par quelqu'un d'autre", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 99 }]);
    pool.on(/SELECT role FROM users/, [{ role: "user" }]);

    const res = await agent.patch("/listings/42").send({ title: "Pirate" });

    expect(res.status).toBe(403);
  });

  it("accepte de passer l'annonce en 'donnee' et horodate la cloture", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/UPDATE listings SET/, { affectedRows: 1 });
    pool.on(/FROM listings l/, [listingRow({ status: "closed" })]);

    const res = await agent.patch("/listings/42").send({ status: "closed" });

    expect(res.status).toBe(200);
    const update = pool.calls.find((c) => /UPDATE listings SET/.test(c.sql));
    expect(update?.sql).toContain("status = ?");
    expect(update?.sql).toContain("closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)");
  });

  it("efface closed_at quand l'annonce est remise en ligne", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/UPDATE listings SET/, { affectedRows: 1 });
    pool.on(/FROM listings l/, [listingRow()]);

    await agent.patch("/listings/42").send({ status: "available" });

    const update = pool.calls.find((c) => /UPDATE listings SET/.test(c.sql));
    expect(update?.sql).toContain("closed_at = NULL");
  });

  it("rejette un statut inconnu", async () => {
    const agent = await loginAgent();
    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);

    const res = await agent.patch("/listings/42").send({ status: "vendue" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/);
  });

  it("rejette une requete sans aucun champ a modifier", async () => {
    const agent = await loginAgent();
    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);

    const res = await agent.patch("/listings/42").send({});

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Photos multiples
// ---------------------------------------------------------------------------

// Le plus petit GIF valide : suffit a traverser le filtre MIME de multer sans
// embarquer un fichier binaire dans le depot.
const TINY_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

describe("POST /listings/:id/photos", () => {
  it("accepte plusieurs fichiers en une requete et les positionne a la suite", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/COALESCE\(MAX\(position\)/, [{ total: 1, next_position: 1 }]);
    let insertId = 100;
    pool.on(/INSERT INTO listing_photos/, () => ({ insertId: insertId++ }));

    const res = await agent
      .post("/listings/42/photos")
      .attach("photos", TINY_GIF, "a.gif")
      .attach("photos", TINY_GIF, "b.gif");

    expect(res.status).toBe(201);
    expect(res.body.photos).toHaveLength(2);
    expect(res.body.photos[0].position).toBe(1);
    expect(res.body.photos[1].position).toBe(2);
    expect(res.body.photos[0].absoluteUrl).toContain(BASE_URL);
  });

  it("conserve la reponse historique (objet seul) pour un envoi unique", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/COALESCE\(MAX\(position\)/, [{ total: 0, next_position: 0 }]);
    pool.on(/INSERT INTO listing_photos/, { insertId: 100 });

    const res = await agent
      .post("/listings/42/photos")
      .attach("photo", TINY_GIF, "a.gif");

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(100);
    expect(res.body.position).toBe(0);
    expect(res.body.photos).toBeUndefined();
  });

  it("refuse de depasser le plafond de photos", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/COALESCE\(MAX\(position\)/, [{ total: 10, next_position: 10 }]);

    const res = await agent
      .post("/listings/42/photos")
      .attach("photos", TINY_GIF, "a.gif");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10 photos/);
  });

  it("refuse un fichier qui n'est pas une image", async () => {
    const agent = await loginAgent();

    const res = await agent
      .post("/listings/42/photos")
      .attach("photos", Buffer.from("pas une image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format d'image/);
  });
});

describe("DELETE /listings/:id/photos/:photoId", () => {
  it("retire la photo et retasse les positions suivantes", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/SELECT id, url, position FROM listing_photos WHERE id/, [
      { id: 2, url: "/uploads/b.jpg", position: 1 },
    ]);
    pool.on(/DELETE FROM listing_photos/, { affectedRows: 1 });
    pool.on(/UPDATE listing_photos SET position = position - 1/, {
      affectedRows: 2,
    });

    const res = await agent.delete("/listings/42/photos/2");

    expect(res.status).toBe(204);
    expect(
      pool.calls.some((c) =>
        /UPDATE listing_photos SET position = position - 1/.test(c.sql)
      )
    ).toBe(true);
  });

  it("renvoie 404 si la photo n'appartient pas a l'annonce", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/SELECT id, url, position FROM listing_photos WHERE id/, []);

    const res = await agent.delete("/listings/42/photos/999");

    expect(res.status).toBe(404);
  });

  it("refuse la suppression par un tiers", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 99 }]);
    pool.on(/SELECT role FROM users/, [{ role: "user" }]);

    const res = await agent.delete("/listings/42/photos/2");

    expect(res.status).toBe(403);
  });
});

describe("PATCH /listings/:id/photos (reordonner)", () => {
  it("reecrit les positions dans l'ordre fourni", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/SELECT id, url, position FROM listing_photos WHERE listing_id = \?$/, [
      { id: 1, url: "/uploads/a.jpg", position: 0 },
      { id: 2, url: "/uploads/b.jpg", position: 1 },
    ]);
    pool.on(/UPDATE listing_photos SET position = \?/, { affectedRows: 1 });
    pool.on(/ORDER BY position ASC/, [
      { id: 2, url: "/uploads/b.jpg", position: 0 },
      { id: 1, url: "/uploads/a.jpg", position: 1 },
    ]);

    const res = await agent
      .patch("/listings/42/photos")
      .send({ photoIds: [2, 1] });

    expect(res.status).toBe(200);
    expect(res.body.photos[0].id).toBe(2);
  });

  it("exige la liste complete des photos de l'annonce", async () => {
    const agent = await loginAgent();

    pool.on(/SELECT owner_id FROM listings/, [{ owner_id: 7 }]);
    pool.on(/SELECT id, url, position FROM listing_photos WHERE listing_id/, [
      { id: 1, url: "/uploads/a.jpg", position: 0 },
      { id: 2, url: "/uploads/b.jpg", position: 1 },
    ]);

    const res = await agent.patch("/listings/42/photos").send({ photoIds: [2] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exactement une fois/);
  });
});

// ---------------------------------------------------------------------------
// Config publique
// ---------------------------------------------------------------------------

describe("GET /config", () => {
  it("annonce au frontend le domaine public et les limites metier", async () => {
    const res = await request(app).get("/config");

    expect(res.status).toBe(200);
    expect(res.body.publicBaseUrl).toBe(BASE_URL);
    expect(res.body.maxPhotosPerListing).toBe(10);
    expect(res.body.reverificationIntervalDays).toBe(180);
  });
});
