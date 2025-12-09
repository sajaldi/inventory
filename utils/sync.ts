import * as SQLite from 'expo-sqlite';

// URL del servidor - CAMBIAR POR TU IP/DOMINIO
const API_URL = 'http://10.29.0.213:3000/api';

// Generar UUID v4
export const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// Obtener timestamp actual en ISO
export const getCurrentTimestamp = (): string => {
    return new Date().toISOString();
};

interface SyncResult {
    success: boolean;
    uploaded: { activos: number; auditorias: number };
    downloaded: { activos: number; auditorias: number };
    errors: string[];
}

// Sincronizar con el servidor
export async function syncWithServer(db: SQLite.SQLiteDatabase): Promise<SyncResult> {
    const result: SyncResult = {
        success: true,
        uploaded: { activos: 0, auditorias: 0 },
        downloaded: { activos: 0, auditorias: 0 },
        errors: []
    };

    try {
        // 1. Verificar conexión
        const healthCheck = await fetch(`${API_URL}/health`, { method: 'GET' });
        if (!healthCheck.ok) {
            throw new Error('No se puede conectar al servidor');
        }

        // 2. Obtener última sincronización
        const lastSyncResult = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_config WHERE key = 'last_sync'"
        );
        const lastSync = lastSyncResult?.value || null;

        // 3. SUBIR: Obtener activos locales modificados
        let localActivos;
        if (lastSync) {
            localActivos = await db.getAllAsync(
                'SELECT * FROM activos WHERE updated_at > ?',
                [lastSync]
            );
        } else {
            localActivos = await db.getAllAsync('SELECT * FROM activos');
        }

        if (localActivos.length > 0) {
            const uploadResponse = await fetch(`${API_URL}/activos/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activos: localActivos })
            });

            if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                result.uploaded.activos = uploadResult.results?.inserted + uploadResult.results?.updated || 0;
            } else {
                result.errors.push('Error subiendo activos');
            }
        }

        // 4. SUBIR: Auditorías locales
        let localAuditorias;
        if (lastSync) {
            localAuditorias = await db.getAllAsync(
                'SELECT * FROM auditorias WHERE updated_at > ?',
                [lastSync]
            );
        } else {
            localAuditorias = await db.getAllAsync('SELECT * FROM auditorias');
        }

        if (localAuditorias.length > 0) {
            const uploadResponse = await fetch(`${API_URL}/auditorias/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auditorias: localAuditorias })
            });

            if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                result.uploaded.auditorias = uploadResult.results?.inserted + uploadResult.results?.updated || 0;
            } else {
                result.errors.push('Error subiendo auditorías');
            }
        }

        // 5. DESCARGAR: Activos del servidor
        const downloadUrl = lastSync
            ? `${API_URL}/activos?since=${encodeURIComponent(lastSync)}`
            : `${API_URL}/activos`;

        const downloadResponse = await fetch(downloadUrl);

        if (downloadResponse.ok) {
            const downloadData = await downloadResponse.json();
            const serverActivos = downloadData.data || [];

            for (const activo of serverActivos) {
                // Verificar si existe localmente
                const localActivo = await db.getFirstAsync<{ id: number; updated_at: string }>(
                    'SELECT id, updated_at FROM activos WHERE sync_id = ?',
                    [activo.sync_id]
                );

                if (!localActivo) {
                    // Insertar nuevo
                    await db.runAsync(
                        `INSERT INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, serie)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [activo.sync_id, activo.codigo, activo.nombre, activo.edificio, activo.nivel, activo.categoria, activo.espacio, activo.updated_at, activo.serie]
                    );
                    result.downloaded.activos++;
                } else {
                    // Actualizar si el servidor es más reciente
                    const serverTime = new Date(activo.updated_at).getTime();
                    const localTime = new Date(localActivo.updated_at).getTime();

                    if (serverTime > localTime) {
                        await db.runAsync(
                            `UPDATE activos SET codigo = ?, nombre = ?, edificio = ?, nivel = ?, categoria = ?, espacio = ?, updated_at = ?, serie = ?
               WHERE sync_id = ?`,
                            [activo.codigo, activo.nombre, activo.edificio, activo.nivel, activo.categoria, activo.espacio, activo.updated_at, activo.serie, activo.sync_id]
                        );
                        result.downloaded.activos++;
                    }
                }
            }
        }

        // 6. DESCARGAR: Auditorías del servidor
        const auditDownloadUrl = lastSync
            ? `${API_URL}/auditorias?since=${encodeURIComponent(lastSync)}`
            : `${API_URL}/auditorias`;

        const auditDownloadResponse = await fetch(auditDownloadUrl);

        if (auditDownloadResponse.ok) {
            const auditDownloadData = await auditDownloadResponse.json();
            const serverAuditorias = auditDownloadData.data || [];

            for (const auditoria of serverAuditorias) {
                const localAuditoria = await db.getFirstAsync<{ id: number; updated_at: string }>(
                    'SELECT id, updated_at FROM auditorias WHERE sync_id = ?',
                    [auditoria.sync_id]
                );

                if (!localAuditoria) {
                    await db.runAsync(
                        `INSERT INTO auditorias (sync_id, espacio, fecha, total_esperados, total_escaneados, total_faltantes, total_sobrantes, codigos_escaneados, codigos_faltantes, codigos_sobrantes, estado, notas, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [auditoria.sync_id, auditoria.espacio, auditoria.fecha, auditoria.total_esperados, auditoria.total_escaneados, auditoria.total_faltantes, auditoria.total_sobrantes, auditoria.codigos_escaneados, auditoria.codigos_faltantes, auditoria.codigos_sobrantes, auditoria.estado, auditoria.notas, auditoria.updated_at]
                    );
                    result.downloaded.auditorias++;
                } else {
                    const serverTime = new Date(auditoria.updated_at).getTime();
                    const localTime = new Date(localAuditoria.updated_at).getTime();

                    if (serverTime > localTime) {
                        await db.runAsync(
                            `UPDATE auditorias SET espacio = ?, fecha = ?, total_esperados = ?, total_escaneados = ?, total_faltantes = ?, total_sobrantes = ?, codigos_escaneados = ?, codigos_faltantes = ?, codigos_sobrantes = ?, estado = ?, notas = ?, updated_at = ?
               WHERE sync_id = ?`,
                            [auditoria.espacio, auditoria.fecha, auditoria.total_esperados, auditoria.total_escaneados, auditoria.total_faltantes, auditoria.total_sobrantes, auditoria.codigos_escaneados, auditoria.codigos_faltantes, auditoria.codigos_sobrantes, auditoria.estado, auditoria.notas, auditoria.updated_at, auditoria.sync_id]
                        );
                        result.downloaded.auditorias++;
                    }
                }
            }
        }

        // 7. SUBIR: Categorías locales
        let localCategorias;
        if (lastSync) {
            localCategorias = await db.getAllAsync(
                'SELECT * FROM categorias WHERE updated_at > ?',
                [lastSync]
            );
        } else {
            localCategorias = await db.getAllAsync('SELECT * FROM categorias');
        }

        if (localCategorias.length > 0) {
            const uploadResponse = await fetch(`${API_URL}/categorias/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categorias: localCategorias })
            });

            if (uploadResponse.ok) {
                // Éxito subiendo
                // const uploadResult = await uploadResponse.json();
            } else {
                result.errors.push('Error subiendo categorías');
            }
        }

        // 8. DESCARGAR: Categorías del servidor
        const catDownloadUrl = lastSync
            ? `${API_URL}/categorias?since=${encodeURIComponent(lastSync)}`
            : `${API_URL}/categorias`;

        const catDownloadResponse = await fetch(catDownloadUrl);

        if (catDownloadResponse.ok) {
            const catDownloadData = await catDownloadResponse.json();
            const serverCats = catDownloadData.data || [];

            for (const cat of serverCats) {
                const localCat = await db.getFirstAsync<{ id: number; updated_at: string }>(
                    'SELECT id, updated_at FROM categorias WHERE sync_id = ?',
                    [cat.sync_id]
                );

                if (!localCat) {
                    await db.runAsync(
                        `INSERT INTO categorias (sync_id, nombre, descripcion, icono, color, parent_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [cat.sync_id, cat.nombre, cat.descripcion, cat.icono, cat.color, cat.parent_id, cat.created_at, cat.updated_at]
                    );
                } else {
                    const serverTime = new Date(cat.updated_at).getTime();
                    const localTime = new Date(localCat.updated_at).getTime();

                    if (serverTime > localTime) {
                        await db.runAsync(
                            `UPDATE categorias SET nombre = ?, descripcion = ?, icono = ?, color = ?, parent_id = ?, updated_at = ?
                             WHERE sync_id = ?`,
                            [cat.nombre, cat.descripcion, cat.icono, cat.color, cat.parent_id, cat.updated_at, cat.sync_id]
                        );
                    }
                }
            }
        }

        // 7. Guardar timestamp de sincronización
        const syncTime = getCurrentTimestamp();
        await db.runAsync(
            `INSERT OR REPLACE INTO sync_config (key, value) VALUES ('last_sync', ?)`,
            [syncTime]
        );

        result.success = result.errors.length === 0;

    } catch (error: any) {
        result.success = false;
        result.errors.push(error.message || 'Error desconocido');
    }

    return result;
}

// Obtener estado de sincronización
export async function getSyncStatus(db: SQLite.SQLiteDatabase) {
    try {
        const lastSyncResult = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_config WHERE key = 'last_sync'"
        );

        const pendingActivos = await db.getFirstAsync<{ count: number }>(
            lastSyncResult?.value
                ? 'SELECT COUNT(*) as count FROM activos WHERE updated_at > ?'
                : 'SELECT COUNT(*) as count FROM activos',
            lastSyncResult?.value ? [lastSyncResult.value] : []
        );

        return {
            lastSync: lastSyncResult?.value || null,
            pendingChanges: pendingActivos?.count || 0
        };
    } catch (e) {
        return { lastSync: null, pendingChanges: 0 };
    }
}

// Verificar conexión con el servidor
export async function checkServerConnection(): Promise<boolean> {
    try {
        const response = await fetch(`${API_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5 segundos timeout
        });
        return response.ok;
    } catch (e: any) {
        console.log('Error de conexión con:', `${API_URL}/health`);
        console.log('Detalle error:', e.message);
        return false;
    }
}
