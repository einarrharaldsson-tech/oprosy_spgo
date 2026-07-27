import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function runMigrations(conn) {
  const alters = [
    `ALTER TABLE responses ADD COLUMN audio_path VARCHAR(500) NULL AFTER respondent_note`,
    `ALTER TABLE responses ADD COLUMN audio_mime VARCHAR(64) NULL AFTER audio_path`,
    `ALTER TABLE responses ADD COLUMN audio_size INT UNSIGNED NULL AFTER audio_mime`,
    `ALTER TABLE responses ADD COLUMN audio_duration_sec INT UNSIGNED NULL AFTER audio_size`,
    `ALTER TABLE questions MODIFY COLUMN answer_type ENUM('checkbox', 'text', 'select', 'address') NOT NULL DEFAULT 'checkbox'`,
    `ALTER TABLE questions ADD COLUMN allow_multiple TINYINT(1) NOT NULL DEFAULT 1 AFTER is_required`,
    `ALTER TABLE options ADD COLUMN jump_action ENUM('none', 'jump', 'end') NOT NULL DEFAULT 'none' AFTER text`,
    `ALTER TABLE options ADD COLUMN jump_target_question_id INT UNSIGNED NULL AFTER jump_action`,
    `ALTER TABLE surveys MODIFY COLUMN status ENUM('draft', 'active', 'completed', 'archived') NOT NULL DEFAULT 'draft'`,
    `ALTER TABLE surveys ADD COLUMN completed_at TIMESTAMP NULL AFTER archived_at`,
    `ALTER TABLE surveys ADD COLUMN conduct_mode ENUM('scroll', 'step') NOT NULL DEFAULT 'scroll' AFTER description`,
  ];
  for (const sql of alters) {
    try {
      await conn.query(sql);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }
  try {
    await conn.query(
      `ALTER TABLE options
       ADD CONSTRAINT fk_options_jump_target
       FOREIGN KEY (jump_target_question_id) REFERENCES questions(id) ON DELETE SET NULL`
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_CANT_CREATE_TABLE') throw err;
  }
  console.log('Migrations applied.');
}

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'oprosy';

  const schemaPath = path.resolve(__dirname, '../../../database/schema.sql');
  let schema = fs.readFileSync(schemaPath, 'utf8');
  schema = schema
    .replace(/CREATE DATABASE[\s\S]*?;/gi, '')
    .replace(/USE\s+[\w`]+\s*;/gi, '');

  console.log(`Connecting to MariaDB at ${host}:${port} as ${user}, db ${database}...`);
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  await conn.query(schema);
  console.log('Schema applied.');

  await runMigrations(conn);

  const [admins] = await conn.execute(
    `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
  );

  if (!admins.length) {
    const hash = await bcrypt.hash('admin', 10);
    await conn.execute(
      `INSERT INTO users (login, password_hash, full_name, role)
       VALUES ('admin', ?, 'Администратор', 'admin')`,
      [hash]
    );
    console.log('Created default admin: login=admin, password=admin');
    console.log('Смените пароль после первого входа!');
  } else {
    console.log('Admin user already exists, skip seed.');
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
