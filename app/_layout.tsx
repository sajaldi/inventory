import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';

export default function RootLayout() {
  return (
    <SQLiteProvider
      databaseName="inventario.db"
      onInit={migrateDbIfNeeded}
      onError={(err) => console.log('Error DB:', err)}
    >
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SQLiteProvider>
  );
}

// Función de inicialización de Base de Datos
async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const MAX_RETRIES = 10;  // Aumentar reintentos
  let attempt = 0;

  try {
    await db.execAsync('PRAGMA busy_timeout = 15000;');  // 15 segundos
  } catch (e) { console.log('Error setting busy_timeout', e) }

  // Pausa inicial para dar tiempo a que se cierre cualquier conexión previa
  await new Promise(resolve => setTimeout(resolve, 2000));

  while (attempt < MAX_RETRIES) {
    try {
      const DATABASE_VERSION = 10; // Versión 10: columna deleted

      let result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      let currentDbVersion = result ? result.user_version : 0;

      if (currentDbVersion >= DATABASE_VERSION) {
        return;
      }

      // Migración inicial - crear tabla
      if (currentDbVersion === 0) {
        console.log('--- Inicializando Tablas ---');
        await db.execAsync(`
          PRAGMA journal_mode = 'wal';
          CREATE TABLE IF NOT EXISTS activos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT UNIQUE,
            codigo TEXT NOT NULL UNIQUE,
            nombre TEXT NOT NULL,
            edificio TEXT,
            nivel TEXT,
            categoria TEXT,
            espacio TEXT,
            updated_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_activos_edificio ON activos(edificio);
          CREATE INDEX IF NOT EXISTS idx_activos_nivel ON activos(nivel);
          CREATE INDEX IF NOT EXISTS idx_activos_categoria ON activos(categoria);
          CREATE INDEX IF NOT EXISTS idx_activos_espacio ON activos(espacio);
          CREATE INDEX IF NOT EXISTS idx_activos_sync_id ON activos(sync_id);
        `);
        currentDbVersion = 1;
      }

      // Migración v1 -> v2: Añadir campo categoria
      if (currentDbVersion === 1) {
        console.log('--- Migrando a v2: Añadiendo categoria ---');
        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN categoria TEXT;`);
          await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_activos_categoria ON activos(categoria);`);
        } catch (e) {
          console.log('Columna categoria ya existe:', e);
        }
        currentDbVersion = 2;
      }

      // Migración v2 -> v3: Añadir campo espacio y tabla auditorias
      if (currentDbVersion === 2) {
        console.log('--- Migrando a v3: Añadiendo espacio y auditorías ---');
        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN espacio TEXT;`);
          await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_activos_espacio ON activos(espacio);`);
        } catch (e) {
          console.log('Columna espacio ya existe:', e);
        }

        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS auditorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT UNIQUE,
            espacio TEXT NOT NULL,
            fecha TEXT NOT NULL,
            total_esperados INTEGER DEFAULT 0,
            total_escaneados INTEGER DEFAULT 0,
            total_faltantes INTEGER DEFAULT 0,
            total_sobrantes INTEGER DEFAULT 0,
            codigos_escaneados TEXT,
            codigos_faltantes TEXT,
            codigos_sobrantes TEXT,
            estado TEXT DEFAULT 'en_progreso',
            notas TEXT,
            updated_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_auditorias_espacio ON auditorias(espacio);
          CREATE INDEX IF NOT EXISTS idx_auditorias_fecha ON auditorias(fecha);
          CREATE INDEX IF NOT EXISTS idx_auditorias_sync_id ON auditorias(sync_id);
        `);

        currentDbVersion = 3;
      }

      // Migración v3 -> v4: Añadir campos de sincronización
      if (currentDbVersion === 3) {
        console.log('--- Migrando a v4: Añadiendo campos de sincronización ---');

        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN sync_id TEXT;`);
        } catch (e) { console.log('sync_id activos ya existe'); }

        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN updated_at TEXT;`);
        } catch (e) { console.log('updated_at activos ya existe'); }

        try {
          await db.execAsync(`ALTER TABLE auditorias ADD COLUMN sync_id TEXT;`);
        } catch (e) { console.log('sync_id auditorias ya existe'); }

        try {
          await db.execAsync(`ALTER TABLE auditorias ADD COLUMN updated_at TEXT;`);
        } catch (e) { console.log('updated_at auditorias ya existe'); }

        // Generar sync_id para registros existentes
        await db.execAsync(`
          UPDATE activos SET sync_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE sync_id IS NULL;
        `);
        await db.execAsync(`
          UPDATE activos SET updated_at = datetime('now') WHERE updated_at IS NULL;
        `);
        await db.execAsync(`
          UPDATE auditorias SET sync_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE sync_id IS NULL;
        `);
        await db.execAsync(`
          UPDATE auditorias SET updated_at = datetime('now') WHERE updated_at IS NULL;
        `);

        await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activos_sync_id ON activos(sync_id);`);
        await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_activos_updated_at ON activos(updated_at);`);
        await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auditorias_sync_id ON auditorias(sync_id);`);

        // Tabla de configuración de sincronización
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS sync_config (
            key TEXT PRIMARY KEY,
            value TEXT
          );
        `);

        currentDbVersion = 4;
      }

      // Migración v4 -> v5: Añadir tablas de planos y posiciones
      if (currentDbVersion === 4) {
        console.log('--- Migrando a v5: Añadiendo planos y posiciones ---');

        // Tabla de planos
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS planos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT UNIQUE,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            edificio TEXT,
            nivel TEXT,
            archivo_uri TEXT NOT NULL,
            paginas INTEGER DEFAULT 1,
            ancho REAL,
            alto REAL,
            created_at TEXT,
            updated_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_planos_edificio ON planos(edificio);
          CREATE INDEX IF NOT EXISTS idx_planos_nivel ON planos(nivel);
          CREATE INDEX IF NOT EXISTS idx_planos_sync_id ON planos(sync_id);
        `);

        // Tabla de posiciones de activos en planos
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS activos_posiciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT UNIQUE,
            activo_id INTEGER NOT NULL,
            activo_codigo TEXT NOT NULL,
            plano_id INTEGER NOT NULL,
            pagina INTEGER DEFAULT 1,
            pos_x REAL NOT NULL,
            pos_y REAL NOT NULL,
            notas TEXT,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (activo_id) REFERENCES activos(id) ON DELETE CASCADE,
            FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_posiciones_activo ON activos_posiciones(activo_id);
          CREATE INDEX IF NOT EXISTS idx_posiciones_plano ON activos_posiciones(plano_id);
          CREATE INDEX IF NOT EXISTS idx_posiciones_codigo ON activos_posiciones(activo_codigo);
          CREATE INDEX IF NOT EXISTS idx_posiciones_sync_id ON activos_posiciones(sync_id);
        `);

        // Añadir campo plano_id a auditorias para vincular auditoría con plano
        try {
          await db.execAsync(`ALTER TABLE auditorias ADD COLUMN plano_id INTEGER;`);
        } catch (e) { console.log('plano_id auditorias ya existe'); }

        currentDbVersion = 5;
      }


      // Migración v5 -> v6: Implementación de Ubicaciones Jerárquicas
      if (currentDbVersion === 5) {
        console.log('--- Migrando a v6: Implementación de Ubicaciones ---');

        // 1. Crear tabla ubicaciones
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS ubicaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT UNIQUE,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL, -- 'edificio', 'nivel', 'area'
            parent_id INTEGER,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (parent_id) REFERENCES ubicaciones(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_ubicaciones_parent ON ubicaciones(parent_id);
          CREATE INDEX IF NOT EXISTS idx_ubicaciones_tipo ON ubicaciones(tipo);
          CREATE INDEX IF NOT EXISTS idx_ubicaciones_sync_id ON ubicaciones(sync_id);
        `);

        // 2. Añadir ubicacion_id a activos y planos
        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;`);
          await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_activos_ubicacion ON activos(ubicacion_id);`);
        } catch (e) { console.log('ubicacion_id activos ya existe'); }

        try {
          await db.execAsync(`ALTER TABLE planos ADD COLUMN ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;`);
          await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_planos_ubicacion ON planos(ubicacion_id);`);
        } catch (e) { console.log('ubicacion_id planos ya existe'); }

        // 3. Migrar datos existentes de Activos
        console.log('Migrando datos de ubicaciones...');

        // Generador de UUID simple para SQL
        const uuidSql = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))`;
        const nowSql = `datetime('now')`;

        // A. Migrar Edificios
        await db.execAsync(`
          INSERT INTO ubicaciones (sync_id, nombre, tipo, created_at, updated_at)
          SELECT DISTINCT 
            ${uuidSql}, 
            edificio, 
            'edificio', 
            ${nowSql}, 
            ${nowSql}
          FROM activos 
          WHERE edificio IS NOT NULL AND edificio != ''
          AND edificio NOT IN (SELECT nombre FROM ubicaciones WHERE tipo = 'edificio');
        `);

        // B. Migrar Niveles (vinculados a Edificios)
        await db.execAsync(`
          INSERT INTO ubicaciones (sync_id, nombre, tipo, parent_id, created_at, updated_at)
          SELECT DISTINCT 
            ${uuidSql}, 
            a.nivel, 
            'nivel', 
            u.id, 
            ${nowSql}, 
            ${nowSql}
          FROM activos a
          JOIN ubicaciones u ON u.nombre = a.edificio AND u.tipo = 'edificio'
          WHERE a.nivel IS NOT NULL AND a.nivel != ''
          AND NOT EXISTS (
            SELECT 1 FROM ubicaciones u_existing 
            WHERE u_existing.nombre = a.nivel 
            AND u_existing.tipo = 'nivel' 
            AND u_existing.parent_id = u.id
          );
        `);

        // C. Migrar Espacios (vinculados a Niveles)
        await db.execAsync(`
          INSERT INTO ubicaciones (sync_id, nombre, tipo, parent_id, created_at, updated_at)
          SELECT DISTINCT 
            ${uuidSql}, 
            a.espacio, 
            'area', 
            u_nivel.id, 
            ${nowSql}, 
            ${nowSql}
          FROM activos a
          JOIN ubicaciones u_edificio ON u_edificio.nombre = a.edificio AND u_edificio.tipo = 'edificio'
          JOIN ubicaciones u_nivel ON u_nivel.nombre = a.nivel AND u_nivel.tipo = 'nivel' AND u_nivel.parent_id = u_edificio.id
          WHERE a.espacio IS NOT NULL AND a.espacio != ''
          AND NOT EXISTS (
            SELECT 1 FROM ubicaciones u_existing 
            WHERE u_existing.nombre = a.espacio 
            AND u_existing.tipo = 'area' 
            AND u_existing.parent_id = u_nivel.id
          );
        `);

        // 4. Vincular Activos a Ubicaciones
        await db.execAsync(`
          UPDATE activos 
          SET ubicacion_id = (
            SELECT u_area.id 
            FROM ubicaciones u_area
            JOIN ubicaciones u_nivel ON u_area.parent_id = u_nivel.id
            JOIN ubicaciones u_edificio ON u_nivel.parent_id = u_edificio.id
            WHERE u_area.nombre = activos.espacio 
              AND u_nivel.nombre = activos.nivel 
              AND u_edificio.nombre = activos.edificio
              AND u_area.tipo = 'area'
          )
          WHERE espacio IS NOT NULL AND nivel IS NOT NULL AND edificio IS NOT NULL;
        `);

        await db.execAsync(`
          UPDATE activos 
          SET ubicacion_id = (
            SELECT u_nivel.id 
            FROM ubicaciones u_nivel
            JOIN ubicaciones u_edificio ON u_nivel.parent_id = u_edificio.id
            WHERE u_nivel.nombre = activos.nivel 
              AND u_edificio.nombre = activos.edificio
              AND u_nivel.tipo = 'nivel'
          )
          WHERE ubicacion_id IS NULL AND nivel IS NOT NULL AND edificio IS NOT NULL;
        `);

        await db.execAsync(`
          UPDATE activos 
          SET ubicacion_id = (
            SELECT id FROM ubicaciones WHERE nombre = activos.edificio AND tipo = 'edificio'
          )
          WHERE ubicacion_id IS NULL AND edificio IS NOT NULL AND edificio != '';
        `);

        currentDbVersion = 6;
      }

      // Migración v6 -> v7: Tabla de Categorías
      if (currentDbVersion === 6) {
        console.log('--- Migrando a v7: Tabla de Categorías ---');

        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT UNIQUE,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            icono TEXT,
            color TEXT,
            parent_id INTEGER,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (parent_id) REFERENCES categorias(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_categorias_nombre ON categorias(nombre);
          CREATE INDEX IF NOT EXISTS idx_categorias_sync_id ON categorias(sync_id);
          CREATE INDEX IF NOT EXISTS idx_categorias_parent ON categorias(parent_id);
        `);

        // Agregar columna parent_id si no existe (para tablas creadas antes de v7)
        try {
          await db.execAsync(`ALTER TABLE categorias ADD COLUMN parent_id INTEGER`);
          console.log('Columna parent_id agregada a categorias');
        } catch (e: any) {
          // La columna ya existe, ignorar error
          if (!e.message.includes('duplicate column')) {
            console.log('Error agregando parent_id:', e.message);
          }
        }

        // Migrar categorías existentes desde activos
        const uuidSql = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))`;
        const nowSql = `datetime('now')`;

        await db.execAsync(`
          INSERT OR IGNORE INTO categorias (sync_id, nombre, created_at, updated_at)
          SELECT DISTINCT 
            ${uuidSql}, 
            categoria, 
            ${nowSql}, 
            ${nowSql}
          FROM activos 
          WHERE categoria IS NOT NULL AND categoria != '';
        `);

        currentDbVersion = 7;
      }

      // Migración v7 -> v8: Añadir columna SERIE a activos
      if (currentDbVersion === 7) {
        console.log('--- Migrando a v8: Añadiendo columna serie ---');
        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN serie TEXT;`);
        } catch (e) {
          console.log('Columna serie ya existe o error al añadir:', e);
        }
        currentDbVersion = 8;
      }

      // Migración v8 -> v9: Asegurar columna SERIE (Fix de emergencia)
      if (currentDbVersion === 8) {
        console.log('--- Migrando a v9: Asegurando columna serie ---');
        try {
          // Intentar añadir de nuevo por si la v8 falló o no se aplicó correctamente
          await db.execAsync(`ALTER TABLE activos ADD COLUMN serie TEXT;`);
        } catch (e) {
          // Si falla porque ya existe, perfecto.
          console.log('Verificación v9: La columna serie probablemente ya existe.');
        }
        currentDbVersion = 9;
      }



      // Migración v9 -> v10: Añadir columna deleted a activos
      if (currentDbVersion === 9) {
        console.log('--- Migrando a v10: Añadiendo columna deleted ---');
        try {
          await db.execAsync(`ALTER TABLE activos ADD COLUMN deleted INTEGER DEFAULT 0;`);
        } catch (e) {
          console.log('Columna deleted ya existe o error al añadir:', e);
        }
        currentDbVersion = 10;
      }

      // FINAL CHECK: Ensure 'serie' column exists whatever the version is
      try {
        // Check if column exists
        const tableInfo = await db.getAllAsync('PRAGMA table_info(activos)');
        const hasSerie = Array.isArray(tableInfo) && tableInfo.some((col: any) => col.name === 'serie');
        const hasDeleted = Array.isArray(tableInfo) && tableInfo.some((col: any) => col.name === 'deleted');

        if (!hasSerie) {
          console.log('--- FINAL CHECK: Columna serie NO detectada. Intentando añadir... ---');
          await db.execAsync(`ALTER TABLE activos ADD COLUMN serie TEXT;`);
        }

        if (!hasDeleted) {
          console.log('--- FINAL CHECK: Columna deleted NO detectada. Intentando añadir... ---');
          await db.execAsync(`ALTER TABLE activos ADD COLUMN deleted INTEGER DEFAULT 0;`);
        }
      } catch (e) {
        console.log('Error verifying serie column:', e);
      }

      await db.execAsync(`PRAGMA user_version = 10`);
      console.log('--- Base de datos actualizada a versión 10 (Verificada) ---');
      console.log('--- Migración completada ---');
      break; // Success

    } catch (error: any) {
      if (error.message.includes('database is locked')) {
        attempt++;
        console.warn(`Database is locked, retrying (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt)); // 5 segundos por intento
      } else {
        console.error("Error crítico creando/migrando tablas:", error);
        break;
      }
    }
  }
}