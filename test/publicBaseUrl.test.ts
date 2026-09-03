import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// PUBLIC_BASE_URL est lu une seule fois, a l'import du module de config. Pour
// tester plusieurs valeurs il faut donc reinitialiser le registre de modules
// et re-importer — d'ou les imports dynamiques ci-dessous.
const ORIGINAL = process.env.PUBLIC_BASE_URL;

async function loadConfig(baseUrl?: string) {
  vi.resetModules();
  if (baseUrl === undefined) {
    delete process.env.PUBLIC_BASE_URL;
  } else {
    process.env.PUBLIC_BASE_URL = baseUrl;
  }
  return import("../src/config");
}

describe("PUBLIC_BASE_URL", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = ORIGINAL;
    }
    vi.resetModules();
  });

  it("retombe sur localhost en l'absence de variable d'environnement", async () => {
    const { PUBLIC_BASE_URL } = await loadConfig(undefined);
    expect(PUBLIC_BASE_URL).toBe("http://localhost:3000");
  });

  it("prend le domaine de production quand la variable est definie", async () => {
    const { PUBLIC_BASE_URL } = await loadConfig("https://echange.heig-vd.ch");
    expect(PUBLIC_BASE_URL).toBe("https://echange.heig-vd.ch");
  });

  it("retire le ou les slashs finaux pour eviter les '//' dans les liens", async () => {
    const { PUBLIC_BASE_URL, absoluteUrl } = await loadConfig(
      "https://echange.heig-vd.ch///"
    );
    expect(PUBLIC_BASE_URL).toBe("https://echange.heig-vd.ch");
    expect(absoluteUrl("/uploads/photo.jpg")).toBe(
      "https://echange.heig-vd.ch/uploads/photo.jpg"
    );
  });
});

describe("absoluteUrl", () => {
  afterEach(async () => {
    if (ORIGINAL === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = ORIGINAL;
    }
    vi.resetModules();
  });

  it("prefixe un chemin d'image du domaine public", async () => {
    const { absoluteUrl } = await loadConfig("https://echange.heig-vd.ch");
    expect(absoluteUrl("/uploads/abc.jpg")).toBe(
      "https://echange.heig-vd.ch/uploads/abc.jpg"
    );
    // Sans slash initial non plus.
    expect(absoluteUrl("uploads/abc.jpg")).toBe(
      "https://echange.heig-vd.ch/uploads/abc.jpg"
    );
  });

  it("laisse intacte une URL deja absolue", async () => {
    const { absoluteUrl } = await loadConfig("https://echange.heig-vd.ch");
    expect(absoluteUrl("https://cdn.example.org/x.png")).toBe(
      "https://cdn.example.org/x.png"
    );
  });

  it("renvoie null pour une absence de photo", async () => {
    const { absoluteUrl } = await loadConfig("https://echange.heig-vd.ch");
    expect(absoluteUrl(null)).toBeNull();
    expect(absoluteUrl(undefined)).toBeNull();
    expect(absoluteUrl("")).toBeNull();
  });
});

describe("gabarits d'email", () => {
  afterEach(async () => {
    if (ORIGINAL === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = ORIGINAL;
    }
    vi.resetModules();
  });

  async function loadTemplates(baseUrl: string) {
    vi.resetModules();
    process.env.PUBLIC_BASE_URL = baseUrl;
    return import("../src/mailTemplates");
  }

  it("construit les liens sur le domaine public, jamais sur localhost", async () => {
    const templates = await loadTemplates("https://echange.heig-vd.ch");

    const welcome = templates.welcomeVerificationEmail(
      "martin@heig-vd.ch",
      "Martin",
      "12345678"
    );

    expect(welcome.body).toContain("https://echange.heig-vd.ch/verify.html");
    expect(welcome.body).not.toContain("localhost");
    // Le code doit bien figurer dans le message, sinon l'email ne sert a rien.
    expect(welcome.body).toContain("12345678");
    // L'adresse est encodee dans le lien pour pre-remplir le formulaire.
    expect(welcome.body).toContain("martin%40heig-vd.ch");
  });

  it("annonce la suspension et rappelle que les annonces reapparaissent", async () => {
    const templates = await loadTemplates("https://echange.heig-vd.ch");
    const mail = templates.accountSuspendedEmail(
      "martin@heig-vd.ch",
      "Martin",
      "87654321"
    );

    expect(mail.subject).toMatch(/suspendu/i);
    expect(mail.body).toContain("87654321");
    expect(mail.body).toContain("https://echange.heig-vd.ch/verify.html");
  });

  it("adapte le delai annonce dans le rappel", async () => {
    const templates = await loadTemplates("https://echange.heig-vd.ch");

    expect(
      templates.reverificationReminderEmail("a@heig-vd.ch", "A", "1", 14).subject
    ).toContain("14 jours");
    expect(
      templates.reverificationReminderEmail("a@heig-vd.ch", "A", "1", 1).subject
    ).toContain("moins de 24 heures");
  });
});
