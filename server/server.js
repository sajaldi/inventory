const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: '181.115.47.107',
    database: 'db',
    password: 'PasswordRoot07',
    port: 5432
    // ssl: { rejectUnauthorized: false } // Deshabilitado, el servidor no soporta SSL
});

// Test de conexión
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error adquiriendo cliente de BD:', err.stack);
    }
    client.query('SELECT NOW()', (err, result) => {
        release();
        if (err) {
            return console.error('Error ejecutando query de prueba:', err.stack);
        }
        console.log('✅ Conectado a PostgreSQL:', result.rows[0]);
        initDB();
    });
});

// Helper para queries simples (no transaccionales)
async function query(text, params) {
    const res = await pool.query(text, params);
    return res;
}

// Inicializar tablas en PostgreSQL
const initDB = async () => {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS activos (
                id SERIAL PRIMARY KEY,
                sync_id TEXT UNIQUE NOT NULL,
                codigo TEXT UNIQUE NOT NULL,
                nombre TEXT NOT NULL,
                edificio TEXT,
                nivel TEXT,
                categoria TEXT,
                espacio TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted INTEGER DEFAULT 0
            )
        `);

        await query(`
            CREATE TABLE IF NOT EXISTS auditorias (
                id SERIAL PRIMARY KEY,
                sync_id TEXT UNIQUE NOT NULL,
                espacio TEXT,
                fecha TEXT,
                total_esperados INTEGER DEFAULT 0,
                total_escaneados INTEGER DEFAULT 0,
                total_faltantes INTEGER DEFAULT 0,
                total_sobrantes INTEGER DEFAULT 0,
                codigos_escaneados TEXT,
                codigos_faltantes TEXT,
                codigos_sobrantes TEXT,
                estado TEXT DEFAULT 'en_progreso',
                notas TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                plano_id INTEGER
            )
        `);

        // Tabla de Categorías
        await query(`
            CREATE TABLE IF NOT EXISTS categorias (
                id SERIAL PRIMARY KEY,
                sync_id TEXT UNIQUE NOT NULL,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                icono TEXT,
                color TEXT,
                parent_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted INTEGER DEFAULT 0
            )
        `);

        // Indices
        await query(`CREATE INDEX IF NOT EXISTS idx_activos_sync_id ON activos(sync_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_activos_updated_at ON activos(updated_at)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_auditorias_sync_id ON auditorias(sync_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_categorias_sync_id ON categorias(sync_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_categorias_updated_at ON categorias(updated_at)`);

        console.log('✅ Tablas inicializadas en PostgreSQL');
    } catch (error) {
        console.error('Error inicializando BD:', error);
    }
};

// ==================== SINCRONIZACIÓN DE CATEGORÍAS ====================

app.get('/api/categorias', async (req, res) => {
    try {
        const { since } = req.query;
        let text = 'SELECT * FROM categorias WHERE deleted = 0';
        let params = [];

        if (since) {
            text += ' AND updated_at > $1';
            params.push(since);
        }

        text += ' ORDER BY updated_at DESC';
        const { rows } = await query(text, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error obteniendo categorías:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/categorias/sync', async (req, res) => {
    const { categorias } = req.body;
    if (!categorias || !Array.isArray(categorias)) {
        return res.status(400).json({ success: false, error: 'Se requiere un array de categorías' });
    }

    const results = { inserted: 0, updated: 0 };
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        for (const cat of categorias) {
            const { sync_id, nombre, descripcion, icono, color, parent_id, created_at, updated_at } = cat;

            const resExisting = await client.query('SELECT * FROM categorias WHERE sync_id = $1', [sync_id]);
            const existing = resExisting.rows[0];

            if (!existing) {
                await client.query(
                    `INSERT INTO categorias (sync_id, nombre, descripcion, icono, color, parent_id, created_at, updated_at, deleted)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
                    [sync_id, nombre, descripcion, icono, color, parent_id || null, created_at || new Date(), updated_at || new Date()]
                );
                results.inserted++;
            } else {
                const serverUpdatedAt = new Date(existing.updated_at);
                const clientUpdatedAt = new Date(updated_at);

                if (clientUpdatedAt >= serverUpdatedAt) {
                    await client.query(
                        `UPDATE categorias SET
                         nombre = $1, descripcion = $2, icono = $3, color = $4, parent_id = $5, updated_at = $6, deleted = 0
                         WHERE sync_id = $7`,
                        [nombre, descripcion, icono, color, parent_id || null, updated_at, sync_id]
                    );
                    results.updated++;
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, results });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error sincronizando categorías:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== SINCRONIZACIÓN DE ACTIVOS ====================

app.get('/api/activos', async (req, res) => {
    try {
        const { since } = req.query;
        console.log(`📡 GET /api/activos - Request received. Since: ${since || 'ALL'}`);

        let text = 'SELECT * FROM activos WHERE deleted = 0';
        let params = [];

        if (since) {
            text += ' AND updated_at > $1';
            params.push(since);
        }

        text += ' ORDER BY updated_at DESC';

        const { rows } = await query(text, params);
        console.log(`   ✅ Found ${rows.length} activos modified/created after ${since}`);

        res.json({
            success: true,
            data: rows,
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error obteniendo activos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/activos/sync', async (req, res) => {
    const { activos } = req.body;
    console.log(`📥 POST /api/activos/sync - Received ${activos?.length || 0} activos to sync`);

    if (!activos || !Array.isArray(activos)) {
        return res.status(400).json({ success: false, error: 'Se requiere un array de activos' });
    }

    const results = { inserted: 0, updated: 0, conflicts: [], errors: [] };

    // Usar un cliente dedicado para transacción
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Añadir columna serie si no existe (Migración manual simple)
        try {
            await query(`ALTER TABLE activos ADD COLUMN IF NOT EXISTS serie TEXT`);
        } catch (e) {
            // Ignorar si ya existe o error menor en postgres antiguo
        }

        for (const activo of activos) {
            const { sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, serie } = activo;

            // Log individual asset processing
            // console.log(`Processing asset: ${codigo} (${sync_id}) - Client Date: ${updated_at}`);

            const resExisting = await client.query('SELECT * FROM activos WHERE sync_id = $1', [sync_id]);
            const existing = resExisting.rows[0];

            if (!existing) {
                await client.query(
                    `INSERT INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, deleted, serie)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
                    [sync_id, codigo, nombre, edificio || null, nivel || null, categoria || null, espacio || null, updated_at || new Date(), serie || null]
                );
                results.inserted++;
                console.log(`   -> Inserted new asset: ${codigo}`);
            } else {
                // Comparación de fechas robusta
                const serverDateStr = existing.updated_at instanceof Date ? existing.updated_at.toISOString() : existing.updated_at;
                const clientDateStr = updated_at;

                const serverTime = new Date(serverDateStr).getTime();
                const clientTime = new Date(clientDateStr).getTime();

                // Debug date comparison logic
                // console.log(`   Comparing: Client(${clientTime}) vs Server(${serverTime}) -> Diff: ${clientTime - serverTime}ms`);

                // Permitimos la actualización si la versión del cliente es más nueva O IGUAL (para asegurar convergencia)
                // O si la diferencia es mínima (mismo segundo)
                // Prioridad Cliente: Siempre actualizamos si el cliente envía datos (confía en el flag 'modificado' de la app)
                // if (clientTime >= serverTime) {
                await client.query(
                    `UPDATE activos SET
                         codigo = $1, nombre = $2, edificio = $3, nivel = $4, 
                         categoria = $5, espacio = $6, updated_at = $7, deleted = 0, serie = $9
                         WHERE sync_id = $8`,
                    [codigo, nombre, edificio || null, nivel || null, categoria || null, espacio || null, updated_at, sync_id, serie || null]
                );
                results.updated++;
                console.log(`   -> Updated asset (Client Priority): ${codigo}`);
                // } else {
                //    console.log(`   -> Ignored update for ${codigo}. Server is newer/same. S: ${serverDateStr} C: ${clientDateStr}`);
                //    results.conflicts.push({ sync_id, reason: 'Server version is newer' });
                // }
            }
        }

        await client.query('COMMIT');
        console.log(`Sync completed. Inserted: ${results.inserted}, Updated: ${results.updated}, Conflicts: ${results.conflicts.length}`);
        res.json({ success: true, results });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error sincronizando activos:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.delete('/api/activos/:syncId', async (req, res) => {
    const client = await pool.connect();
    try {
        const { syncId } = req.params;
        await client.query(
            'UPDATE activos SET deleted = 1, updated_at = NOW() WHERE sync_id = $1',
            [syncId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// ==================== SINCRONIZACIÓN DE AUDITORÍAS ====================

app.get('/api/auditorias', async (req, res) => {
    try {
        const { since } = req.query;
        let text = 'SELECT * FROM auditorias';
        let params = [];

        if (since) {
            text += ' WHERE updated_at > $1';
            params.push(since);
        }

        text += ' ORDER BY fecha DESC';
        const { rows } = await query(text, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/auditorias/sync', async (req, res) => {
    const { auditorias } = req.body;
    if (!auditorias || !Array.isArray(auditorias)) {
        return res.status(400).json({ success: false, error: 'Se requiere un array de auditorías' });
    }

    const results = { inserted: 0, updated: 0 };
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        for (const auditoria of auditorias) {
            const {
                sync_id, espacio, fecha, total_esperados, total_escaneados,
                total_faltantes, total_sobrantes, codigos_escaneados,
                codigos_faltantes, codigos_sobrantes, estado, notas, updated_at
            } = auditoria;

            const resExisting = await client.query('SELECT * FROM auditorias WHERE sync_id = $1', [sync_id]);
            const existing = resExisting.rows[0];

            if (!existing) {
                await client.query(
                    `INSERT INTO auditorias (sync_id, espacio, fecha, total_esperados, total_escaneados, 
                    total_faltantes, total_sobrantes, codigos_escaneados, codigos_faltantes, 
                    codigos_sobrantes, estado, notas, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [sync_id, espacio, fecha, total_esperados, total_escaneados,
                        total_faltantes, total_sobrantes, codigos_escaneados,
                        codigos_faltantes, codigos_sobrantes, estado, notas, updated_at || new Date()]
                );
                results.inserted++;
            } else {
                const serverUpdatedAt = new Date(existing.updated_at);
                const clientUpdatedAt = new Date(updated_at);

                if (clientUpdatedAt >= serverUpdatedAt) {
                    await client.query(
                        `UPDATE auditorias SET
                        espacio = $1, fecha = $2, total_esperados = $3, total_escaneados = $4,
                        total_faltantes = $5, total_sobrantes = $6, codigos_escaneados = $7,
                        codigos_faltantes = $8, codigos_sobrantes = $9, estado = $10, notas = $11, updated_at = $12
                        WHERE sync_id = $13`,
                        [espacio, fecha, total_esperados, total_escaneados,
                            total_faltantes, total_sobrantes, codigos_escaneados,
                            codigos_faltantes, codigos_sobrantes, estado, notas, updated_at, sync_id]
                    );
                    results.updated++;
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, results });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error sincronizando auditorías:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// ==================== OCR (OCR.SPACE) ====================
app.post('/api/ocr', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ success: false, error: 'No image provided' });
        }

        // Add prefix if missing
        const base64Image = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;

        console.log('Enviando imagen a OCR.space...');

        // Construct x-www-form-urlencoded body manually to avoid needing 'form-data' package
        const params = new URLSearchParams();
        params.append('apikey', 'K84898840688957');
        params.append('base64Image', base64Image);
        params.append('language', 'eng'); // or 'spa' if needed, user didn't specify but 'eng' is safer for serial numbers usually
        params.append('isOverlayRequired', 'false');
        params.append('scale', 'true'); // Improves OCR for low res

        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            body: params
        });

        const data = await response.json();

        if (data && data.ParsedResults && data.ParsedResults.length > 0) {
            const text = data.ParsedResults[0].ParsedText.trim();
            console.log('OCR Result:', text);
            res.json({ success: true, text: text });
        } else {
            console.error('OCR Error:', data);
            res.json({ success: false, error: 'No text detected or API error', details: data });
        }

    } catch (error) {
        console.error('Error en OCR proxy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ESTADÍSTICAS ====================

app.get('/api/stats', async (req, res) => {
    try {
        const resActivos = await query('SELECT COUNT(*) as total FROM activos WHERE deleted = 0');
        const resAuditorias = await query('SELECT COUNT(*) as total FROM auditorias');
        const resEspacios = await query('SELECT COUNT(DISTINCT espacio) as total FROM activos WHERE espacio IS NOT NULL AND deleted = 0');

        res.json({
            success: true,
            stats: {
                activos: parseInt(resActivos.rows[0].total),
                auditorias: parseInt(resAuditorias.rows[0].total),
                espacios: parseInt(resEspacios.rows[0].total)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor de sincronización corriendo en puerto ${PORT} (PostgreSQL)`);
    console.log(`📡 API disponible en http://localhost:${PORT}/api`);
});
