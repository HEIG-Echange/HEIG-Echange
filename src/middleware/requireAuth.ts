import type { Request, Response, NextFunction } from "express";

// A poser devant toute route qui necessite un utilisateur connecte.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "vous devez etre connecte" });
    return;
  }

  next();
}
