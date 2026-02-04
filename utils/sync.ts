import * as SQLite from 'expo-sqlite';

// URL del servidor - CAMBIAR POR TU IP/DOMINIO
export const API_URL = 'http://181.115.47.107:3001/api';

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

// Sincronizar con el servidor (Wrapper legacy o para sincronización completa)
export async function syncWithServer(db: SQLite.SQLiteDatabase): Promise<SyncResult> {
    const uploadRes = await uploadChanges(db);
    const downloadRes = await downloadChanges(db);

    return {
        success: uploadRes.success && downloadRes.success,
        uploaded: uploadRes.uploaded,
        downloaded: downloadRes.downloaded,
        errors: [...uploadRes.errors, ...downloadRes.errors]
    };
}

export async function uploadChanges(db: SQLite.SQLiteDatabase): Promise<SyncResult> {
    const result: SyncResult = {
        success: true,
        uploaded: { activos: 0, auditorias: 0 },
        downloaded: { activos: 0, auditorias: 0 },
        errors: []
    };

    try {
        const conn = await checkServerConnection();
        if (!conn.ok) {
            throw new Error(`No se puede conectar al servidor: ${conn.error}`);
        }

        // Obtener última subida
        const lastUploadResult = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_config WHERE key = 'last_upload'"
        );
        // Fallback to legacy last_sync if last_upload doesn't exist
        const lastSyncResult = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_config WHERE key = 'last_sync'"
        );
        const lastUpload = lastUploadResult?.value || lastSyncResult?.value || null;

        // --- SUBIR ACTIVOS ---
        const localActivos = await db.getAllAsync<{ id: number;[key: string]: any }>(
            'SELECT * FROM activos WHERE modificado = 1'
        );

        if (localActivos.length > 0) {
            console.log(`Subiendo ${localActivos.length} activos modificados...`);
            const uploadResponse = await fetch(`${API_URL}/activos/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activos: localActivos })
            });

            if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                result.uploaded.activos = uploadResult.results?.inserted + uploadResult.results?.updated || 0;

                // Marcar como no modificados (sincronizados)
                const ids = localActivos.map(a => a.id).join(',');
                if (ids) {
                    await db.runAsync(`UPDATE activos SET modificado = 0 WHERE id IN (${ids})`);
                }
            } else {
                result.errors.push('Error subiendo activos');
            }
        } else {
            console.log('No hay activos modificados para subir.');
        }

        // --- SUBIR AUDITORIAS ---
        const localAuditorias = await db.getAllAsync<{ id: number;[key: string]: any }>(
            'SELECT * FROM auditorias WHERE modificado = 1'
        );

        if (localAuditorias.length > 0) {
            console.log(`Subiendo ${localAuditorias.length} auditorías modificadas...`);
            const uploadResponse = await fetch(`${API_URL}/auditorias/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auditorias: localAuditorias })
            });

            if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                result.uploaded.auditorias = uploadResult.results?.inserted + uploadResult.results?.updated || 0;

                // Marcar como no modificados
                const ids = localAuditorias.map(a => a.id).join(',');
                if (ids) {
                    await db.runAsync(`UPDATE auditorias SET modificado = 0 WHERE id IN (${ids})`);
                }
            } else {
                result.errors.push('Error subiendo auditorías');
            }
        }

        // --- SUBIR CATEGORIAS ---
        let localCategorias;
        if (lastUpload) {
            localCategorias = await db.getAllAsync(
                'SELECT * FROM categorias WHERE updated_at > ?',
                [lastUpload]
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
            if (!uploadResponse.ok) {
                result.errors.push('Error subiendo categorías');
            }
        }

        // Guardar timestamp de subida
        const syncTime = getCurrentTimestamp();
        await db.runAsync(
            `INSERT OR REPLACE INTO sync_config (key, value) VALUES ('last_upload', ?)`,
            [syncTime]
        );

    } catch (error: any) {
        result.success = false;
        result.errors.push(error.message || 'Error durante subida');
    }

    return result;
}

export async function downloadChanges(db: SQLite.SQLiteDatabase): Promise<SyncResult> {
    const result: SyncResult = {
        success: true,
        uploaded: { activos: 0, auditorias: 0 },
        downloaded: { activos: 0, auditorias: 0 },
        errors: []
    };

    try {
        const conn = await checkServerConnection();
        if (!conn.ok) {
            throw new Error(`No se puede conectar al servidor: ${conn.error}`);
        }

        // Obtener última descarga
        const lastDownloadResult = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_config WHERE key = 'last_download'"
        );
        // Fallback to legacy last_sync
        const lastSyncResult = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_config WHERE key = 'last_sync'"
        );
        const lastDownload = lastDownloadResult?.value || lastSyncResult?.value || null;

        // --- DESCARGAR ACTIVOS ---
        const downloadUrl = lastDownload
            ? `${API_URL}/activos?since=${encodeURIComponent(lastDownload)}`
            : `${API_URL}/activos`;

        const downloadResponse = await fetch(downloadUrl);

        if (downloadResponse.ok) {
            const downloadData = await downloadResponse.json();
            const serverActivos = downloadData.data || [];

            for (const activo of serverActivos) {
                const localActivo = await db.getFirstAsync<{ id: number; updated_at: string }>(
                    'SELECT id, updated_at FROM activos WHERE sync_id = ?',
                    [activo.sync_id]
                );

                if (!localActivo) {
                    await db.runAsync(
                        `INSERT INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, serie)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [activo.sync_id, activo.codigo, activo.nombre, activo.edificio, activo.nivel, activo.categoria, activo.espacio, activo.updated_at, activo.serie]
                    );
                    result.downloaded.activos++;
                } else {
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

        // --- DESCARGAR AUDITORIAS ---
        const auditDownloadUrl = lastDownload
            ? `${API_URL}/auditorias?since=${encodeURIComponent(lastDownload)}`
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

        // --- DESCARGAR CATEGORIAS ---
        const catDownloadUrl = lastDownload
            ? `${API_URL}/categorias?since=${encodeURIComponent(lastDownload)}`
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


        // Guardar timestamp de descarga
        const syncTime = getCurrentTimestamp();
        await db.runAsync(
            `INSERT OR REPLACE INTO sync_config (key, value) VALUES ('last_download', ?)`,
            [syncTime]
        );

    } catch (error: any) {
        result.success = false;
        result.errors.push(error.message || 'Error durante descarga');
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
export async function checkServerConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000); // Aumentado a 7s

        console.log('Intentando conectar a:', `${API_URL}/stats`);
        const response = await fetch(`${API_URL}/stats`, {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) return { ok: true };
        return { ok: false, error: `Servidor respondió con status: ${response.status}` };
    } catch (e: any) {
        console.log('Error de conexión con:', `${API_URL}/stats`);
        console.log('Detalle error:', e.message);
        let errorMsg = e.message;
        if (e.name === 'AbortError') errorMsg = 'Tiempo de espera agotado (7s)';
        else if (e.message.includes('Network request failed')) errorMsg = 'Fallo de red (¿Servidor caído o IP incorrecta?)';
        return { ok: false, error: errorMsg };
    }
}
