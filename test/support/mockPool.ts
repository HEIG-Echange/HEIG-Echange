import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Faux pool mysql2 pour les tests de routes.
//
// Les tests d'API de ce projet ne montent pas de MariaDB : on remplace
// src/db par ce pool, qui repond en fonction du SQL recu. Chaque test declare
// les requetes qu'il attend avec `on(motif, reponse)` ; toute requete non
// prevue leve une erreur explicite plutot que de renvoyer un resultat vide
// silencieux (qui donnerait un test vert pour de mauvaises raisons).
// ---------------------------------------------------------------------------

export type QueryParams = unknown[];

interface Handler {
  match: RegExp;
  respond: (params: QueryParams, sql: string) => unknown;
  once: boolean;
  used: boolean;
}

export interface MockPool {
  query: ReturnType<typeof vi.fn>;
  /** Declare une reponse pour toute requete dont le SQL matche `match`. */
  on(match: RegExp, respond: unknown | ((params: QueryParams, sql: string) => unknown)): MockPool;
  /** Comme `on`, mais ne sert qu'une fois (requetes successives differentes). */
  once(match: RegExp, respond: unknown | ((params: QueryParams, sql: string) => unknown)): MockPool;
  /** SQL de toutes les requetes recues, dans l'ordre. */
  readonly calls: { sql: string; params: QueryParams }[];
  reset(): void;
}

export function createMockPool(): MockPool {
  let handlers: Handler[] = [];
  const calls: { sql: string; params: QueryParams }[] = [];

  const query = vi.fn(async (sql: string, params: QueryParams = []) => {
    calls.push({ sql, params });

    const handler = handlers.find(
      (h) => h.match.test(sql) && !(h.once && h.used)
    );

    if (!handler) {
      throw new Error(
        `Requete SQL non prevue par le test :\n${sql.trim().slice(0, 300)}`
      );
    }
    handler.used = true;

    const value =
      typeof handler.respond === "function"
        ? handler.respond(params, sql)
        : handler.respond;

    // mysql2 renvoie toujours [rows, fields] : on respecte cette forme pour
    // que le code de production soit teste tel quel.
    return Array.isArray(value) && value.length === 2 && Array.isArray(value[0])
      ? value
      : [value, []];
  });

  const pool: MockPool = {
    query,
    on(match, respond) {
      handlers.push({
        match,
        respond: respond as Handler["respond"],
        once: false,
        used: false,
      });
      return pool;
    },
    once(match, respond) {
      handlers.push({
        match,
        respond: respond as Handler["respond"],
        once: true,
        used: false,
      });
      return pool;
    },
    get calls() {
      return calls;
    },
    reset() {
      handlers = [];
      calls.length = 0;
      query.mockClear();
    },
  };

  return pool;
}
