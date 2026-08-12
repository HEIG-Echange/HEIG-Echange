import session from "express-session";
import express from "express";
import path from "path";
import { authRouter } from "./routes/auth";
import { listingsRouter } from "./routes/listings";
import { categoriesRouter } from "./routes/categories";
import { reportsRouter } from "./routes/reports";
import { adminRouter } from "./routes/admin";

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

app.use("/auth", authRouter);
app.use("/listings", listingsRouter);
app.use("/categories", categoriesRouter);
app.use("/reports", reportsRouter);
app.use("/admin", adminRouter);

// Frontend statique (public/) — sert l'app web mobile-first.
app.use(express.static(path.join(process.cwd(), "public")));
