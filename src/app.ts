import session from "express-session";
import express from "express";
import { authRouter } from "./routes/auth";
import { listingsRouter } from "./routes/listings";

export const app = express();

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
    },
  })
);


app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
