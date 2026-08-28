import session from "express-session";
import express from "express";
import path from "path";
import multer from "multer";
import { authRouter } from "./routes/auth";
import { listingsRouter } from "./routes/listings";
import { categoriesRouter } from "./routes/categories";
import { reportsRouter } from "./routes/reports";
import { adminRouter } from "./routes/admin";
import { usersRouter } from "./routes/users";
import { mediaRouter } from "./routes/media";
import { PUBLIC_BASE_URL } from "./config";
import { MAX_PHOTOS_PER_LISTING } from "./routes/listings";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_PHOTO_SIZE_BYTES,
} from "./upload";
import { EMAIL_REVERIFICATION_INTERVAL_DAYS } from "./auth/emailVerification";

export const app = express();

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Cf. .env.example : reste a false tant qu'aucun HTTPS ne termine devant
      // l'app (dev local, ou avant mise en place du reverse proxy TLS).
      secure: process.env.COOKIE_SECURE === "true",
    },
  })
);


app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Config publique consommee par le frontend : domaine des liens de partage
// (QR, mailto, images) et quelques constantes metier, pour que le client n'ait
// pas a dupliquer des valeurs qui vivent cote serveur.
app.get("/config", (_req, res) => {
  res.json({
    publicBaseUrl: PUBLIC_BASE_URL,
    maxPhotosPerListing: MAX_PHOTOS_PER_LISTING,
    maxPhotoSizeBytes: MAX_PHOTO_SIZE_BYTES,
    acceptedPhotoMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    reverificationIntervalDays: EMAIL_REVERIFICATION_INTERVAL_DAYS,
  });
});

app.use("/auth", authRouter);
app.use("/listings", listingsRouter);
app.use("/categories", categoriesRouter);
app.use("/reports", reportsRouter);
app.use("/admin", adminRouter);
app.use("/users", usersRouter);

// Images uploadees par les utilisateurs, relayees depuis le stockage objet
// MinIO (GET /uploads/<cle>, voir src/routes/media.ts et src/storage.ts).
app.use(mediaRouter);

// Frontend statique (public/) — sert l'app web mobile-first.
app.use(express.static(path.join(process.cwd(), "public")));

// Gestionnaire d'erreurs JSON. Traduit notamment les erreurs multer (fichier
// trop volumineux, format refuse) en 400 lisibles cote client.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction
  ) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "image trop volumineuse (max 5 Mo)"
          : `upload invalide : ${err.message}`;
      res.status(400).json({ error: message });
      return;
    }
    if (err instanceof Error && /format d'image/.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "erreur interne" });
  }
);
