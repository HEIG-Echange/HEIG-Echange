import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.MARIADB_USER ?? "heig",
  password: process.env.MARIADB_PASSWORD ?? "",
  database: process.env.MARIADB_DATABASE ?? "heig_echange",
  waitForConnections: true,
  connectionLimit: 10,
});
