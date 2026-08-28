// Tests de la couche de stockage des images (src/storage.ts) et de la route
// qui les sert (src/routes/media.ts).
//
// MINIO_ENDPOINT n'est pas defini ici : le backend de repli (disque) est actif,
// et c'est justement lui qu'on veut verifier — la CI n'a pas de MinIO. La
// logique commune aux deux backends (validation des cles, forme des URL,
// en-tetes HTTP, 404, 304) est integralement couverte.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import request from "supertest";
import type { Express } from "express";

const UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "heig-uploads-"));
process.env.UPLOAD_DIR = UPLOAD_DIR;

let app: Express;
let storage: typeof import("../src/storage");

beforeAll(async () => {
  storage = await import("../src/storage");
  ({ app } = await import("../src/app"));
});

afterAll(async () => {
  await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
});

describe("cles d'objet", () => {
  it("range les nouvelles photos par annee/mois avec un nom aleatoire", () => {
    const key = storage.buildObjectKey("image/jpeg");
    expect(key).toMatch(/^listings\/\d{4}\/\d{2}\/\d+-[0-9a-f]{16}\.jpg$/);
    expect(storage.buildObjectKey("image/jpeg")).not.toBe(key);
  });

  it("fait l'aller-retour entre cle et url publique", () => {
    const key = storage.buildObjectKey("image/png");
    expect(storage.keyFromUrl(storage.urlFromKey(key))).toBe(key);
  });

  it("relit les urls plates d'avant la migration vers MinIO", () => {
    expect(storage.keyFromUrl("/uploads/1712-abcd.jpg")).toBe("1712-abcd.jpg");
  });

  it("refuse les cles qui sortent du stockage ou viennent d'ailleurs", () => {
    for (const url of [
      "/uploads/../package.json",
      "/uploads/a/../../etc/passwd",
      "/uploads/",
      "https://exemple.ch/photo.jpg",
      null,
    ]) {
      expect(storage.keyFromUrl(url)).toBeNull();
    }
  });
});

describe("ecriture / lecture / suppression", () => {
  it("ecrit puis relit le contenu exact, et le retire", async () => {
    const key = storage.buildObjectKey("image/png");
    const body = Buffer.from("de-faux-octets-png");

    await storage.saveObject(key, body, "image/png");

    const object = await storage.openObject(key);
    expect(object).not.toBeNull();
    expect(object!.contentType).toBe("image/png");
    expect(object!.size).toBe(body.length);

    const chunks: Buffer[] = [];
    for await (const chunk of object!.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe(body.toString());

    await storage.deleteObject(key);
    expect(await storage.openObject(key)).toBeNull();
  });

  it("renvoie null pour une cle inconnue ou invalide", async () => {
    expect(await storage.openObject("listings/2026/08/absente.jpg")).toBeNull();
    expect(await storage.openObject("../package.json")).toBeNull();
  });
});

describe("GET /uploads/:cle", () => {
  it("sert l'image avec son type, sa taille et un cache long", async () => {
    const key = storage.buildObjectKey("image/gif");
    const body = Buffer.from("GIF89a-faux");
    await storage.saveObject(key, body, "image/gif");

    const res = await request(app).get(storage.urlFromKey(key));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/gif");
    expect(res.headers["content-length"]).toBe(String(body.length));
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers.etag).toBeTruthy();
  });

  it("repond 304 quand le navigateur a deja l'image", async () => {
    const key = storage.buildObjectKey("image/png");
    await storage.saveObject(key, Buffer.from("png"), "image/png");

    const first = await request(app).get(storage.urlFromKey(key));
    const second = await request(app)
      .get(storage.urlFromKey(key))
      .set("If-None-Match", first.headers.etag);

    expect(second.status).toBe(304);
  });

  it("repond 404 pour une image inconnue", async () => {
    const res = await request(app).get("/uploads/listings/2026/08/nope.jpg");
    expect(res.status).toBe(404);
  });

  it("ne laisse pas remonter hors du stockage", async () => {
    for (const url of [
      "/uploads/../package.json",
      "/uploads/%2e%2e%2fpackage.json",
      "/uploads/listings/../../package.json",
    ]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
    }
  });
});
