const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: '181.115.47.107',
    database: 'db',
    password: 'PasswordRoot07',
    port: 5432
    // ssl removed
});

async function testConnection() {
    try {
        console.log('Intentando conectar a PostgreSQL...');
        const client = await pool.connect();
        console.log('✅ Conexión exitosa');

        const res = await client.query('SELECT NOW() as now');
        console.log('🕒 Hora del servidor Postgres:', res.rows[0].now);

        client.release();
        pool.end();
    } catch (err) {
        console.error('❌ Error de conexión:', err.message);
        pool.end();
    }
}

testConnection();
