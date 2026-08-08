import mysql from "mysql2/promise";

const dbHost = process.env.DB_HOST ?? "localhost";
const dbPort = Number(process.env.DB_PORT ?? 3306);
const dbDatabase = process.env.MARIADB_DATABASE ?? "heig_echange";
const dbUser = process.env.MARIADB_USER ?? "heig";

// Aucun secret ici : sert a verifier rapidement, au demarrage, que la config
// .env de cette instance a bien ete reprise (utile en cas de doute sur des
// ports/instances customises, cf. .env.example).
console.log(`BDD configuree -> ${dbUser}@${dbHost}:${dbPort}/${dbDatabase}`);

export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: process.env.MARIADB_PASSWORD ?? "",
  database: dbDatabase,
  waitForConnections: true,
  connectionLimit: 10,
});
