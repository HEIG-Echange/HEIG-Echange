import mysql from "mysql2/promise";

// Pool de connexions vers MariaDB (service "db" dans compose.yaml).
// En local sans Docker, DB_HOST/DB_PORT peuvent etre surcharges dans .env
// pour pointer vers une instance MariaDB qui tourne autrement.
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.MARIADB_USER ?? "heig",
  password: process.env.MARIADB_PASSWORD ?? "",
  database: process.env.MARIADB_DATABASE ?? "heig_echange",
  waitForConnections: true,
  connectionLimit: 10,
});
