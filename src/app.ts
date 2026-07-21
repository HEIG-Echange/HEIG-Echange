import express from "express";

export const app = express();

app.get("/", (_req, res) => {
  res.send("<h1>Hello World</h1>");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
