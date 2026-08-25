import mysql from "mysql2/promise";

const dbHost = process.env.DB_HOST ?? "localhost";
const dbPort = Number(process.env.DB_PORT ?? 3306);
const dbDatabase = process.env.MARIADB_DATABASE ?? "heig_echange";
const dbUser = process.env.MARIADB_USER ?? "heig";
const dbPass = process.env.MARIADB_PASSWORD ?? "changemepass";

// check config .env de l instance 
console.log(`BDD configuree -> ${dbUser}@${dbHost}:${dbPort}/${dbDatabase}`);

export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbDatabase,
  waitForConnections: true,
  connectionLimit: 10,
});
