import ZoomableView from '@/components/ZoomableView';
import { generateUUID, getCurrentTimestamp } from '@/utils/sync';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { copyAsync, documentDirectory, getInfoAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Dimensions,
    FlatList,
    Image,
    Modal,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Plano {
    id: number;
    sync_id: string;
    nombre: string;
    descripcion: string;
    edificio: string;
    nivel: string;
    archivo_uri: string;
    ancho: number;
    alto: number;
    created_at: string;
    updated_at: string;
}

interface ActivoPosicion {
    id: number;
    sync_id: string;
    activo_id: number;
    activo_codigo: string;
    plano_id: number;
    pos_x: number;
    pos_y: number;
    notas: string;
    created_at: string;
    updated_at: string;
}

interface Asset {
    id: number;
    codigo: string;
    nombre: string;
    edificio: string;
    nivel: string;
    categoria: string;
    espacio: string;
}

export default function PlanosScreen() {
    const db = useSQLiteContext();

    const [planos, setPlanos] = useState<Plano[]>([]);
    const [selectedPlano, setSelectedPlano] = useState<Plano | null>(null);
    const [posiciones, setPosiciones] = useState<ActivoPosicion[]>([]);

    // Modal crear/editar plano
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [planoNombre, setPlanoNombre] = useState('');
    const [planoDescripcion, setPlanoDescripcion] = useState('');
    const [planoEdificio, setPlanoEdificio] = useState('');
    const [planoNivel, setPlanoNivel] = useState('');
    const [planoImageUri, setPlanoImageUri] = useState('');
    const [editingPlano, setEditingPlano] = useState<Plano | null>(null);

    // Modal visualizar plano con pines
    const [showPlanoViewer, setShowPlanoViewer] = useState(false);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

    // Colocar pin
    const [placingPin, setPlacingPin] = useState(false);
    const [pinActivo, setPinActivo] = useState<Asset | null>(null);
    const [showAssetSearch, setShowAssetSearch] = useState(false);
    const [assetSearchText, setAssetSearchText] = useState('');
    const [assetSearchResults, setAssetSearchResults] = useState<Asset[]>([]);

    // Pin seleccionado
    const [selectedPin, setSelectedPin] = useState<ActivoPosicion | null>(null);

    // Escáner
    const [permission, requestPermission] = useCameraPermissions();
    const [showScanner, setShowScanner] = useState(false);
    const [scanned, setScanned] = useState(false);

    useEffect(() => {
        loadPlanos();
    }, []);

    const loadPlanos = async () => {
        try {
            const result = await db.getAllAsync<Plano>(
                'SELECT * FROM planos ORDER BY id DESC'
            );
            setPlanos(result);
        } catch (e) {
            console.log('Error cargando planos:', e);
        }
    };

    const loadPosiciones = async (planoId: number) => {
        try {
            const result = await db.getAllAsync<ActivoPosicion>(
                'SELECT * FROM activos_posiciones WHERE plano_id = ?',
                [planoId]
            );
            setPosiciones(result);
        } catch (e) {
            console.log('Error cargando posiciones:', e);
        }
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.8,
        });

        if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            // Copiar a directorio permanente
            const fileName = `plano_${Date.now()}.jpg`;
            const destUri = documentDirectory + fileName;
            await copyAsync({ from: asset.uri, to: destUri });
            setPlanoImageUri(destUri);

            // Obtener dimensiones
            Image.getSize(destUri, (width, height) => {
                setImageSize({ width, height });
            });
        }
    };

    const savePlano = async () => {
        if (!planoNombre.trim()) {
            Alert.alert('Error', 'El nombre es requerido');
            return;
        }
        if (!planoImageUri) {
            Alert.alert('Error', 'Debes seleccionar una imagen');
            return;
        }

        try {
            const timestamp = getCurrentTimestamp();

            if (editingPlano) {
                // Actualizar
                await db.runAsync(
                    `UPDATE planos SET nombre = ?, descripcion = ?, edificio = ?, nivel = ?, archivo_uri = ?, ancho = ?, alto = ?, updated_at = ? WHERE id = ?`,
                    [planoNombre.trim(), planoDescripcion.trim(), planoEdificio.trim(), planoNivel.trim(), planoImageUri, imageSize.width, imageSize.height, timestamp, editingPlano.id]
                );
                Alert.alert('✅ Actualizado', 'Plano actualizado correctamente');
            } else {
                // Crear nuevo
                const syncId = generateUUID();
                await db.runAsync(
                    `INSERT INTO planos (sync_id, nombre, descripcion, edificio, nivel, archivo_uri, ancho, alto, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [syncId, planoNombre.trim(), planoDescripcion.trim(), planoEdificio.trim(), planoNivel.trim(), planoImageUri, imageSize.width, imageSize.height, timestamp, timestamp]
                );
                Alert.alert('✅ Guardado', 'Plano creado correctamente');
            }

            closeCreateModal();
            loadPlanos();
        } catch (e) {
            Alert.alert('Error', 'No se pudo guardar el plano');
            console.log(e);
        }
    };

    const deletePlano = (plano: Plano) => {
        Alert.alert(
            '🗑️ Eliminar Plano',
            `¿Estás seguro de eliminar "${plano.nombre}"?\n\nTambién se eliminarán todas las posiciones de activos guardadas.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await db.runAsync('DELETE FROM activos_posiciones WHERE plano_id = ?', [plano.id]);
                            await db.runAsync('DELETE FROM planos WHERE id = ?', [plano.id]);
                            Alert.alert('✅ Eliminado', 'Plano eliminado correctamente');
                            loadPlanos();
                        } catch (e) {
                            Alert.alert('Error', 'No se pudo eliminar el plano');
                        }
                    }
                }
            ]
        );
    };

    const openPlanoViewer = async (plano: Plano) => {
        setSelectedPlano(plano);
        await loadPosiciones(plano.id);

        // Verificar que el archivo existe
        const fileInfo = await getInfoAsync(plano.archivo_uri);
        if (!fileInfo.exists) {
            Alert.alert('Error', 'El archivo del plano no existe');
            return;
        }

        // Calcular tamaño de visualización
        const width = plano.ancho || 800;
        const height = plano.alto || 600;

        const ratio = width / height;
        const displayWidth = SCREEN_WIDTH - 40; // Margen
        const displayHeight = displayWidth / ratio;

        setDisplaySize({ width: displayWidth, height: displayHeight });
        setShowPlanoViewer(true);
    };

    const closeCreateModal = () => {
        setShowCreateModal(false);
        setPlanoNombre('');
        setPlanoDescripcion('');
        setPlanoEdificio('');
        setPlanoNivel('');
        setPlanoImageUri('');
        setEditingPlano(null);
        setImageSize({ width: 0, height: 0 });
    };

    const openEditPlano = (plano: Plano) => {
        setEditingPlano(plano);
        setPlanoNombre(plano.nombre);
        setPlanoDescripcion(plano.descripcion || '');
        setPlanoEdificio(plano.edificio || '');
        setPlanoNivel(plano.nivel || '');
        setPlanoImageUri(plano.archivo_uri);
        setImageSize({ width: plano.ancho, height: plano.alto });
        setShowCreateModal(true);
    };

    // Búsqueda de activos
    const searchAssets = async (text: string) => {
        setAssetSearchText(text);
        if (text.length < 2) {
            setAssetSearchResults([]);
            return;
        }

        try {
            const results = await db.getAllAsync<Asset>(
                `SELECT * FROM activos WHERE codigo LIKE ? OR nombre LIKE ? LIMIT 20`,
                [`%${text}%`, `%${text}%`]
            );
            setAssetSearchResults(results);
        } catch (e) {
            console.log('Error buscando activos:', e);
        }
    };

    const startPlacingPin = (asset: Asset) => {
        setPinActivo(asset);
        setPlacingPin(true);
        setShowAssetSearch(false);
        setAssetSearchText('');
        setAssetSearchResults([]);
        Alert.alert('📍 Colocar Pin', `Toca en el plano para ubicar:\n\n${asset.codigo}\n${asset.nombre}`);
    };

    const handlePlanoTap = async (x: number, y: number) => {
        if (!placingPin || !pinActivo || !selectedPlano) {
            // Si no estamos colocando pin, quizás togglear controles o hacer nada
            return;
        }

        // x, y son relativos al contenedor (ZoomableView content)
        // Como el contenido tiene el tamaño exacto de displaySize, x/y corresponden directamente
        const relX = x / displaySize.width;
        const relY = y / displaySize.height;

        try {
            const timestamp = getCurrentTimestamp();
            const syncId = generateUUID();

            const existing = await db.getFirstAsync<ActivoPosicion>(
                'SELECT * FROM activos_posiciones WHERE activo_id = ? AND plano_id = ?',
                [pinActivo.id, selectedPlano.id]
            );

            if (existing) {
                await db.runAsync(
                    'UPDATE activos_posiciones SET pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ?',
                    [relX, relY, timestamp, existing.id]
                );
            } else {
                await db.runAsync(
                    `INSERT INTO activos_posiciones (sync_id, activo_id, activo_codigo, plano_id, pos_x, pos_y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [syncId, pinActivo.id, pinActivo.codigo, selectedPlano.id, relX, relY, timestamp, timestamp]
                );
            }

            Alert.alert('✅ Pin Colocado', `"${pinActivo.codigo}" ubicado en el plano`);
            setPlacingPin(false);
            setPinActivo(null);
            loadPosiciones(selectedPlano.id);
        } catch (e) {
            Alert.alert('Error', 'No se pudo guardar la posición');
            console.log(e);
        }
    };

    const deletePin = (posicion: ActivoPosicion) => {
        Alert.alert(
            '🗑️ Eliminar Pin',
            `¿Eliminar la ubicación del activo "${posicion.activo_codigo}"?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await db.runAsync('DELETE FROM activos_posiciones WHERE id = ?', [posicion.id]);
                            setSelectedPin(null);
                            if (selectedPlano) loadPosiciones(selectedPlano.id);
                        } catch (e) {
                            Alert.alert('Error', 'No se pudo eliminar');
                        }
                    }
                }
            ]
        );
    };

    const handleBarcodeScanned = async ({ data }: any) => {
        if (scanned) return;
        setScanned(true);

        const activeCode = data.split(' ')[0]; // Simple parser if needed, or just data

        try {
            const asset = await db.getFirstAsync<Asset>(
                'SELECT * FROM activos WHERE codigo = ?',
                [activeCode]
            );

            if (asset) {
                setShowScanner(false);
                setShowAssetSearch(false);
                startPlacingPin(asset);
            } else {
                Alert.alert('No encontrado', `El activo con código "${activeCode}" no existe en la base de datos.`);
                setTimeout(() => setScanned(false), 2000);
            }
        } catch (e) {
            Alert.alert('Error', 'Error buscando el activo');
            setScanned(false);
        }
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
            <ScrollView style={{ flex: 1, padding: 20 }}>
                <Text style={{ fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>🗺️ Planos</Text>
                <Text style={{ color: '#888', textAlign: 'center', marginBottom: 25 }}>Gestionar planos y ubicaciones</Text>

                {/* Botón crear plano */}
                <TouchableOpacity
                    onPress={() => setShowCreateModal(true)}
                    style={{ backgroundColor: '#5856D6', padding: 20, borderRadius: 15, alignItems: 'center', marginBottom: 20, flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                >
                    <Ionicons name="add-circle" size={28} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Nuevo Plano</Text>
                </TouchableOpacity>

                {/* Lista de planos */}
                {planos.length === 0 ? (
                    <View style={{ alignItems: 'center', marginTop: 50 }}>
                        <Ionicons name="map-outline" size={60} color="#ccc" />
                        <Text style={{ color: '#888', marginTop: 15, textAlign: 'center', fontSize: 16 }}>No hay planos</Text>
                        <Text style={{ color: '#aaa', marginTop: 5, textAlign: 'center' }}>Crea un plano y agrega ubicaciones de activos</Text>
                    </View>
                ) : (
                    <View>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 10 }}>PLANOS ({planos.length})</Text>
                        {planos.map(plano => (
                            <TouchableOpacity
                                key={plano.id}
                                onPress={() => openPlanoViewer(plano)}
                                style={{ backgroundColor: 'white', borderRadius: 12, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e8e8e8' }}
                            >
                                {/* Thumbnail del plano */}
                                <Image
                                    source={{ uri: plano.archivo_uri }}
                                    style={{ width: '100%', height: 120, backgroundColor: '#f0f0f0' }}
                                    resizeMode="cover"
                                />

                                <View style={{ padding: 12 }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Text style={{ fontSize: 16, fontWeight: '600', flex: 1 }}>{plano.nombre}</Text>
                                        <View style={{ flexDirection: 'row', gap: 10 }}>
                                            <TouchableOpacity onPress={() => openEditPlano(plano)}>
                                                <Ionicons name="pencil" size={20} color="#FF9500" />
                                            </TouchableOpacity>
                                            <TouchableOpacity onPress={() => deletePlano(plano)}>
                                                <Ionicons name="trash-outline" size={20} color="#F44336" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                    {plano.descripcion && (
                                        <Text style={{ color: '#888', fontSize: 13, marginTop: 4 }}>{plano.descripcion}</Text>
                                    )}
                                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                                        {plano.edificio && (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                <Ionicons name="business" size={14} color="#666" />
                                                <Text style={{ color: '#666', fontSize: 12 }}>{plano.edificio}</Text>
                                            </View>
                                        )}
                                        {plano.nivel && (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                <Ionicons name="layers" size={14} color="#666" />
                                                <Text style={{ color: '#666', fontSize: 12 }}>{plano.nivel}</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* Modal Crear/Editar Plano */}
            <Modal visible={showCreateModal} animationType="slide">
                <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
                    <ScrollView style={{ padding: 20 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>
                                {editingPlano ? 'Editar Plano' : 'Nuevo Plano'}
                            </Text>
                            <TouchableOpacity onPress={closeCreateModal}>
                                <Ionicons name="close-circle" size={30} color="#999" />
                            </TouchableOpacity>
                        </View>

                        {/* Nombre */}
                        <View style={{ marginBottom: 15 }}>
                            <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>NOMBRE *</Text>
                            <TextInput
                                style={{ backgroundColor: 'white', padding: 15, borderRadius: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' }}
                                placeholder="Ej: Planta Baja - Edificio A"
                                value={planoNombre}
                                onChangeText={setPlanoNombre}
                            />
                        </View>

                        {/* Descripción */}
                        <View style={{ marginBottom: 15 }}>
                            <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>DESCRIPCIÓN</Text>
                            <TextInput
                                style={{ backgroundColor: 'white', padding: 15, borderRadius: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd', minHeight: 80, textAlignVertical: 'top' }}
                                placeholder="Descripción opcional del plano..."
                                value={planoDescripcion}
                                onChangeText={setPlanoDescripcion}
                                multiline
                            />
                        </View>

                        {/* Edificio y Nivel */}
                        <View style={{ flexDirection: 'row', gap: 15, marginBottom: 15 }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>EDIFICIO</Text>
                                <TextInput
                                    style={{ backgroundColor: 'white', padding: 15, borderRadius: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' }}
                                    placeholder="Ej: Edificio A"
                                    value={planoEdificio}
                                    onChangeText={setPlanoEdificio}
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>NIVEL</Text>
                                <TextInput
                                    style={{ backgroundColor: 'white', padding: 15, borderRadius: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' }}
                                    placeholder="Ej: Piso 1"
                                    value={planoNivel}
                                    onChangeText={setPlanoNivel}
                                />
                            </View>
                        </View>

                        {/* Imagen del plano */}
                        <View style={{ marginBottom: 20 }}>
                            <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>IMAGEN DEL PLANO *</Text>

                            {planoImageUri ? (
                                <View>
                                    <Image
                                        source={{ uri: planoImageUri }}
                                        style={{ width: '100%', height: 200, borderRadius: 10, backgroundColor: '#f0f0f0' }}
                                        resizeMode="contain"
                                    />

                                    <TouchableOpacity
                                        onPress={() => setPlanoImageUri('')}
                                        style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 15, padding: 5, zIndex: 10 }}
                                    >
                                        <Ionicons name="close" size={20} color="white" />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View style={{ gap: 10 }}>
                                    <TouchableOpacity
                                        onPress={pickImage}
                                        style={{ backgroundColor: '#E3F2FD', padding: 20, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                                    >
                                        <Ionicons name="images" size={24} color="#007AFF" />
                                        <Text style={{ color: '#007AFF', fontWeight: '600' }}>Seleccionar Imagen</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>

                        {/* Botón guardar */}
                        <TouchableOpacity
                            onPress={savePlano}
                            style={{ backgroundColor: '#4CAF50', padding: 18, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                        >
                            <Ionicons name="checkmark-circle" size={24} color="white" />
                            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>
                                {editingPlano ? 'Guardar Cambios' : 'Crear Plano'}
                            </Text>
                        </TouchableOpacity>
                    </ScrollView>
                </SafeAreaView>
            </Modal>

            {/* Modal Visualizar Plano */}
            <Modal visible={showPlanoViewer} animationType="slide">
                <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
                    {/* Header */}
                    <View style={{ padding: 15, backgroundColor: '#16213e', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => { setShowPlanoViewer(false); setSelectedPlano(null); setPosiciones([]); setPlacingPin(false); setPinActivo(null); }}>
                            <Ionicons name="close-circle" size={30} color="#888" />
                        </TouchableOpacity>
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold', flex: 1, textAlign: 'center' }} numberOfLines={1}>
                            {selectedPlano?.nombre}
                        </Text>
                        <TouchableOpacity onPress={() => setShowAssetSearch(true)}>
                            <Ionicons name="add-circle" size={30} color="#4CAF50" />
                        </TouchableOpacity>
                    </View>

                    {/* Indicador de modo colocación */}
                    {placingPin && pinActivo && (
                        <View style={{ backgroundColor: '#FF9500', padding: 10, alignItems: 'center' }}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>📍 Toca para ubicar: {pinActivo.codigo}</Text>
                            <TouchableOpacity onPress={() => { setPlacingPin(false); setPinActivo(null); }}>
                                <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: 5 }}>Cancelar</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Plano con pines */}
                    {/* Plano con pines y Zoom */}
                    <View style={{ flex: 1, overflow: 'hidden' }}>
                        <ZoomableView onSingleTap={handlePlanoTap} contentWidth={displaySize.width} contentHeight={displaySize.height}>
                            {selectedPlano && (
                                <View style={{ width: displaySize.width, height: displaySize.height }}>
                                    <Image
                                        source={{ uri: selectedPlano.archivo_uri }}
                                        style={{ width: '100%', height: '100%', borderRadius: 8 }}
                                        resizeMode="contain"
                                    />

                                    {/* Renderizar pines (Overlay) */}
                                    {posiciones.map(pos => (
                                        <TouchableOpacity
                                            key={pos.id}
                                            onPress={() => setSelectedPin(selectedPin?.id === pos.id ? null : pos)}
                                            style={{
                                                position: 'absolute',
                                                left: pos.pos_x * displaySize.width - 15,
                                                top: pos.pos_y * displaySize.height - 30,
                                                zIndex: 100
                                            }}
                                        >
                                            <View style={{ alignItems: 'center' }}>
                                                <Ionicons
                                                    name="location"
                                                    size={30}
                                                    color={selectedPin?.id === pos.id ? '#FF9500' : '#F44336'}
                                                />
                                                {selectedPin?.id === pos.id && (
                                                    <View style={{ backgroundColor: 'white', padding: 8, borderRadius: 8, marginTop: 5, maxWidth: 150, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 }}>
                                                        <Text style={{ fontWeight: 'bold', fontSize: 12 }}>{pos.activo_codigo}</Text>
                                                        <TouchableOpacity onPress={() => deletePin(pos)} style={{ marginTop: 5 }}>
                                                            <Text style={{ color: '#F44336', fontSize: 11 }}>🗑️ Eliminar pin</Text>
                                                        </TouchableOpacity>
                                                    </View>
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}
                        </ZoomableView>
                    </View>

                    {/* Contador de pines */}
                    <View style={{ padding: 15, backgroundColor: '#16213e', alignItems: 'center' }}>
                        <Text style={{ color: '#888' }}>
                            {posiciones.length} activo{posiciones.length !== 1 ? 's' : ''} ubicado{posiciones.length !== 1 ? 's' : ''} en este plano
                        </Text>
                    </View>
                </SafeAreaView>
            </Modal>

            {/* Modal Buscar Activo */}
            <Modal visible={showAssetSearch} animationType="slide" transparent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
                        <View style={{ padding: 20 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                                <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Buscar Activo</Text>
                                <View style={{ flexDirection: 'row', gap: 10 }}>
                                    <TouchableOpacity onPress={() => {
                                        if (!permission?.granted) {
                                            requestPermission();
                                        }
                                        setScanned(false);
                                        setShowScanner(true);
                                    }}>
                                        <Ionicons name="scan-circle" size={32} color="#007AFF" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => { setShowAssetSearch(false); setAssetSearchText(''); setAssetSearchResults([]); }}>
                                        <Ionicons name="close-circle" size={28} color="#999" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <TextInput
                                style={{ backgroundColor: '#f0f0f0', padding: 15, borderRadius: 10, fontSize: 16 }}
                                placeholder="Buscar por código o nombre..."
                                value={assetSearchText}
                                onChangeText={searchAssets}
                                autoFocus
                            />

                            <FlatList
                                data={assetSearchResults}
                                keyExtractor={item => item.id.toString()}
                                style={{ maxHeight: 300, marginTop: 10 }}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        onPress={() => startPlacingPin(item)}
                                        style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}
                                    >
                                        <Text style={{ fontWeight: '600' }}>{item.codigo}</Text>
                                        <Text style={{ color: '#888', fontSize: 13 }}>{item.nombre}</Text>
                                        {(item.edificio || item.nivel || item.espacio) && (
                                            <Text style={{ color: '#aaa', fontSize: 11, marginTop: 4 }}>
                                                {[item.espacio, item.edificio, item.nivel].filter(Boolean).join(' • ')}
                                            </Text>
                                        )}
                                    </TouchableOpacity>
                                )}
                                ListEmptyComponent={
                                    assetSearchText.length >= 2 ? (
                                        <View style={{ padding: 20, alignItems: 'center' }}>
                                            <Text style={{ color: '#888' }}>No se encontraron activos</Text>
                                        </View>
                                    ) : (
                                        <View style={{ padding: 20, alignItems: 'center' }}>
                                            <Text style={{ color: '#888' }}>Escribe al menos 2 caracteres</Text>
                                        </View>
                                    )
                                }
                            />
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal Scanner */}
            <Modal visible={showScanner} animationType="fade">
                <View style={{ flex: 1, backgroundColor: 'black' }}>
                    <CameraView
                        style={{ flex: 1 }}
                        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                    />
                    <TouchableOpacity
                        onPress={() => setShowScanner(false)}
                        style={{ position: 'absolute', top: 50, right: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 }}
                    >
                        <Ionicons name="close" size={30} color="white" />
                    </TouchableOpacity>
                    <View style={{ position: 'absolute', bottom: 50, left: 0, right: 0, alignItems: 'center' }}>
                        <Text style={{ color: 'white', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 10 }}>
                            Escanea el código del activo
                        </Text>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}
