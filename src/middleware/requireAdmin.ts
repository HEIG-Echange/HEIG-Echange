import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";

interface RoleRow extends RowDataPacket {
  role: "user" | "admin";
}

// A poser devant toute route reservee aux admins 
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.session.userId) {
    res.status(401).json({ error: "vous devez etre connecte" });
    return;
  }

  const [rows] = await pool.query<RoleRow[]>(
    "SELECT role FROM users WHERE id = ? AND deleted_at IS NULL",
    [req.session.userId]
  );

  if (rows[0]?.role !== "admin") {
    res.status(403).json({ error: "reserve aux administrateurs" });
    return;
  }

  next();
}
