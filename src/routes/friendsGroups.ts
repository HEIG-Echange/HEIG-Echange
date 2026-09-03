import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db";
import { requireAuth } from "../middleware/requireAuth";

export const friendsGroupsRouter = Router();

interface GroupRow extends RowDataPacket {
  id: number;
  name: string;
  owner_id: number;
  created_at: string;
}

interface MemberRow extends RowDataPacket {
  id: number;
  display_name: string;
  email: string;
  added_at: string;
}

function toGroupJson(row: GroupRow) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

// Charge un groupe et verifie que l'utilisateur connecte en est le
// proprietaire. Renvoie null (et a deja ecrit la reponse d'erreur) si la
// route appelante doit s'arreter la.
async function loadOwnedGroup(
  groupId: number,
  userId: number,
  res: import("express").Response
): Promise<GroupRow | null> {
  const [rows] = await pool.query<GroupRow[]>(
    "SELECT id, name, owner_id, created_at FROM friends_groups WHERE id = ? AND deleted_at IS NULL",
    [groupId]
  );
  const group = rows[0];

  if (!group) {
    res.status(404).json({ error: "groupe introuvable" });
    return null;
  }

  if (group.owner_id !== userId) {
    res.status(403).json({ error: "seul le proprietaire du groupe peut faire ceci" });
    return null;
  }

  return group;
}

// POST /friends-groups — cree un groupe d'amis avec au moins un membre 
friendsGroupsRouter.post("/", requireAuth, async (req, res) => {
  const { name, memberIds } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name est requis" });
    return;
  }

  if (
    !Array.isArray(memberIds) ||
    memberIds.length === 0 ||
    memberIds.some((id) => typeof id !== "number" || !Number.isInteger(id))
  ) {
    res.status(400).json({
      error: "memberIds (tableau d'id non vide) est requis : un groupe ne peut pas etre vide",
    });
    return;
  }

  const uniqueMemberIds = [...new Set(memberIds)] as number[];

  interface UserRow extends RowDataPacket {
    id: number;
  }
  const placeholders = uniqueMemberIds.map(() => "?").join(",");
  const [userRows] = await pool.query<UserRow[]>(
    `SELECT id FROM users WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    uniqueMemberIds
  );
  if (userRows.length !== uniqueMemberIds.length) {
    res.status(400).json({ error: "memberIds invalide : au moins un utilisateur est introuvable" });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO friends_groups (name, owner_id) VALUES (?, ?)",
    [name.trim(), req.session.userId]
  );

  const values = uniqueMemberIds.map(() => "(?, ?)").join(", ");
  const params = uniqueMemberIds.flatMap((id) => [result.insertId, id]);
  await pool.query(
    `INSERT INTO friends_group_members (friends_group_id, user_id) VALUES ${values}`,
    params
  );

  res.status(201).json({
    id: result.insertId,
    name: name.trim(),
    ownerId: req.session.userId,
    memberIds: uniqueMemberIds,
  });
});

// GET /friends-groups — affiche les groupes d'amis de l'utilisateur 
friendsGroupsRouter.get("/", requireAuth, async (req, res) => {
  const [rows] = await pool.query<GroupRow[]>(
    "SELECT id, name, owner_id, created_at FROM friends_groups WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
    [req.session.userId]
  );

  res.json(rows.map(toGroupJson));
});

// PATCH /friends-groups/:id — renomme le groupe
friendsGroupsRouter.patch("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const group = await loadOwnedGroup(id, req.session.userId as number, res);
  if (!group) return;

  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name est requis" });
    return;
  }

  await pool.query("UPDATE friends_groups SET name = ? WHERE id = ?", [
    name.trim(),
    id,
  ]);

  res.json({ id, name: name.trim(), ownerId: group.owner_id });
});

// DELETE /friends-groups/:id — supprime le groupe

friendsGroupsRouter.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const group = await loadOwnedGroup(id, req.session.userId as number, res);
  if (!group) return;

  await pool.query("UPDATE friends_groups SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);

  res.status(204).send();
});

// GET /friends-groups/:id/members — liste des membres
friendsGroupsRouter.get("/:id/members", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const group = await loadOwnedGroup(id, req.session.userId as number, res);
  if (!group) return;

  const [rows] = await pool.query<MemberRow[]>(
    `SELECT u.id, u.display_name, u.email, m.added_at
     FROM friends_group_members m
     JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
     WHERE m.friends_group_id = ?
     ORDER BY m.added_at ASC`,
    [id]
  );

  res.json(
    rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      addedAt: row.added_at,
    }))
  );
});

// POST /friends-groups/:id/members — ajoute un membre par id utilisateur
friendsGroupsRouter.post("/:id/members", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const group = await loadOwnedGroup(id, req.session.userId as number, res);
  if (!group) return;

  const { userId } = req.body ?? {};
  if (typeof userId !== "number" || !Number.isInteger(userId)) {
    res.status(400).json({ error: "userId (nombre) est requis" });
    return;
  }

  interface UserRow extends RowDataPacket {
    id: number;
  }
  const [userRows] = await pool.query<UserRow[]>(
    "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL",
    [userId]
  );
  if (userRows.length === 0) {
    res.status(404).json({ error: "utilisateur introuvable" });
    return;
  }

  try {
    await pool.query(
      "INSERT INTO friends_group_members (friends_group_id, user_id) VALUES (?, ?)",
      [id, userId]
    );
    res.status(201).json({ friendsGroupId: id, userId });
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      // si deja membre , on renovoi 200
      res.status(200).json({ friendsGroupId: id, userId });
      return;
    }
    throw err;
  }
});

// DELETE /friends-groups/:id/members/:userId — supprime un membre du groupe
friendsGroupsRouter.delete("/:id/members/:userId", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(id) || !Number.isInteger(userId)) {
    res.status(400).json({ error: "id invalide" });
    return;
  }

  const group = await loadOwnedGroup(id, req.session.userId as number, res);
  if (!group) return;

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM friends_group_members WHERE friends_group_id = ? AND user_id = ?",
    [id, userId]
  );

  if (result.affectedRows === 0) {
    res.status(404).json({ error: "cette personne n'est pas membre du groupe" });
    return;
  }

  res.status(204).send();
});
