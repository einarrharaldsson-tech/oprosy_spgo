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
    if (
      err.code !== 'ER_DUP_KEYNAME' &&
      err.code !== 'ER_CANT_CREATE_TABLE' &&
      !String(err.message || '').includes('Duplicate FOREIGN KEY constraint')
    ) {
      throw err;
    }
  }
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS response_upload_sessions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        survey_id INT UNSIGNED NOT NULL,
        conducted_by INT UNSIGNED NOT NULL,
        client_session_id VARCHAR(64) NOT NULL,
        status ENUM('active', 'uploading', 'finalized', 'failed') NOT NULL DEFAULT 'active',
        audio_mime VARCHAR(64) NULL,
        audio_duration_sec INT UNSIGNED NULL,
        total_chunks INT UNSIGNED NOT NULL DEFAULT 0,
        response_id INT UNSIGNED NULL,
        last_error VARCHAR(500) NULL,
        finalized_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_upload_sessions_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
        CONSTRAINT fk_upload_sessions_user FOREIGN KEY (conducted_by) REFERENCES users(id),
        CONSTRAINT fk_upload_sessions_response FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE SET NULL,
        UNIQUE KEY uq_upload_session_client (client_session_id),
        INDEX idx_upload_sessions_survey_user (survey_id, conducted_by, status)
      ) ENGINE=InnoDB
    `);
  } catch (err) {
    if (
      err.code !== 'ER_CANT_CREATE_TABLE' &&
      !String(err.message || '').includes('Duplicate FOREIGN KEY constraint')
    ) {
      throw err;
    }
  }
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS response_upload_chunks (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        upload_session_id INT UNSIGNED NOT NULL,
        chunk_index INT UNSIGNED NOT NULL,
        chunk_size INT UNSIGNED NOT NULL,
        relative_path VARCHAR(500) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_upload_chunks_session FOREIGN KEY (upload_session_id) REFERENCES response_upload_sessions(id) ON DELETE CASCADE,
        UNIQUE KEY uq_upload_chunk (upload_session_id, chunk_index)
      ) ENGINE=InnoDB
    `);
  } catch (err) {
    if (
      err.code !== 'ER_CANT_CREATE_TABLE' &&
      !String(err.message || '').includes('Duplicate FOREIGN KEY constraint')
    ) {
      throw err;
    }
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
    .replace(/USE\s+[\w`]+\s*;/gi, '')
    .replace(/CREATE TABLE IF NOT EXISTS response_upload_sessions \([\s\S]*?\) ENGINE=InnoDB;/i, '')
    .replace(/CREATE TABLE IF NOT EXISTS response_upload_chunks \([\s\S]*?\) ENGINE=InnoDB;/i, '');

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
