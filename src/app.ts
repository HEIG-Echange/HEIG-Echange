import express from "express";
import session from "express-session";
import { authRouter } from "./routes/auth";

export const app = express();

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
  })
);

app.get("/", (_req, res) => {
  res.send("<h1>Hello World 2</h1>");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
