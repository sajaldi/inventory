require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const db = require('./db');
const multer = require('multer');
const csv = require('csv-parser');

const upload = multer({ dest: 'uploads/' });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Log all requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check for Coolify
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Explicitly serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper para queries simples (no transaccionales)
async function query(text, params) {
    return await db.query(text, params);
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
                deleted INTEGER DEFAULT 0,
                serie TEXT
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

        // Migration: Ensure all columns exist (for older DB versions)
        const migrations = [
            { table: 'activos', column: 'deleted', type: 'INTEGER DEFAULT 0' },
            { table: 'activos', column: 'serie', type: 'TEXT' },
            { table: 'activos', column: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
            { table: 'categorias', column: 'deleted', type: 'INTEGER DEFAULT 0' },
            { table: 'auditorias', column: 'plano_id', type: 'INTEGER' }
        ];

        for (const m of migrations) {
            try {
                await query(`ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.type}`);
            } catch (e) {
                // Silently ignore if already exists or other minor issue
            }
        }

        console.log('✅ Tablas inicializadas y migradas en PostgreSQL');
    } catch (error) {
        console.error('Error inicializando BD:', error);
    }
};

// ==================== FRONTEND ENDPOINTS ====================

// Endpoint to get all assets (activos) with pagination for the Web Panel
app.get('/activos', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        // Get total count for pagination metadata
        const countResult = await query('SELECT COUNT(*) FROM activos WHERE deleted = 0');
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        // Get paginated data
        const result = await query('SELECT * FROM activos WHERE deleted = 0 ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]);

        res.json({
            data: result.rows,
            meta: {
                totalItems,
                totalPages,
                currentPage: page,
                limit
            }
        });
    } catch (err) {
        console.error('DATABASE ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

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
    const client = await db.pool.connect();

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
app.get('/api', (req, res) => {
    res.json({ status: 'ok', message: 'Inventory API logic is running' });
});

// Health check with timestamp
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
        console.error(`❌ Error obteniendo activos:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== IMPORTACIÓN DE ACTIVOS (CSV) ====================

app.post('/api/activos/import', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No se subió ningún archivo' });
    }

    const results = { inserted: 0, updated: 0, errors: [] };
    const assetsData = [];

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => assetsData.push(data))
        .on('end', async () => {
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                for (const row of assetsData) {
                    // Normalize keys (lowercase and remove spaces if necessary)
                    const codigo = row.codigo || row.CODIGO || row.Código || row.CÓDIGO;
                    const nombre = row.nombre || row.NOMBRE || row.Nombre;

                    if (!codigo || !nombre) {
                        results.errors.push(`Fila inválida: falta código o nombre (${JSON.stringify(row)})`);
                        continue;
                    }

                    const serie = row.serie || row.SERIE || row.Serie || null;
                    const edificio = row.edificio || row.EDIFICIO || row.Edificio || null;
                    const nivel = row.nivel || row.NIVEL || row.Nivel || null;
                    const categoria = row.categoria || row.CATEGORIA || row.Categoría || row.Carga || null;
                    const espacio = row.espacio || row.ESPACIO || row.Espacio || null;

                    // Check if exists by codigo
                    const resExisting = await client.query('SELECT * FROM activos WHERE codigo = $1', [codigo]);
                    const existing = resExisting.rows[0];

                    if (!existing) {
                        const sync_id = uuidv4();
                        await client.query(
                            `INSERT INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, deleted, serie)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, 0, $8)`,
                            [sync_id, codigo, nombre, edificio, nivel, categoria, espacio, serie]
                        );
                        results.inserted++;
                    } else {
                        await client.query(
                            `UPDATE activos SET
                                 nombre = $1, edificio = $2, nivel = $3, 
                                 categoria = $4, espacio = $5, updated_at = CURRENT_TIMESTAMP, 
                                 deleted = 0, serie = $6
                             WHERE codigo = $7`,
                            [nombre, edificio, nivel, categoria, espacio, serie, codigo]
                        );
                        results.updated++;
                    }
                }
                await client.query('COMMIT');
                res.json({ success: true, results });
            } catch (err) {
                if (client) await client.query('ROLLBACK');
                console.error('Error durante la importación:', err);
                res.status(500).json({ success: false, error: err.message });
            } finally {
                client.release();
                // Clean up temp file
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            }
        });
});

// ==================== EXPORTACIÓN DE ACTIVOS (CSV) ====================

app.get('/api/export-activos', async (req, res) => {
    console.log(`📥 GET /api/export-activos - Request received`);
    try {
        const result = await query('SELECT * FROM activos WHERE deleted = 0 ORDER BY id ASC');
        const rows = result.rows;

        console.log(`   📊 Exporting ${rows.length} activos`);

        if (rows.length === 0) {
            console.warn(`   ⚠️ No activos found to export`);
            return res.status(200).send('codigo,nombre,serie,edificio,nivel,categoria,espacio,sync_id,updated_at\n'); // Return empty CSV template
        }

        // Define columns
        const columns = ['codigo', 'nombre', 'serie', 'edificio', 'nivel', 'categoria', 'espacio', 'sync_id', 'updated_at'];

        // Helper to escape CSV values
        const escapeCSV = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // Header row
        const header = columns.join(',');

        // Data rows
        const csvRows = rows.map(row => {
            return columns.map(col => escapeCSV(row[col])).join(',');
        });

        const csvContent = [header, ...csvRows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=activos_inventario.csv');
        console.log(`   ✅ Export content generated successfully (${csvContent.length} bytes)`);
        res.status(200).send(csvContent);
    } catch (err) {
        console.error('❌ Error al exportar activos:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/activos/sync', async (req, res) => {
    const { activos } = req.body;
    console.log(`📥 POST /api/activos/sync - Received ${activos?.length || 0} activos to sync`);

    if (!activos || !Array.isArray(activos)) {
        return res.status(400).json({ success: false, error: 'Se requiere un array de activos' });
    }

    const results = { inserted: 0, updated: 0, conflicts: [], errors: [] };
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        for (const activo of activos) {
            const { sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, serie } = activo;

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
                await client.query(
                    `UPDATE activos SET
                         codigo = $1, nombre = $2, edificio = $3, nivel = $4, 
                         categoria = $5, espacio = $6, updated_at = $7, deleted = 0, serie = $9
                         WHERE sync_id = $8`,
                    [codigo, nombre, edificio || null, nivel || null, categoria || null, espacio || null, updated_at, sync_id, serie || null]
                );
                results.updated++;
                console.log(`   -> Updated asset: ${codigo}`);
            }
        }

        await client.query('COMMIT');
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
    const client = await db.pool.connect();
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
    const client = await db.pool.connect();

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

        const base64Image = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;
        console.log('Enviando imagen a OCR.space...');

        const params = new URLSearchParams();
        params.append('apikey', process.env.OCR_API_KEY || 'K84898840688957');
        params.append('base64Image', base64Image);
        params.append('language', 'eng');
        params.append('isOverlayRequired', 'false');
        params.append('scale', 'true');

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Servidor de sincronización corriendo en puerto ${PORT} (PostgreSQL)`);
    console.log(`📡 API disponible en http://0.0.0.0:${PORT}/api`);
    await initDB();
});
