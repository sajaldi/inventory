const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || `postgres://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`;

if (!connectionString || connectionString.includes('undefined')) {
  console.error('❌ ERROR: Database connection string is invalid or missing environment variables.');
}

const pool = new Pool({
  connectionString: connectionString,
});

pool.on('connect', () => {
  console.log('Connected to the database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: pool
};
