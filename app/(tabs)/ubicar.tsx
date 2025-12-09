import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useState } from 'react';
import { Alert, FlatList, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';

import LocationSelector from '@/components/LocationSelector';
import LocationTreeView from '@/components/LocationTreeView';
import { getCurrentTimestamp } from '@/utils/sync';
import { Ubicacion } from '../types';

interface Asset {
    id: number;
    codigo: string;
    nombre: string;
    edificio: string;
    nivel: string;
    categoria: string;
    espacio: string;
    ubicacion_id?: number | null;
}

interface ScannedItem {
    codigo: string;
    nombre: string;
    espacioAnterior: string;
    edificioAnterior: string;
    nivelAnterior: string;
    existeEnBD: boolean;
}

export default function UbicarScreen() {
    const db = useSQLiteContext();
    const router = useRouter();
    const [permission, requestPermission] = useCameraPermissions();

    // Ubicación destino
    const [espacio, setEspacio] = useState('');
    const [edificio, setEdificio] = useState('');
    const [nivel, setNivel] = useState('');
    const [ubicacionId, setUbicacionId] = useState<number | null>(null);
    const [ubicacionPath, setUbicacionPath] = useState<Ubicacion[]>([]);

    // Modo
    const [modoAsignacion, setModoAsignacion] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState(false);

    // Activos escaneados
    const [escaneados, setEscaneados] = useState<ScannedItem[]>([]);

    // Modals
    const [showConfig, setShowConfig] = useState(false);
    const [showLocationChange, setShowLocationChange] = useState(false);

    const handleLocationSelect = (loc: Ubicacion, fullPath: Ubicacion[]) => {
        setUbicacionId(loc.id);
        setUbicacionPath(fullPath);

        // Reset old fields
        setEdificio('');
        setNivel('');
        setEspacio('');

        // Fill based on path
        fullPath.forEach(item => {
            if (item.tipo === 'edificio') setEdificio(item.nombre);
            if (item.tipo === 'nivel') setNivel(item.nombre);
            if (item.tipo === 'area') setEspacio(item.nombre);
        });
    };

    const playSound = async (success: boolean) => {
        try {
            await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
            const uri = success
                ? 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
                : 'https://assets.mixkit.co/active_storage/sfx/2955/2955-preview.mp3';
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

    const iniciarAsignacion = () => {
        if (!ubicacionId) {
            Alert.alert('Error', 'Debes seleccionar una ubicación');
            return;
        }
        setEscaneados([]);
        setModoAsignacion(true);
        setShowConfig(false);
    };

    const onScan = async ({ data }: any) => {
        if (scanned) return;
        setScanned(true);
        Vibration.vibrate();

        const codigo = extractCode(data);

        if (escaneados.some(e => e.codigo === codigo)) {
            Alert.alert('⚠️ Duplicado', `"${codigo}" ya está en la lista.`);
            setTimeout(() => setScanned(false), 1000);
            return;
        }

        const activo = await db.getFirstAsync<Asset>(
            'SELECT * FROM activos WHERE codigo = ?',
            [codigo]
        );

        if (activo) {
            await playSound(true);
            const nuevoItem: ScannedItem = {
                codigo,
                nombre: activo.nombre,
                espacioAnterior: activo.espacio || '',
                edificioAnterior: activo.edificio || '',
                nivelAnterior: activo.nivel || '',
                existeEnBD: true
            };
            setEscaneados(prev => [...prev, nuevoItem]);
            Alert.alert('✅ Agregado', activo.nombre);
        } else {
            await playSound(false);
            Alert.alert('❌ No encontrado', `El código "${codigo}" no existe.`);
        }

        setTimeout(() => setScanned(false), 1500);
    };

    const eliminarEscaneado = (codigo: string) => {
        setEscaneados(prev => prev.filter(e => e.codigo !== codigo));
    };

    const guardarCambios = async () => {
        if (escaneados.length === 0) {
            Alert.alert('Sin activos', 'No hay activos escaneados.');
            return;
        }

        const activos = escaneados.filter(e => e.existeEnBD);

        Alert.alert(
            '💾 Guardar cambios',
            `Se actualizarán ${activos.length} activos.\n¿Continuar?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Guardar',
                    onPress: async () => {
                        try {
                            let updated = 0;
                            const timestamp = getCurrentTimestamp();

                            for (const item of activos) {
                                await db.runAsync(
                                    'UPDATE activos SET espacio = ?, edificio = ?, nivel = ?, ubicacion_id = ?, updated_at = ? WHERE codigo = ?',
                                    [espacio.trim(), edificio.trim(), nivel.trim(), ubicacionId, timestamp, item.codigo]
                                );
                                updated++;
                            }

                            Alert.alert('✅ Completado', `Se actualizaron ${updated} activos.`);
                            setModoAsignacion(false);
                            setEscaneados([]);
                            setEspacio('');
                            setEdificio('');
                            setNivel('');
                            setUbicacionId(null);
                            setUbicacionPath([]);
                        } catch (e) {
                            Alert.alert('Error', 'No se pudieron guardar los cambios.');
                        }
                    }
                }
            ]
        );
    };

    const cancelarAsignacion = () => {
        if (escaneados.length > 0) {
            Alert.alert(
                'Cancelar',
                `¿Descartar ${escaneados.length} activos escaneados?`,
                [
                    { text: 'No', style: 'cancel' },
                    { text: 'Sí', style: 'destructive', onPress: () => setModoAsignacion(false) }
                ]
            );
        } else {
            setModoAsignacion(false);
        }
    };

    if (!permission?.granted) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.permissionContainer}>
                    <Ionicons name="camera-outline" size={60} color="#ccc" />
                    <Text style={styles.permissionText}>Se requiere acceso a la cámara</Text>
                    <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
                        <Text style={styles.permissionButtonText}>Otorgar Permiso</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    // MODO ASIGNACIÓN ACTIVO
    if (modoAsignacion) {
        return (
            <SafeAreaView style={styles.assignmentContainer}>
                {scanning ? (
                    <View style={{ flex: 1 }}>
                        <CameraView style={{ flex: 1 }} onBarcodeScanned={onScan} />

                        <View style={styles.scannerOverlay}>
                            <View style={styles.scannerInfo}>
                                <Text style={styles.scannerTitle}>Asignando ubicación:</Text>

                                {/* Ruta jerárquica compacta */}
                                <View style={styles.hierarchicalPath}>
                                    {ubicacionPath.map((item, index) => (
                                        <React.Fragment key={item.id}>
                                            <View style={styles.pathLevel}>
                                                <Text style={styles.pathLevelIcon}>
                                                    {item.tipo === 'edificio' ? '🏢' : item.tipo === 'nivel' ? '📶' : '📍'}
                                                </Text>
                                                <Text style={styles.pathLevelText}>{item.nombre}</Text>
                                            </View>
                                            {index < ubicacionPath.length - 1 && (
                                                <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.7)" style={{ marginHorizontal: 6 }} />
                                            )}
                                        </React.Fragment>
                                    ))}
                                </View>

                                <View style={styles.counterBadge}>
                                    <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
                                    <Text style={styles.counter}>{escaneados.length} escaneados</Text>
                                </View>
                            </View>
                        </View>

                        <TouchableOpacity onPress={() => setScanning(false)} style={styles.viewListButton}>
                            <Text style={styles.viewListButtonText}>Ver Lista</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={{ flex: 1 }}>
                        <View style={styles.header}>
                            <TouchableOpacity onPress={cancelarAsignacion}>
                                <Ionicons name="close-circle" size={32} color="#FF6B6B" />
                            </TouchableOpacity>
                            <Text style={styles.headerTitle}>Asignar Ubicación</Text>
                            <TouchableOpacity onPress={guardarCambios}>
                                <Ionicons name="checkmark-circle" size={32} color="#4CAF50" />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.locationInfo}>
                            <Text style={styles.locationLabel}>UBICACIÓN DESTINO</Text>
                            <View style={styles.pathContainer}>
                                {ubicacionPath.map((item, index) => (
                                    <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={[styles.pathChip, { backgroundColor: item.tipo === 'edificio' ? '#FF9500' : item.tipo === 'nivel' ? '#34C759' : '#5856D6' }]}>
                                            <Text style={styles.pathText}>
                                                {item.tipo === 'edificio' ? '🏢' : item.tipo === 'nivel' ? '📶' : '📍'} {item.nombre}
                                            </Text>
                                        </View>
                                        {index < ubicacionPath.length - 1 && (
                                            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" style={{ marginHorizontal: 6 }} />
                                        )}
                                    </View>
                                ))}
                            </View>
                            <Text style={styles.counterBig}>{escaneados.length}</Text>
                            <Text style={styles.counterLabel}>activos escaneados</Text>
                        </View>

                        <FlatList
                            data={escaneados}
                            keyExtractor={(item, i) => `${item.codigo}-${i}`}
                            style={styles.list}
                            renderItem={({ item }) => (
                                <View style={styles.listItem}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.itemCode}>{item.codigo}</Text>
                                        <Text style={styles.itemName}>{item.nombre}</Text>

                                        {/* Ruta jerárquica de ubicación */}
                                        <View style={styles.locationPath}>
                                            {ubicacionPath.map((loc, index) => (
                                                <View key={loc.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                    <Text style={styles.locationPathText}>
                                                        {loc.tipo === 'edificio' ? '🏢' : loc.tipo === 'nivel' ? '📶' : '📍'} {loc.nombre}
                                                    </Text>
                                                    {index < ubicacionPath.length - 1 && (
                                                        <Ionicons name="chevron-forward" size={12} color="#888" style={{ marginHorizontal: 4 }} />
                                                    )}
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                    <TouchableOpacity onPress={() => eliminarEscaneado(item.codigo)}>
                                        <Ionicons name="trash-outline" size={20} color="#F44336" />
                                    </TouchableOpacity>
                                </View>
                            )}
                            ListEmptyComponent={
                                <View style={styles.emptyList}>
                                    <Ionicons name="scan-outline" size={50} color="#666" />
                                    <Text style={styles.emptyText}>Escanea los activos</Text>
                                </View>
                            }
                        />

                        <TouchableOpacity onPress={() => setScanning(true)} style={styles.scanButton}>
                            <Ionicons name="scan" size={24} color="white" />
                            <Text style={styles.scanButtonText}>Escanear Activo</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Modal cambiar ubicación */}
                <Modal visible={showLocationChange} animationType="slide" transparent>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Cambiar Ubicación</Text>
                                <TouchableOpacity onPress={() => setShowLocationChange(false)}>
                                    <Ionicons name="close-circle" size={28} color="#999" />
                                </TouchableOpacity>
                            </View>
                            <ScrollView style={{ padding: 20 }}>
                                <LocationSelector
                                    value={ubicacionId}
                                    onSelect={handleLocationSelect}
                                    placeholder="Seleccionar ubicación..."
                                />
                                <TouchableOpacity
                                    onPress={() => setShowLocationChange(false)}
                                    style={styles.confirmButton}
                                >
                                    <Text style={styles.confirmButtonText}>Confirmar</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </View>
                </Modal>
            </SafeAreaView>
        );
    }

    // VISTA PRINCIPAL
    return (
        <SafeAreaView style={styles.container}>
            <ScrollView style={styles.mainScroll}>
                <Text style={styles.mainTitle}>📍 Ubicar</Text>
                <Text style={styles.mainSubtitle}>Asignar ubicación a múltiples activos</Text>

                <TouchableOpacity onPress={() => setShowConfig(true)} style={styles.mainButton}>
                    <Ionicons name="location" size={50} color="white" />
                    <Text style={styles.mainButtonTitle}>Nueva Asignación</Text>
                    <Text style={styles.mainButtonSubtitle}>
                        Define la ubicación y escanea{'\n'}los activos a asignar
                    </Text>
                </TouchableOpacity>

                <View style={styles.instructionsCard}>
                    <Text style={styles.instructionsTitle}>📖 ¿Cómo funciona?</Text>
                    <View style={styles.step}>
                        <View style={[styles.stepNumber, { backgroundColor: '#E3F2FD' }]}>
                            <Text style={[styles.stepNumberText, { color: '#007AFF' }]}>1</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.stepTitle}>Selecciona la ubicación</Text>
                            <Text style={styles.stepDescription}>Navega por el árbol jerárquico</Text>
                        </View>
                    </View>
                    <View style={styles.step}>
                        <View style={[styles.stepNumber, { backgroundColor: '#E8F5E9' }]}>
                            <Text style={[styles.stepNumberText, { color: '#34C759' }]}>2</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.stepTitle}>Escanea los activos</Text>
                            <Text style={styles.stepDescription}>Escanea todos los activos del área</Text>
                        </View>
                    </View>
                    <View style={styles.step}>
                        <View style={[styles.stepNumber, { backgroundColor: '#FFF3E0' }]}>
                            <Text style={[styles.stepNumberText, { color: '#FF9500' }]}>3</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.stepTitle}>Guarda los cambios</Text>
                            <Text style={styles.stepDescription}>Actualiza todos en la BD</Text>
                        </View>
                    </View>
                </View>
            </ScrollView>

            {/* Modal Configurar Ubicación con TreeView */}
            <Modal visible={showConfig} animationType="slide">
                <SafeAreaView style={styles.container}>
                    <View style={styles.configHeader}>
                        <Text style={styles.configTitle}>📍 Seleccionar Ubicación</Text>
                        <TouchableOpacity onPress={() => setShowConfig(false)}>
                            <Ionicons name="close-circle" size={30} color="#999" />
                        </TouchableOpacity>
                    </View>

                    <View style={{ flex: 1 }}>
                        <LocationTreeView
                            selectedId={ubicacionId}
                            onSelect={handleLocationSelect}
                        />
                    </View>

                    <View style={styles.configFooter}>
                        <TouchableOpacity
                            onPress={() => { setShowConfig(false); router.push('/ubicaciones'); }}
                            style={styles.manageButton}
                        >
                            <Ionicons name="settings-outline" size={20} color="#007AFF" />
                            <Text style={styles.manageButtonText}>Gestionar Ubicaciones</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={iniciarAsignacion}
                            style={[styles.startButton, !ubicacionId && styles.startButtonDisabled]}
                            disabled={!ubicacionId}
                        >
                            <Ionicons name="scan" size={24} color="white" />
                            <Text style={styles.startButtonText}>Comenzar a Escanear</Text>
                        </TouchableOpacity>
                    </View>
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f4f4f4'
    },
    permissionContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20
    },
    permissionText: {
        fontSize: 18,
        marginTop: 20,
        textAlign: 'center'
    },
    permissionButton: {
        marginTop: 20,
        backgroundColor: '#007AFF',
        padding: 15,
        borderRadius: 10
    },
    permissionButtonText: {
        color: 'white',
        fontWeight: 'bold'
    },
    assignmentContainer: {
        flex: 1,
        backgroundColor: '#1a1a2e'
    },
    scannerOverlay: {
        position: 'absolute',
        top: 50,
        left: 20,
        right: 20
    },
    scannerInfo: {
        backgroundColor: 'rgba(0,0,0,0.85)',
        padding: 15,
        borderRadius: 15
    },
    scannerTitle: {
        color: 'white',
        fontSize: 13,
        textAlign: 'center',
        fontWeight: 'bold',
        marginBottom: 10
    },
    pathContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 4
    },
    pathChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12
    },
    pathText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '600'
    },
    hierarchicalPath: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 12,
        gap: 4
    },
    pathLevel: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        gap: 6
    },
    pathLevelIcon: {
        fontSize: 14
    },
    pathLevelText: {
        color: 'white',
        fontSize: 13,
        fontWeight: '600'
    },
    counterBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 8
    },
    counter: {
        color: '#4CAF50',
        fontSize: 16,
        fontWeight: 'bold',
        textAlign: 'center',
        marginTop: 10
    },
    viewListButton: {
        position: 'absolute',
        bottom: 50,
        alignSelf: 'center',
        backgroundColor: 'white',
        paddingHorizontal: 40,
        paddingVertical: 15,
        borderRadius: 25
    },
    viewListButtonText: {
        fontWeight: 'bold',
        fontSize: 16
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#16213e'
    },
    headerTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold'
    },
    locationInfo: {
        padding: 20,
        backgroundColor: '#16213e',
        alignItems: 'center'
    },
    locationLabel: {
        color: '#aaa',
        fontSize: 11,
        marginBottom: 10
    },
    counterBig: {
        color: '#4CAF50',
        fontSize: 42,
        fontWeight: 'bold',
        marginTop: 15
    },
    counterLabel: {
        color: '#888',
        fontSize: 12
    },
    list: {
        flex: 1,
        padding: 15
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 10,
        marginBottom: 8,
        borderLeftWidth: 4,
        borderLeftColor: '#4CAF50'
    },
    itemCode: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 15
    },
    itemName: {
        color: '#aaa',
        fontSize: 13,
        marginTop: 2
    },
    locationPath: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 6,
        gap: 2
    },
    locationPathText: {
        fontSize: 11,
        color: '#888',
        fontWeight: '500'
    },
    emptyList: {
        alignItems: 'center',
        marginTop: 50
    },
    emptyText: {
        color: '#888',
        marginTop: 10
    },
    scanButton: {
        backgroundColor: '#007AFF',
        padding: 18,
        borderRadius: 12,
        margin: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10
    },
    scanButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end'
    },
    modalContent: {
        backgroundColor: '#f4f4f4',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%'
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold'
    },
    confirmButton: {
        backgroundColor: '#34C759',
        padding: 16,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 20
    },
    confirmButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16
    },
    mainScroll: {
        flex: 1,
        padding: 20
    },
    mainTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 5
    },
    mainSubtitle: {
        color: '#888',
        textAlign: 'center',
        marginBottom: 25,
        fontSize: 14
    },
    mainButton: {
        backgroundColor: '#5856D6',
        padding: 30,
        borderRadius: 20,
        alignItems: 'center',
        marginBottom: 20
    },
    mainButtonTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 20,
        marginTop: 15
    },
    mainButtonSubtitle: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        textAlign: 'center',
        marginTop: 8
    },
    instructionsCard: {
        backgroundColor: 'white',
        borderRadius: 15,
        padding: 20
    },
    instructionsTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 20
    },
    step: {
        flexDirection: 'row',
        marginBottom: 16
    },
    stepNumber: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12
    },
    stepNumberText: {
        fontWeight: 'bold',
        fontSize: 14
    },
    stepTitle: {
        fontWeight: '600',
        fontSize: 15,
        marginBottom: 2
    },
    stepDescription: {
        color: '#888',
        fontSize: 13
    },
    configHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        backgroundColor: 'white'
    },
    configTitle: {
        fontSize: 22,
        fontWeight: 'bold'
    },
    configFooter: {
        padding: 20,
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
        backgroundColor: 'white'
    },
    manageButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        marginBottom: 10,
        gap: 8
    },
    manageButtonText: {
        color: '#007AFF',
        fontWeight: '600',
        fontSize: 14
    },
    startButton: {
        backgroundColor: '#34C759',
        padding: 18,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10
    },
    startButtonDisabled: {
        backgroundColor: '#ccc'
    },
    startButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16
    }
});
