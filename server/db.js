const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    };
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'pairup',
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  };
}

const pool = new Pool({ ...buildPoolConfig(), max: 10, idleTimeoutMillis: 30000 });

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, initSchema };
