import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  charset: 'utf8mb4',
});

export async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function withTransaction(fn) {
  const connection = await pool.getConnection();
  const conn = {
    query: (...args) => connection.query(...args),
    // Prepared statements hang on some shared hostings; use text protocol.
    execute: (...args) => connection.query(...args),
  };
  try {
    await connection.beginTransaction();
    const result = await fn(conn);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
