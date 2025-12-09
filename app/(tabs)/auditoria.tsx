import CategorySelector from '@/components/CategorySelector';
import LocationSelector from '@/components/LocationSelector';
import { generateUUID, getCurrentTimestamp } from '@/utils/sync';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { documentDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Alert, BackHandler, FlatList, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, Vibration, View } from 'react-native';

interface Asset {
    id: number;
    codigo: string;
    nombre: string;
    edificio: string;
    nivel: string;
    categoria: string;
    espacio: string;
    ubicacion_id?: number;
}

interface SobranteItem {
    codigo: string;
    nombre: string;
    espacio: string;
    edificio: string;
    nivel: string;
    existeEnBD: boolean;
}

interface Auditoria {
    id: number;
    espacio: string;
    fecha: string;
    total_esperados: number;
    total_escaneados: number;
    total_faltantes: number;
    total_escaneados_list?: string; // Optional helper
    total_faltantes_list?: string;
    total_sobrantes: number;
    codigos_escaneados: string;
    codigos_faltantes: string;
    codigos_sobrantes: string;
    estado: string;
    notas: string;
}

interface FiltroAuditoria {
    espacio: string;
    edificio: string;
    nivel: string;
    categoria: string;
    fullPath?: string;
}

export default function AuditoriaScreen() {
    const db = useSQLiteContext();
    const [permission, requestPermission] = useCameraPermissions();

    const [auditorias, setAuditorias] = useState<Auditoria[]>([]);

    // Escaneo de referencia
    const [scanningReference, setScanningReference] = useState(false);
    const [scannedRef, setScannedRef] = useState(false);

    // Filtros de la auditoría
    const [filtro, setFiltro] = useState<FiltroAuditoria | null>(null);
    const [activoReferencia, setActivoReferencia] = useState<Asset | null>(null);

    // Auditoría activa
    const [auditando, setAuditando] = useState(false);
    const [activosEsperados, setActivosEsperados] = useState<Asset[]>([]);
    const [codigosEscaneados, setCodigosEscaneados] = useState<string[]>([]);
    const [sobrantes, setSobrantes] = useState<SobranteItem[]>([]);

    // Escáner
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState(false);

    // Modales
    const [showHistorial, setShowHistorial] = useState(false);
    const [selectedAuditoria, setSelectedAuditoria] = useState<Auditoria | null>(null);
    const [showSobrantes, setShowSobrantes] = useState(false);
    const [showFaltantes, setShowFaltantes] = useState(false);
    const [showEscaneados, setShowEscaneados] = useState(false);
    const [notas, setNotas] = useState('');

    // Edición de auditoría
    const [editingAuditoria, setEditingAuditoria] = useState(false);
    const [editNotas, setEditNotas] = useState('');

    // Ingreso manual
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualCode, setManualCode] = useState('');

    // Configuración de filtros
    const [showFilterConfig, setShowFilterConfig] = useState(false);
    const [useEspacio, setUseEspacio] = useState(true);
    const [useEdificio, setUseEdificio] = useState(true);
    const [useNivel, setUseNivel] = useState(true);
    const [useCategoria, setUseCategoria] = useState(false);

    // Crear Sobrante como Activo
    const [showCreateSobrante, setShowCreateSobrante] = useState(false);
    const [newAssetCode, setNewAssetCode] = useState('');
    const [newAssetName, setNewAssetName] = useState('');
    const [newAssetSerie, setNewAssetSerie] = useState('');
    const [newAssetCategory, setNewAssetCategory] = useState('');
    const [newAssetCategoryId, setNewAssetCategoryId] = useState<number | null>(null);
    const [newAssetLocationId, setNewAssetLocationId] = useState<number | null>(null);
    const [newAssetBuilding, setNewAssetBuilding] = useState('');
    const [newAssetLevel, setNewAssetLevel] = useState('');
    const [newAssetSpace, setNewAssetSpace] = useState('');

    // Escáner para Serie
    const [scanningSerie, setScanningSerie] = useState(false);

    // Feedback visual (Toast)
    const [scanMessage, setScanMessage] = useState<{ title: string; msg: string; type: 'success' | 'warning' | 'error' } | null>(null);

    useEffect(() => {
        loadAuditorias();
    }, []);

    // Intercept Back Button when auditing
    useEffect(() => {
        const onBackPress = () => {
            if (auditando) {
                confirmarSalida();
                return true; // Prevent default behavior (exit app)
            }
            return false;
        };

        const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);

        return () => subscription.remove();
    }, [auditando]);


    const loadAuditorias = async () => {
        try {
            const result = await db.getAllAsync<Auditoria>(
                'SELECT * FROM auditorias ORDER BY id DESC LIMIT 50'
            );
            setAuditorias(result);
        } catch (e) {
            console.log('Error cargando auditorías:', e);
        }
    };

    const playSound = async (type: 'success' | 'warning' | 'error') => {
        try {
            await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

            let uri = '';
            switch (type) {
                case 'success':
                    uri = 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'; // Short positive beep
                    break;
                case 'warning':
                    uri = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'; // Double beep / soft notification
                    break;
                case 'error':
                    uri = 'https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3'; // Short negative beep
                    break;
            }

            const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
            sound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
            });
        } catch (e) {
            console.log('Error sonido:', e);
        }
    };

    const extractCode = (data: string): string => {
        const parts = data.split(' ');
        const match = parts[0].match(/^[\d-]+/);
        return match ? match[0] : parts[0];
    };

    const getLocationPath = async (ubicacionId: number): Promise<string> => {
        let currentId = ubicacionId;
        let parts: string[] = [];
        try {
            while (currentId) {
                const loc = await db.getFirstAsync<{ id: number, nombre: string, parent_id: number | null }>(
                    'SELECT id, nombre, parent_id FROM ubicaciones WHERE id = ?',
                    [currentId]
                );
                if (loc) {
                    parts.unshift(loc.nombre);
                    currentId = loc.parent_id || 0;
                } else {
                    break;
                }
            }
        } catch (e) {
            console.log('Error fetching hierarchy:', e);
        }
        return parts.join(' > ');
    };

    const onScanReference = async ({ data }: any) => {
        if (scannedRef) return;
        setScannedRef(true);
        Vibration.vibrate();

        const codigo = extractCode(data);

        try {
            const activo = await db.getFirstAsync<Asset>(
                'SELECT * FROM activos WHERE codigo = ?',
                [codigo]
            );

            if (!activo) {
                await playSound('error');
                Alert.alert('❌ No encontrado', `El código "${codigo}" no existe en la base de datos.`);
                setTimeout(() => setScannedRef(false), 1500);
                return;
            }

            await playSound('success');
            setActivoReferencia(activo);

            let hierarchyPath = '';
            if (activo.ubicacion_id) {
                hierarchyPath = await getLocationPath(activo.ubicacion_id);
            }

            setFiltro({
                espacio: activo.espacio || '',
                edificio: activo.edificio || '',
                nivel: activo.nivel || '',
                categoria: activo.categoria || '',
                fullPath: hierarchyPath
            });
            setScanningReference(false);
            setShowFilterConfig(true);

        } catch (e) {
            Alert.alert('Error', 'No se pudo buscar el activo.');
        }
        setTimeout(() => setScannedRef(false), 1500);
    };

    const onScanSerie = async ({ data }: any) => {
        setScanningSerie(false);
        Vibration.vibrate();
        await playSound('success');
        setNewAssetSerie(data);
    };

    const iniciarAuditoria = async () => {
        if (!filtro) return;

        try {
            let conditions: string[] = [];
            let params: any[] = [];

            if (useEspacio && filtro.espacio) {
                conditions.push('espacio = ?');
                params.push(filtro.espacio);
            }
            if (useEdificio && filtro.edificio) {
                conditions.push('edificio = ?');
                params.push(filtro.edificio);
            }
            if (useNivel && filtro.nivel) {
                conditions.push('nivel = ?');
                params.push(filtro.nivel);
            }
            if (useCategoria && filtro.categoria) {
                conditions.push('categoria = ?');
                params.push(filtro.categoria);
            }

            if (conditions.length === 0) {
                Alert.alert('Sin filtros', 'Debes seleccionar al menos un filtro para la auditoría.');
                return;
            }

            const whereClause = `WHERE ${conditions.join(' AND ')}`;
            const activos = await db.getAllAsync<Asset>(
                `SELECT * FROM activos ${whereClause} ORDER BY codigo`,
                params
            );

            if (activos.length === 0) {
                Alert.alert('Sin activos', 'No hay activos que coincidan con los filtros seleccionados.');
                return;
            }

            setActivosEsperados(activos);
            setCodigosEscaneados([]);
            setSobrantes([]);
            setNotas('');
            setAuditando(true);
            setShowFilterConfig(false);

        } catch (e) {
            Alert.alert('Error', 'No se pudieron cargar los activos.');
        }
    };

    const onScanAuditoria = async ({ data }: any) => {
        if (scanned) return;
        setScanned(true);
        Vibration.vibrate();

        const codigo = extractCode(data);





        // Verificar si ya fue escaneado
        if (codigosEscaneados.includes(codigo)) {
            // Alert.alert('⚠️ Duplicado', `"${codigo}" ya fue escaneado.`);
            await playSound('warning');
            setScanMessage({ title: '⚠️ Duplicado', msg: `"${codigo}" ya escaneado`, type: 'warning' });
            setTimeout(() => setScanMessage(null), 2000);
            setTimeout(() => setScanned(false), 1000);
            return;
        }

        // Verificar si es un activo esperado
        const esEsperado = activosEsperados.some(a => a.codigo === codigo);

        if (esEsperado) {
            await playSound('success');
            setCodigosEscaneados(prev => [...prev, codigo]);
            setScanMessage({ title: '✅ Correcto', msg: `Activo "${codigo}" verificado`, type: 'success' });
            setTimeout(() => setScanMessage(null), 1500);
        } else {
            await playSound('error');
            // Sobrante
            // Buscar info en DB local si existe
            const activoBD = await db.getFirstAsync<Asset>('SELECT * FROM activos WHERE codigo = ?', [codigo]);

            const nuevoSobrante: SobranteItem = {
                codigo,
                nombre: activoBD?.nombre || 'Desconocido',
                espacio: activoBD?.espacio || '',
                edificio: activoBD?.edificio || '',
                nivel: activoBD?.nivel || '',
                existeEnBD: !!activoBD
            };

            setSobrantes(prev => [...prev, nuevoSobrante]);

            if (activoBD) {
                setScanMessage({
                    title: '⚠️ Sobrante Detectado',
                    msg: `${activoBD.nombre}\nNo pertenece a esta área.`,
                    type: 'warning'
                });
            } else {
                setScanMessage({
                    title: '❓ Sobrante Nuevo',
                    msg: `Código "${codigo}" no registrado.`,
                    type: 'error'
                });
            }
            setTimeout(() => setScanMessage(null), 2500);
        }

        setTimeout(() => setScanned(false), 2000);
    };

    const handleManualSubmit = () => {
        if (!manualCode.trim()) return;
        setShowManualInput(false);
        onScanAuditoria({ data: manualCode.trim() });
        setManualCode('');
    };

    const handleSobrantePress = async (item: SobranteItem) => {
        console.log("Pressed Create for:", item.codigo);
        if (item.existeEnBD) {
            console.log("Item exists, ignoring.");
            Alert.alert('Info', 'Este activo ya existe en la base de datos.');
            return;
        }

        setNewAssetCode(item.codigo);
        setNewAssetName('');
        setNewAssetSerie('');

        // Pre-llenar con datos del filtro
        const defaultCat = filtro?.categoria || '';
        setNewAssetCategory(defaultCat);
        setNewAssetBuilding(filtro?.edificio || '');
        setNewAssetLevel(filtro?.nivel || '');
        setNewAssetSpace(filtro?.espacio || '');
        setNewAssetLocationId(null);
        setNewAssetCategoryId(null);

        // Intentar obtener el ID de la categoría si tenemos nombre
        if (defaultCat) {
            try {
                const cat = await db.getFirstAsync<{ id: number }>('SELECT id FROM categorias WHERE nombre = ?', [defaultCat]);
                if (cat) setNewAssetCategoryId(cat.id);
            } catch (e) { console.log('Error fetching cat:', e); }
        }

        console.log("Setting showCreateSobrante to true");
        // Just show it immediately on top
        setShowCreateSobrante(true);
    };

    const saveSobrante = async () => {
        if (!newAssetCode.trim() || !newAssetName.trim()) {
            Alert.alert('Error', 'Código y Nombre son obligatorios');
            return;
        }
        try {
            const syncId = generateUUID();
            const now = getCurrentTimestamp();

            await db.runAsync(
                'INSERT INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, ubicacion_id, updated_at, serie, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
                [
                    syncId,
                    newAssetCode.trim(),
                    newAssetName.trim(),
                    newAssetBuilding.trim(),
                    newAssetLevel.trim(),
                    newAssetCategory.trim(),
                    newAssetSpace.trim(),
                    newAssetLocationId,
                    now,
                    newAssetSerie.trim()
                ]
            );

            // Actualizar estado del sobrante en la lista actual
            setSobrantes(prev => prev.map(s => {
                if (s.codigo === newAssetCode) {
                    return {
                        ...s,
                        nombre: newAssetName.trim(),
                        existeEnBD: true,
                        edificio: newAssetBuilding,
                        nivel: newAssetLevel,
                        espacio: newAssetSpace
                    };
                }
                return s;
            }));

            Alert.alert('✅ Creado', 'El activo ha sido creado correctamente.');
            setShowCreateSobrante(false);
        } catch (e) {
            Alert.alert('Error', 'No se pudo crear el activo. Verifica si el código ya existe.');
            console.log(e);
        }
    };

    const eliminarSobrante = (codigo: string) => {
        setSobrantes(prev => prev.filter(s => s.codigo !== codigo));
    };

    const getEstadisticas = () => {
        const esperados = activosEsperados.length;
        const escaneados = codigosEscaneados.length;
        const faltantes = activosEsperados.filter(a => !codigosEscaneados.includes(a.codigo)).length;
        const sobrantesCount = sobrantes.length;
        const progreso = esperados > 0 ? Math.round((escaneados / esperados) * 100) : 0;

        return { esperados, escaneados, faltantes, sobrantes: sobrantesCount, progreso };
    };

    const getFiltrosActivos = () => {
        if (!filtro) return [];
        const activos = [];

        if (useEspacio && filtro.espacio) activos.push(`📍 ${filtro.espacio}`);
        if (useEdificio && filtro.edificio) activos.push(`🏢 ${filtro.edificio}`);
        if (useNivel && filtro.nivel) activos.push(`📶 ${filtro.nivel}`);
        if (useCategoria && filtro.categoria) activos.push(`🏷️ ${filtro.categoria}`);

        return activos;
    };

    const confirmarSalida = async () => {
        const stats = getEstadisticas();
        const filtrosTexto = getFiltrosActivos().join(' | ');

        Alert.alert(
            '📊 Finalizar Auditoría',
            `Filtros: ${filtrosTexto}\n\n` +
            `✅ Escaneados: ${stats.escaneados}/${stats.esperados}\n` +
            `❌ Faltantes: ${stats.faltantes}\n` +
            `⚠️ Sobrantes: ${stats.sobrantes}\n\n` +
            `¿Deseas finalizar la auditoría o guardarla para continuar después?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Guardar y Salir',
                    onPress: () => guardarProgreso()
                },
                {
                    text: 'Finalizar',
                    onPress: async () => {
                        try {
                            const faltantes = activosEsperados
                                .filter(a => !codigosEscaneados.includes(a.codigo))
                                .map(a => a.codigo);

                            await db.runAsync(
                                `INSERT INTO auditorias (sync_id, espacio, fecha, total_esperados, total_escaneados, total_faltantes, total_sobrantes, codigos_escaneados, codigos_faltantes, codigos_sobrantes, estado, notas, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    generateUUID(),
                                    getFiltrosActivos().join(' | '),
                                    new Date().toISOString(),
                                    stats.esperados,
                                    stats.escaneados,
                                    stats.faltantes,
                                    stats.sobrantes,
                                    JSON.stringify(codigosEscaneados),
                                    JSON.stringify(faltantes),
                                    JSON.stringify(sobrantes),
                                    'completada',
                                    notas,
                                    getCurrentTimestamp()
                                ]
                            );

                            Alert.alert('✅ Finalizado', 'Auditoría completada y guardada.');
                            resetAuditoria();
                            loadAuditorias();
                        } catch (e) {
                            Alert.alert('Error', 'No se pudo guardar la auditoría.');
                            console.log(e);
                        }
                    }
                }
            ]
        );
    };

    const guardarProgreso = async () => {
        const stats = getEstadisticas();
        try {
            const faltantes = activosEsperados
                .filter(a => !codigosEscaneados.includes(a.codigo))
                .map(a => a.codigo);

            if (selectedAuditoria && selectedAuditoria.estado === 'en_curso') {
                // Actualizar existente
                await db.runAsync(
                    `UPDATE auditorias SET 
                        total_escaneados = ?, 
                        total_faltantes = ?, 
                        total_sobrantes = ?, 
                        codigos_escaneados = ?, 
                        codigos_faltantes = ?, 
                        codigos_sobrantes = ?, 
                        notas = ?, 
                        updated_at = ? 
                    WHERE id = ?`,
                    [
                        stats.escaneados,
                        stats.faltantes,
                        stats.sobrantes,
                        JSON.stringify(codigosEscaneados),
                        JSON.stringify(faltantes),
                        JSON.stringify(sobrantes),
                        notas,
                        getCurrentTimestamp(),
                        selectedAuditoria.id
                    ]
                );
            } else {
                // Crear nueva en curso
                await db.runAsync(
                    `INSERT INTO auditorias (sync_id, espacio, fecha, total_esperados, total_escaneados, total_faltantes, total_sobrantes, codigos_escaneados, codigos_faltantes, codigos_sobrantes, estado, notas, updated_at, plano_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        generateUUID(),
                        getFiltrosActivos().join(' | '),
                        new Date().toISOString(),
                        stats.esperados,
                        stats.escaneados,
                        stats.faltantes,
                        stats.sobrantes,
                        JSON.stringify(codigosEscaneados),
                        JSON.stringify(faltantes),
                        JSON.stringify(sobrantes),
                        'en_curso',
                        notas,
                        getCurrentTimestamp(),
                        null // TODO: Link plano if relevant context exists
                    ]
                );
            }

            Alert.alert('💾 Guardado', 'El progreso ha sido guardado. Puedes continuar después.');
            resetAuditoria();
            loadAuditorias();
        } catch (e) {
            Alert.alert('Error', 'No se pudo guardar el progreso.');
            console.log(e);
        }
    };

    const continuarAuditoria = async (auditoria: Auditoria) => {
        try {
            const escaneados = JSON.parse(auditoria.codigos_escaneados || '[]');
            const faltantes = JSON.parse(auditoria.codigos_faltantes || '[]');
            const sobrantesData = JSON.parse(auditoria.codigos_sobrantes || '[]');

            // Reconstruir activos esperados
            const todosCodigos = [...escaneados, ...faltantes];
            if (todosCodigos.length === 0) {
                Alert.alert('Error', 'Datos de auditoría corruptos (sin códigos).');
                return;
            }

            // Fetch assets details
            // Creating a large IN query might limit sqlite but usually fine for <1000 items
            // For robustness, maybe chunks, but simple IN for now
            const placeholders = todosCodigos.map(() => '?').join(',');
            const activos = await db.getAllAsync<Asset>(
                `SELECT * FROM activos WHERE codigo IN (${placeholders})`,
                todosCodigos
            );

            setActivosEsperados(activos);
            setCodigosEscaneados(escaneados);
            setSobrantes(sobrantesData);
            setNotas(auditoria.notas || '');
            setSelectedAuditoria(auditoria); // Track for updating
            setScanning(false);
            setAuditando(true);

        } catch (e) {
            Alert.alert('Error', 'No se pudo retomar la auditoría.');
            console.log(e);
        }
    };

    const resetAuditoria = () => {
        setAuditando(false);
        setFiltro(null);
        setActivoReferencia(null);
        setActivosEsperados([]);
        setCodigosEscaneados([]);
        setSobrantes([]);
        setNotas('');
        setScanning(false);
        setUseEspacio(true);
        setUseEdificio(true);
        setUseNivel(true);
        setUseCategoria(false);
    };

    const exportarAuditoria = async (auditoria: Auditoria) => {
        try {
            const escaneados = JSON.parse(auditoria.codigos_escaneados || '[]');
            const faltantes = JSON.parse(auditoria.codigos_faltantes || '[]');
            let sobrantesData: SobranteItem[] = [];
            try {
                sobrantesData = JSON.parse(auditoria.codigos_sobrantes || '[]');
            } catch {
                sobrantesData = [];
            }

            let csv = `AUDITORÍA DE INVENTARIO\n`;
            csv += `Fecha: ${new Date(auditoria.fecha).toLocaleString()}\n`;
            csv += `Filtros: ${auditoria.espacio}\n`;
            csv += `\nRESUMEN\n`;
            csv += `Esperados,${auditoria.total_esperados}\n`;
            csv += `Escaneados,${auditoria.total_escaneados}\n`;
            csv += `Faltantes,${auditoria.total_faltantes}\n`;
            csv += `Sobrantes,${auditoria.total_sobrantes}\n`;

            csv += `\nESCANEADOS (${escaneados.length})\n`;
            escaneados.forEach((c: string) => csv += `${c}\n`);

            csv += `\nFALTANTES (${faltantes.length})\n`;
            faltantes.forEach((c: string) => csv += `${c}\n`);

            csv += `\nSOBRANTES (${sobrantesData.length})\n`;
            csv += `Codigo,Nombre,Espacio,Edificio,Nivel,EnBD\n`;
            sobrantesData.forEach((s: SobranteItem) => {
                csv += `${s.codigo},${s.nombre},${s.espacio},${s.edificio},${s.nivel},${s.existeEnBD ? 'Sí' : 'No'}\n`;
            });

            if (auditoria.notas) {
                csv += `\nNOTAS\n${auditoria.notas}\n`;
            }

            const fileName = `auditoria_${new Date(auditoria.fecha).toISOString().split('T')[0]}.csv`;
            const fileUri = documentDirectory + fileName;
            await writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });

            await Sharing.shareAsync(fileUri, {
                mimeType: 'text/csv',
                dialogTitle: 'Exportar Auditoría',
                UTI: 'public.comma-separated-values-text'
            });
        } catch (e) {
            Alert.alert('Error', 'No se pudo exportar la auditoría.');
            console.log(e);
        }
    };

    const startEditAuditoria = (auditoria: Auditoria) => {
        setEditNotas(auditoria.notas || '');
        setEditingAuditoria(true);
    };

    const saveEditAuditoria = async () => {
        if (!selectedAuditoria) return;

        try {
            await db.runAsync(
                'UPDATE auditorias SET notas = ?, updated_at = ? WHERE id = ?',
                [editNotas, getCurrentTimestamp(), selectedAuditoria.id]
            );

            Alert.alert('✅ Guardado', 'Auditoría actualizada correctamente.');
            setEditingAuditoria(false);
            setSelectedAuditoria({ ...selectedAuditoria, notas: editNotas });
            loadAuditorias();
        } catch (e) {
            Alert.alert('Error', 'No se pudo actualizar la auditoría.');
            console.log(e);
        }
    };

    const deleteAuditoria = (auditoria: Auditoria) => {
        Alert.alert(
            '🗑️ Eliminar Auditoría',
            `¿Estás seguro de que quieres eliminar esta auditoría?\n\nFecha: ${new Date(auditoria.fecha).toLocaleDateString()}\nFiltros: ${auditoria.espacio}`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await db.runAsync('DELETE FROM auditorias WHERE id = ?', [auditoria.id]);
                            Alert.alert('✅ Eliminada', 'Auditoría eliminada correctamente.');
                            setSelectedAuditoria(null);
                            loadAuditorias();
                        } catch (e) {
                            Alert.alert('Error', 'No se pudo eliminar la auditoría.');
                            console.log(e);
                        }
                    }
                }
            ]
        );
    };

    if (!permission?.granted) {
        return (
            <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                <Ionicons name="camera-outline" size={60} color="#ccc" />
                <Text style={{ fontSize: 18, marginTop: 20, textAlign: 'center' }}>Se requiere acceso a la cámara</Text>
                <TouchableOpacity onPress={requestPermission} style={{ marginTop: 20, backgroundColor: '#007AFF', padding: 15, borderRadius: 10 }}>
                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Otorgar Permiso</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // ESCANEANDO REFERENCIA
    if (scanningReference) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: 'black' }}>
                <CameraView style={{ flex: 1 }} onBarcodeScanned={onScanReference} />
                <View style={{ position: 'absolute', top: 50, left: 20, right: 20 }}>
                    <View style={{ backgroundColor: 'rgba(0,0,0,0.8)', padding: 15, borderRadius: 12 }}>
                        <Text style={{ color: 'white', fontSize: 16, textAlign: 'center', fontWeight: 'bold' }}>
                            Escanea un activo de referencia
                        </Text>
                        <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginTop: 5 }}>
                            Se usará su ubicación para definir el área de auditoría
                        </Text>
                    </View>
                </View>
                <TouchableOpacity
                    onPress={() => setScanningReference(false)}
                    style={{ position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'white', paddingHorizontal: 40, paddingVertical: 15, borderRadius: 25 }}
                >
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Cancelar</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // ESCANEANDO SERIE
    if (scanningSerie) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: 'black' }}>
                <CameraView style={{ flex: 1 }} onBarcodeScanned={onScanSerie} />
                <View style={{ position: 'absolute', top: 50, left: 20, right: 20 }}>
                    <View style={{ backgroundColor: 'rgba(0,0,0,0.8)', padding: 15, borderRadius: 12 }}>
                        <Text style={{ color: 'white', fontSize: 16, textAlign: 'center', fontWeight: 'bold' }}>
                            Escanea el Número de Serie
                        </Text>
                    </View>
                </View>
                <TouchableOpacity
                    onPress={() => setScanningSerie(false)}
                    style={{ position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'white', paddingHorizontal: 40, paddingVertical: 15, borderRadius: 25 }}
                >
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Cancelar</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // AUDITORÍA ACTIVA
    if (auditando) {
        const stats = getEstadisticas();
        const filtrosActivos = getFiltrosActivos();

        if (scanning) {
            return (
                <SafeAreaView style={{ flex: 1, backgroundColor: 'black' }}>
                    <CameraView style={{ flex: 1 }} onBarcodeScanned={onScanAuditoria} />
                    <View style={{ position: 'absolute', top: 50, left: 20, right: 20 }}>
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.8)', padding: 15, borderRadius: 12 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                                <View style={{ alignItems: 'center' }}>
                                    <Text style={{ color: '#4CAF50', fontSize: 24, fontWeight: 'bold' }}>{stats.escaneados}</Text>
                                    <Text style={{ color: '#888', fontSize: 11 }}>Escaneados</Text>
                                </View>
                                <View style={{ alignItems: 'center' }}>
                                    <Text style={{ color: '#F44336', fontSize: 24, fontWeight: 'bold' }}>{stats.faltantes}</Text>
                                    <Text style={{ color: '#888', fontSize: 11 }}>Faltantes</Text>
                                </View>
                                <View style={{ alignItems: 'center' }}>
                                    <Text style={{ color: '#FF9500', fontSize: 24, fontWeight: 'bold' }}>{stats.sobrantes}</Text>
                                    <Text style={{ color: '#888', fontSize: 11 }}>Sobrantes</Text>
                                </View>
                            </View>
                            <View style={{ marginTop: 10, backgroundColor: 'rgba(76, 175, 80, 0.3)', borderRadius: 10, height: 8 }}>
                                <View style={{ backgroundColor: '#4CAF50', borderRadius: 10, height: 8, width: `${stats.progreso}%` }} />
                            </View>
                            <Text style={{ color: '#888', fontSize: 11, textAlign: 'center', marginTop: 5 }}>{stats.progreso}% completado</Text>
                            <Text style={{ color: '#888', fontSize: 11, textAlign: 'center', marginTop: 5 }}>{stats.progreso}% completado</Text>
                        </View>
                    </View>

                    {/* Mensaje Overlay (Toast) */}
                    {scanMessage && (
                        <View style={{ position: 'absolute', top: '40%', left: 20, right: 20, alignItems: 'center', zIndex: 100 }}>
                            <View style={{
                                backgroundColor: scanMessage.type === 'success' ? '#4CAF50' : scanMessage.type === 'warning' ? '#FF9500' : '#F44336',
                                padding: 20,
                                borderRadius: 15,
                                elevation: 10,
                                shadowColor: '#000',
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.3,
                                shadowRadius: 4,
                                width: '80%'
                            }}>
                                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 20, textAlign: 'center', marginBottom: 5 }}>
                                    {scanMessage.title}
                                </Text>
                                <Text style={{ color: 'white', textAlign: 'center', fontSize: 16 }}>
                                    {scanMessage.msg}
                                </Text>
                            </View>
                        </View>
                    )}


                    <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20, gap: 10 }}>
                        <TouchableOpacity
                            onPress={() => setShowManualInput(true)}
                            style={{ backgroundColor: 'rgba(50,50,50,0.8)', padding: 15, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: '#555' }}
                        >
                            <Ionicons name="keypad" size={20} color="white" />
                            <Text style={{ fontWeight: 'bold', fontSize: 16, color: 'white' }}>Ingresar Código Manual</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => setScanning(false)}
                            style={{ backgroundColor: 'white', padding: 15, borderRadius: 12, alignItems: 'center' }}
                        >
                            <Text style={{ fontWeight: 'bold', fontSize: 16, color: 'black' }}>Ver Detalle</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Modal Ingreso Manual */}
                    <Modal visible={showManualInput} transparent animationType="slide" onRequestClose={() => setShowManualInput(false)}>
                        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }}>
                            <View style={{ backgroundColor: '#1a1a2e', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#333' }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                    <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>⌨️ Ingreso Manual</Text>
                                    <TouchableOpacity onPress={() => setShowManualInput(false)}>
                                        <Ionicons name="close-circle" size={28} color="#888" />
                                    </TouchableOpacity>
                                </View>

                                <TextInput
                                    style={{ backgroundColor: '#2d2d44', color: 'white', padding: 15, borderRadius: 10, fontSize: 18, marginBottom: 20, textAlign: 'center', letterSpacing: 2 }}
                                    placeholder="Escribe el código..."
                                    placeholderTextColor="#666"
                                    value={manualCode}
                                    onChangeText={setManualCode}
                                    autoFocus
                                    onSubmitEditing={handleManualSubmit}
                                />

                                <TouchableOpacity
                                    onPress={handleManualSubmit}
                                    style={{ backgroundColor: '#007AFF', padding: 15, borderRadius: 10, alignItems: 'center' }}
                                >
                                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Validar Código</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Modal>
                </SafeAreaView >
            );
        }

        // VISTA DE DETALLE DE AUDITORÍA
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
                <View style={{ padding: 20 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>

                        <TouchableOpacity onPress={() => {
                            Alert.alert(
                                'Auditoría en curso',
                                '¿Qué deseas hacer?',
                                [
                                    { text: 'Cancelar', style: 'cancel' },
                                    { text: 'Salir sin guardar', style: 'destructive', onPress: resetAuditoria },
                                    { text: 'Guardar progreso', onPress: guardarProgreso }
                                ]
                            );
                        }}>
                            <Ionicons name="close-circle" size={32} color="#FF6B6B" />
                        </TouchableOpacity>
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>Auditoría en curso</Text>
                        <TouchableOpacity onPress={confirmarSalida}>
                            <Ionicons name="checkmark-circle" size={32} color="#4CAF50" />
                        </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 15 }}>
                        {filtrosActivos.map((f, i) => (
                            <View key={i} style={{ backgroundColor: 'rgba(88, 86, 214, 0.3)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                                <Text style={{ color: '#5856D6', fontSize: 12 }}>{f}</Text>
                            </View>
                        ))}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                        <TouchableOpacity onPress={() => setShowEscaneados(true)} style={{ flex: 1, backgroundColor: '#2d2d44', padding: 15, borderRadius: 12, alignItems: 'center' }}>
                            <Text style={{ color: '#4CAF50', fontSize: 28, fontWeight: 'bold' }}>{stats.escaneados}</Text>
                            <Text style={{ color: '#888', fontSize: 11 }}>de {stats.esperados}</Text>
                            <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Escaneados</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowFaltantes(true)} style={{ flex: 1, backgroundColor: '#2d2d44', padding: 15, borderRadius: 12, alignItems: 'center' }}>
                            <Text style={{ color: '#F44336', fontSize: 28, fontWeight: 'bold' }}>{stats.faltantes}</Text>
                            <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Faltantes</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowSobrantes(true)} style={{ flex: 1, backgroundColor: '#2d2d44', padding: 15, borderRadius: 12, alignItems: 'center' }}>
                            <Text style={{ color: '#FF9500', fontSize: 28, fontWeight: 'bold' }}>{stats.sobrantes}</Text>
                            <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Sobrantes</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={{ backgroundColor: 'rgba(76, 175, 80, 0.2)', borderRadius: 10, height: 12, marginBottom: 10 }}>
                        <View style={{ backgroundColor: '#4CAF50', borderRadius: 10, height: 12, width: `${stats.progreso}%` }} />
                    </View>
                    <Text style={{ color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>{stats.progreso}% completado</Text>

                    <TouchableOpacity
                        onPress={() => setScanning(true)}
                        style={{ backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                    >
                        <Ionicons name="scan" size={24} color="white" />
                        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Continuar Escaneando</Text>
                    </TouchableOpacity>

                    <TextInput
                        style={{ backgroundColor: '#2d2d44', color: 'white', padding: 15, borderRadius: 10, marginTop: 15 }}
                        placeholder="Notas de la auditoría..."
                        placeholderTextColor="#666"
                        value={notas}
                        onChangeText={setNotas}
                        multiline
                    />
                </View>

                {/* Modal Escaneados */}
                <Modal visible={showEscaneados} animationType="slide">
                    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
                        <View style={{ padding: 20 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>✅ Escaneados ({codigosEscaneados.length})</Text>
                                <TouchableOpacity onPress={() => setShowEscaneados(false)}>
                                    <Ionicons name="close-circle" size={30} color="#888" />
                                </TouchableOpacity>
                            </View>

                            <FlatList
                                data={codigosEscaneados}
                                keyExtractor={(item, i) => `${item}-${i}`}
                                renderItem={({ item }) => {
                                    const asset = activosEsperados.find(a => a.codigo === item);
                                    return (
                                        <View style={{ backgroundColor: 'rgba(76, 175, 80, 0.1)', padding: 12, borderRadius: 10, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: '#4CAF50' }}>
                                            <Text style={{ color: 'white', fontWeight: 'bold' }}>{item}</Text>
                                            <Text style={{ color: '#aaa', fontSize: 13 }}>{asset ? asset.nombre : 'Desconocido'}</Text>
                                            {asset && (
                                                <Text style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                                                    📍 {asset.espacio || 'Sin espacio'} • 🏢 {asset.edificio || 'N/A'} • 📶 {asset.nivel || 'N/A'}
                                                </Text>
                                            )}
                                        </View>
                                    );
                                }}
                                ListEmptyComponent={
                                    <View style={{ alignItems: 'center', marginTop: 50 }}>
                                        <Ionicons name="scan-circle" size={50} color="#4CAF50" />
                                        <Text style={{ color: '#888', marginTop: 10 }}>Aún no has escaneado nada</Text>
                                    </View>
                                }
                            />
                        </View>
                    </SafeAreaView>
                </Modal>

                {/* Modal Faltantes */}
                <Modal visible={showFaltantes} animationType="slide">
                    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
                        <View style={{ padding: 20 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>❌ Faltantes ({stats.faltantes})</Text>
                                <TouchableOpacity onPress={() => setShowFaltantes(false)}>
                                    <Ionicons name="close-circle" size={30} color="#888" />
                                </TouchableOpacity>
                            </View>

                            <FlatList
                                data={activosEsperados.filter(a => !codigosEscaneados.includes(a.codigo))}
                                keyExtractor={(item) => item.id.toString()}
                                renderItem={({ item }) => (
                                    <View style={{ backgroundColor: 'rgba(244, 67, 54, 0.1)', padding: 12, borderRadius: 10, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: '#F44336' }}>
                                        <Text style={{ color: 'white', fontWeight: 'bold' }}>{item.codigo}</Text>
                                        <Text style={{ color: '#aaa', fontSize: 13 }}>{item.nombre}</Text>
                                        <Text style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                                            📍 {item.espacio || 'Sin espacio'} • 🏢 {item.edificio || 'N/A'} • 📶 {item.nivel || 'N/A'}
                                        </Text>
                                    </View>
                                )}
                                ListEmptyComponent={
                                    <View style={{ alignItems: 'center', marginTop: 50 }}>
                                        <Ionicons name="checkmark-done-circle" size={50} color="#4CAF50" />
                                        <Text style={{ color: '#888', marginTop: 10 }}>¡Todo escaneado!</Text>
                                    </View>
                                }
                            />
                        </View>
                    </SafeAreaView>
                </Modal>

                {/* Modal Sobrantes (Integrated Create Form) */}
                <Modal visible={showSobrantes} animationType="slide">
                    <SafeAreaView style={{ flex: 1, backgroundColor: showCreateSobrante ? '#f4f4f4' : '#1a1a2e' }}>
                        {showCreateSobrante ? (
                            <ScrollView style={{ padding: 20 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                    <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Crear Activo (Sobrante)</Text>
                                    <TouchableOpacity onPress={() => setShowCreateSobrante(false)}>
                                        <Ionicons name="close-circle" size={30} color="#999" />
                                    </TouchableOpacity>
                                </View>

                                <View style={{ backgroundColor: 'white', padding: 20, borderRadius: 12, marginBottom: 20 }}>
                                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CÓDIGO *</Text>
                                    <TextInput value={newAssetCode} onChangeText={setNewAssetCode} editable={false} style={{ backgroundColor: '#f0f0f0', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd', color: '#666' }} />

                                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>NOMBRE *</Text>
                                    <TextInput value={newAssetName} onChangeText={setNewAssetName} placeholder="Nombre del activo" style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} />

                                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>SERIE</Text>
                                    <View style={{ flexDirection: 'row', gap: 10 }}>
                                        <TextInput
                                            value={newAssetSerie}
                                            onChangeText={setNewAssetSerie}
                                            placeholder="Número de serie"
                                            style={{ flex: 1, backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }}
                                        />
                                        <TouchableOpacity
                                            onPress={() => setScanningSerie(true)}
                                            style={{ backgroundColor: '#007AFF', padding: 12, borderRadius: 8, marginBottom: 12, justifyContent: 'center', alignItems: 'center', width: 50 }}
                                        >
                                            <Ionicons name="barcode-outline" size={24} color="white" />
                                        </TouchableOpacity>
                                    </View>

                                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CATEGORÍA</Text>
                                    <CategorySelector value={newAssetCategoryId} onSelect={(cat) => { setNewAssetCategory(cat.nombre); setNewAssetCategoryId(cat.id); }} placeholder={newAssetCategory || "Seleccionar categoría"} />

                                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>UBICACIÓN</Text>
                                    <LocationSelector value={newAssetLocationId} onSelect={(loc, fullPath) => { setNewAssetLocationId(loc.id); if (fullPath.length >= 1) setNewAssetBuilding(fullPath[0].nombre); if (fullPath.length >= 2) setNewAssetLevel(fullPath[1].nombre); if (fullPath.length >= 3) setNewAssetSpace(fullPath[2].nombre); }} placeholder={newAssetSpace || "Seleccionar ubicación"} />

                                    {!newAssetLocationId && (newAssetBuilding || newAssetLevel || newAssetSpace) && (
                                        <Text style={{ fontSize: 11, color: '#666', marginTop: -5, marginBottom: 10, fontStyle: 'italic' }}>
                                            Contexto actual: {newAssetSpace} {newAssetLevel} {newAssetBuilding}
                                        </Text>
                                    )}

                                    <TouchableOpacity onPress={saveSobrante} style={{ backgroundColor: '#34C759', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 20 }}>
                                        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Guardar Activo</Text>
                                    </TouchableOpacity>
                                </View>
                            </ScrollView>
                        ) : (
                            <View style={{ padding: 20 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                    <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>⚠️ Sobrantes ({sobrantes.length})</Text>
                                    <TouchableOpacity onPress={() => setShowSobrantes(false)}>
                                        <Ionicons name="close-circle" size={30} color="#888" />
                                    </TouchableOpacity>
                                </View>

                                <FlatList
                                    data={sobrantes}
                                    keyExtractor={(item, i) => `${item.codigo}-${i}`}
                                    renderItem={({ item }) => (
                                        <View style={{ backgroundColor: 'rgba(255,149,0,0.1)', padding: 12, borderRadius: 10, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: '#FF9500', flexDirection: 'row', alignItems: 'center' }}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ color: 'white', fontWeight: 'bold' }}>{item.codigo}</Text>
                                                <Text style={{ color: '#aaa', fontSize: 13 }}>{item.nombre}</Text>
                                                {item.existeEnBD ? (
                                                    <Text style={{ color: '#888', fontSize: 11, marginTop: 4 }}>📍 {item.espacio || 'Sin espacio'} • 🏢 {item.edificio || 'N/A'} • 📶 {item.nivel || 'N/A'}</Text>
                                                ) : (
                                                    <Text style={{ color: '#F44336', fontSize: 11, marginTop: 4 }}>❌ No registrado en BD</Text>
                                                )}
                                            </View>
                                            {!item.existeEnBD && (
                                                <TouchableOpacity onPress={() => handleSobrantePress(item)} style={{ backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 10 }}>
                                                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>+ Crear</Text>
                                                </TouchableOpacity>
                                            )}
                                            <TouchableOpacity onPress={() => eliminarSobrante(item.codigo)} style={{ padding: 8 }}>
                                                <Ionicons name="trash-outline" size={20} color="#F44336" />
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                    ListEmptyComponent={
                                        <View style={{ alignItems: 'center', marginTop: 50 }}>
                                            <Ionicons name="checkmark-circle" size={50} color="#4CAF50" />
                                            <Text style={{ color: '#888', marginTop: 10 }}>No hay sobrantes</Text>
                                        </View>
                                    }
                                />
                            </View>
                        )}
                    </SafeAreaView>
                </Modal>
            </SafeAreaView>
        );
    }

    // VISTA PRINCIPAL
    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
            <ScrollView style={{ flex: 1, padding: 20 }}>
                <Text style={{ fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>📋 Auditoría</Text>
                <Text style={{ color: '#888', textAlign: 'center', marginBottom: 25 }}>Verificar activos por área</Text>

                <TouchableOpacity
                    onPress={() => setScanningReference(true)}
                    style={{ backgroundColor: '#5856D6', padding: 25, borderRadius: 15, alignItems: 'center', marginBottom: 20 }}
                >
                    <Ionicons name="scan-circle" size={50} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18, marginTop: 10 }}>Nueva Auditoría</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 5, textAlign: 'center' }}>
                        Escanea un activo de referencia{'\n'}para definir el área
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={() => setShowHistorial(true)}
                    style={{ backgroundColor: 'white', padding: 15, borderRadius: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#e0e0e0' }}
                >
                    <Ionicons name="time-outline" size={24} color="#666" />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={{ fontWeight: '600' }}>Historial de Auditorías</Text>
                        <Text style={{ color: '#888', fontSize: 13 }}>{auditorias.length} auditorías guardadas</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
                </TouchableOpacity>

                {auditorias.length > 0 && (
                    <View>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 10 }}>AUDITORÍAS RECIENTES</Text>
                        {auditorias.slice(0, 3).map(a => (
                            <TouchableOpacity
                                key={a.id}
                                onPress={() => {
                                    if (a.estado === 'en_curso') {
                                        Alert.alert(
                                            'Auditoría en Curso',
                                            'Esta auditoría no ha sido finalizada.',
                                            [
                                                { text: 'Ver Detalles', onPress: () => setSelectedAuditoria(a) },
                                                { text: 'Continuar Escaneando', onPress: () => continuarAuditoria(a) }
                                            ]
                                        );
                                    } else {
                                        setSelectedAuditoria(a);
                                    }
                                }}
                                style={{
                                    backgroundColor: a.estado === 'en_curso' ? '#E3F2FD' : 'white',
                                    padding: 12,
                                    borderRadius: 10,
                                    marginBottom: 8,
                                    borderWidth: 1,
                                    borderColor: a.estado === 'en_curso' ? '#2196F3' : '#e8e8e8',
                                    borderLeftWidth: a.estado === 'en_curso' ? 4 : 1,
                                    borderLeftColor: a.estado === 'en_curso' ? '#2196F3' : '#e8e8e8'
                                }}
                            >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                    <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{a.espacio}</Text>
                                    <Text style={{ color: '#888', fontSize: 12 }}>{new Date(a.fecha).toLocaleDateString()}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', marginTop: 8, gap: 10 }}>
                                    <Text style={{ color: '#4CAF50', fontSize: 12 }}>✅ {a.total_escaneados}</Text>
                                    <Text style={{ color: '#F44336', fontSize: 12 }}>❌ {a.total_faltantes}</Text>
                                    <Text style={{ color: '#FF9500', fontSize: 12 }}>⚠️ {a.total_sobrantes}</Text>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* Modal Configurar Filtros */}
            <Modal visible={showFilterConfig} animationType="slide">
                <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
                    <ScrollView style={{ padding: 20 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Configurar Auditoría</Text>
                            <TouchableOpacity onPress={() => { setShowFilterConfig(false); setActivoReferencia(null); setFiltro(null); }}>
                                <Ionicons name="close-circle" size={30} color="#999" />
                            </TouchableOpacity>
                        </View>

                        {activoReferencia && (
                            <View style={{ backgroundColor: '#E3F2FD', padding: 15, borderRadius: 12, marginBottom: 20 }}>
                                <Text style={{ fontSize: 12, color: '#666', marginBottom: 5 }}>ACTIVO DE REFERENCIA</Text>
                                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#007AFF' }}>{activoReferencia.codigo}</Text>
                                <Text style={{ color: '#333' }}>{activoReferencia.nombre}</Text>
                                {filtro?.fullPath && (
                                    <Text style={{ color: '#555', marginTop: 5, fontStyle: 'italic', fontSize: 13 }}>📍 {filtro.fullPath}</Text>
                                )}
                            </View>
                        )}

                        <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 15 }}>Selecciona los filtros a aplicar:</Text>

                        {filtro?.espacio && (
                            <TouchableOpacity
                                onPress={() => setUseEspacio(!useEspacio)}
                                style={{ flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: useEspacio ? '#E8F5E9' : 'white', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: useEspacio ? '#4CAF50' : '#e0e0e0' }}
                            >
                                <Ionicons name={useEspacio ? 'checkbox' : 'square-outline'} size={24} color={useEspacio ? '#4CAF50' : '#999'} />
                                <View style={{ marginLeft: 12 }}>
                                    <Text style={{ fontSize: 12, color: '#888' }}>ESPACIO</Text>
                                    <Text style={{ fontWeight: '600' }}>📍 {filtro.espacio}</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {filtro?.edificio && (
                            <TouchableOpacity
                                onPress={() => setUseEdificio(!useEdificio)}
                                style={{ flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: useEdificio ? '#E8F5E9' : 'white', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: useEdificio ? '#4CAF50' : '#e0e0e0' }}
                            >
                                <Ionicons name={useEdificio ? 'checkbox' : 'square-outline'} size={24} color={useEdificio ? '#4CAF50' : '#999'} />
                                <View style={{ marginLeft: 12 }}>
                                    <Text style={{ fontSize: 12, color: '#888' }}>EDIFICIO</Text>
                                    <Text style={{ fontWeight: '600' }}>🏢 {filtro.edificio}</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {filtro?.nivel && (
                            <TouchableOpacity
                                onPress={() => setUseNivel(!useNivel)}
                                style={{ flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: useNivel ? '#E8F5E9' : 'white', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: useNivel ? '#4CAF50' : '#e0e0e0' }}
                            >
                                <Ionicons name={useNivel ? 'checkbox' : 'square-outline'} size={24} color={useNivel ? '#4CAF50' : '#999'} />
                                <View style={{ marginLeft: 12 }}>
                                    <Text style={{ fontSize: 12, color: '#888' }}>NIVEL</Text>
                                    <Text style={{ fontWeight: '600' }}>📶 {filtro.nivel}</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {filtro?.categoria && (
                            <TouchableOpacity
                                onPress={() => setUseCategoria(!useCategoria)}
                                style={{ flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: useCategoria ? '#E8F5E9' : 'white', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: useCategoria ? '#4CAF50' : '#e0e0e0' }}
                            >
                                <Ionicons name={useCategoria ? 'checkbox' : 'square-outline'} size={24} color={useCategoria ? '#4CAF50' : '#999'} />
                                <View style={{ marginLeft: 12 }}>
                                    <Text style={{ fontSize: 12, color: '#888' }}>CATEGORÍA</Text>
                                    <Text style={{ fontWeight: '600' }}>🏷️ {filtro.categoria}</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        <View style={{ marginTop: 20, marginBottom: 30 }}>
                            <TouchableOpacity
                                onPress={iniciarAuditoria}
                                style={{ backgroundColor: '#4CAF50', padding: 18, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                            >
                                <Ionicons name="play" size={24} color="white" />
                                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Iniciar Auditoría</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </SafeAreaView>
            </Modal>

            {/* Modal Historial */}
            <Modal visible={showHistorial} animationType="slide">
                <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
                    <View style={{ padding: 20 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>📋 Historial</Text>
                            <TouchableOpacity onPress={() => setShowHistorial(false)}>
                                <Ionicons name="close-circle" size={30} color="#999" />
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={auditorias}
                            keyExtractor={a => a.id.toString()}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    onPress={() => { setSelectedAuditoria(item); setShowHistorial(false); }}
                                    style={{ backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e8e8e8' }}
                                >
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                        <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{item.espacio}</Text>
                                        <Text style={{ color: '#888', fontSize: 12 }}>{new Date(item.fecha).toLocaleDateString()}</Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', marginTop: 8, gap: 15 }}>
                                        <Text style={{ color: '#4CAF50', fontSize: 12 }}>✅ {item.total_escaneados}/{item.total_esperados}</Text>
                                        <Text style={{ color: '#F44336', fontSize: 12 }}>❌ {item.total_faltantes}</Text>
                                        <Text style={{ color: '#FF9500', fontSize: 12 }}>⚠️ {item.total_sobrantes}</Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                <View style={{ alignItems: 'center', marginTop: 50 }}>
                                    <Ionicons name="clipboard-outline" size={50} color="#ccc" />
                                    <Text style={{ color: '#888', marginTop: 10 }}>No hay auditorías guardadas</Text>
                                </View>
                            }
                        />
                    </View>
                </SafeAreaView>
            </Modal>

            {/* Modal Detalle Auditoría */}
            <Modal visible={!!selectedAuditoria} animationType="slide">
                <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
                    <ScrollView style={{ padding: 20 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>
                                {editingAuditoria ? 'Editar Auditoría' : 'Detalle'}
                            </Text>
                            <TouchableOpacity onPress={() => { setSelectedAuditoria(null); setEditingAuditoria(false); }}>
                                <Ionicons name="close-circle" size={30} color="#999" />
                            </TouchableOpacity>
                        </View>

                        {selectedAuditoria && (
                            <>
                                <View style={{ backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 15 }}>
                                    <Text style={{ color: '#888', fontSize: 12 }}>FILTROS APLICADOS</Text>
                                    <Text style={{ fontSize: 16, fontWeight: '600', marginTop: 4 }}>{selectedAuditoria.espacio}</Text>
                                    <Text style={{ color: '#888', marginTop: 8 }}>{new Date(selectedAuditoria.fecha).toLocaleString()}</Text>
                                </View>

                                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                                    <View style={{ flex: 1, backgroundColor: '#E8F5E9', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                                        <Text style={{ color: '#4CAF50', fontSize: 24, fontWeight: 'bold' }}>{selectedAuditoria.total_escaneados}</Text>
                                        <Text style={{ color: '#666', fontSize: 12 }}>Escaneados</Text>
                                    </View>
                                    <View style={{ flex: 1, backgroundColor: '#FFEBEE', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                                        <Text style={{ color: '#F44336', fontSize: 24, fontWeight: 'bold' }}>{selectedAuditoria.total_faltantes}</Text>
                                        <Text style={{ color: '#666', fontSize: 12 }}>Faltantes</Text>
                                    </View>
                                    <View style={{ flex: 1, backgroundColor: '#FFF3E0', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                                        <Text style={{ color: '#FF9500', fontSize: 24, fontWeight: 'bold' }}>{selectedAuditoria.total_sobrantes}</Text>
                                        <Text style={{ color: '#666', fontSize: 12 }}>Sobrantes</Text>
                                    </View>
                                </View>

                                {/* Sección de Notas - Editable o solo lectura */}
                                {editingAuditoria ? (
                                    <View style={{ backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 15 }}>
                                        <Text style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>NOTAS</Text>
                                        <TextInput
                                            style={{
                                                backgroundColor: '#f8f8f8',
                                                padding: 12,
                                                borderRadius: 8,
                                                fontSize: 15,
                                                minHeight: 100,
                                                textAlignVertical: 'top',
                                                borderWidth: 1,
                                                borderColor: '#ddd'
                                            }}
                                            placeholder="Escribe notas sobre esta auditoría..."
                                            placeholderTextColor="#999"
                                            value={editNotas}
                                            onChangeText={setEditNotas}
                                            multiline
                                        />
                                    </View>
                                ) : (
                                    <View style={{ backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 15 }}>
                                        <Text style={{ color: '#888', fontSize: 12, marginBottom: 5 }}>NOTAS</Text>
                                        <Text style={{ color: selectedAuditoria.notas ? '#333' : '#999' }}>
                                            {selectedAuditoria.notas || 'Sin notas'}
                                        </Text>
                                    </View>
                                )}

                                {/* Botones de acción */}
                                {editingAuditoria ? (
                                    <View style={{ gap: 10 }}>
                                        <TouchableOpacity
                                            onPress={saveEditAuditoria}
                                            style={{ backgroundColor: '#4CAF50', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                                        >
                                            <Ionicons name="checkmark-circle" size={20} color="white" />
                                            <Text style={{ color: 'white', fontWeight: 'bold' }}>Guardar Cambios</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => setEditingAuditoria(false)}
                                            style={{ backgroundColor: '#888', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                                        >
                                            <Ionicons name="close" size={20} color="white" />
                                            <Text style={{ color: 'white', fontWeight: 'bold' }}>Cancelar</Text>
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <View style={{ gap: 10 }}>
                                        <TouchableOpacity
                                            onPress={() => exportarAuditoria(selectedAuditoria)}
                                            style={{ backgroundColor: '#007AFF', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                                        >
                                            <Ionicons name="share-outline" size={20} color="white" />
                                            <Text style={{ color: 'white', fontWeight: 'bold' }}>Exportar CSV</Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            onPress={() => startEditAuditoria(selectedAuditoria)}
                                            style={{ backgroundColor: '#FF9500', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                                        >
                                            <Ionicons name="pencil" size={20} color="white" />
                                            <Text style={{ color: 'white', fontWeight: 'bold' }}>Editar Notas</Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            onPress={() => deleteAuditoria(selectedAuditoria)}
                                            style={{ backgroundColor: '#F44336', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                                        >
                                            <Ionicons name="trash-outline" size={20} color="white" />
                                            <Text style={{ color: 'white', fontWeight: 'bold' }}>Eliminar Auditoría</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </>
                        )}
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        </SafeAreaView >
    );
}


