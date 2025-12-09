import { generateUUID, getCurrentTimestamp } from '@/utils/sync';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, SafeAreaView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ubicacion } from '../types';

export default function UbicacionesScreen() {
    const db = useSQLiteContext();
    const router = useRouter();
    const params = useLocalSearchParams();

    // Parent ID puede venir de params (navegación)
    const rawParentId = params.parentId;
    const parentId = rawParentId
        ? parseInt(Array.isArray(rawParentId) ? rawParentId[0] : rawParentId)
        : null;
    const [parentLocation, setParentLocation] = useState<Ubicacion | null>(null);

    const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal Crear/Editar
    const [modalVisible, setModalVisible] = useState(false);
    const [editingNode, setEditingNode] = useState<Ubicacion | null>(null);
    const [nombre, setNombre] = useState('');
    const [tipo, setTipo] = useState<'edificio' | 'nivel' | 'area'>('edificio');

    useEffect(() => {
        loadData();
    }, [parentId]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Cargar info del padre si existe
            if (parentId) {
                const parent = await db.getFirstAsync<Ubicacion>('SELECT * FROM ubicaciones WHERE id = ?', [parentId]);
                setParentLocation(parent);
                // Determinar tipo por defecto para nuevos hijos
                if (parent?.tipo === 'edificio') setTipo('nivel');
                else if (parent?.tipo === 'nivel') setTipo('area');
                else setTipo('area');
            } else {
                setParentLocation(null);
                setTipo('edificio');
            }

            // Cargar hijos
            const query = parentId
                ? 'SELECT * FROM ubicaciones WHERE parent_id = ? ORDER BY nombre'
                : 'SELECT * FROM ubicaciones WHERE parent_id IS NULL ORDER BY nombre';

            const results = await db.getAllAsync<Ubicacion>(query, parentId ? [parentId] : []);

            // Para cada ubicación, contar hijos (opcional, para UI)
            const resultsWithCount = await Promise.all(results.map(async (u) => {
                const countRes = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM ubicaciones WHERE parent_id = ?', [u.id]);
                return { ...u, children_count: countRes?.c || 0 };
            }));

            setUbicaciones(resultsWithCount);
        } catch (e) {
            console.error(e);
            Alert.alert('Error', 'No se pudieron cargar las ubicaciones');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!nombre.trim()) {
            Alert.alert('Error', 'El nombre es obligatorio');
            return;
        }

        try {
            const timestamp = getCurrentTimestamp();
            if (editingNode) {
                await db.runAsync(
                    'UPDATE ubicaciones SET nombre = ?, updated_at = ? WHERE id = ?',
                    [nombre.trim(), timestamp, editingNode.id]
                );
            } else {
                const syncId = generateUUID();
                await db.runAsync(
                    'INSERT INTO ubicaciones (sync_id, nombre, tipo, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                    [syncId, nombre.trim(), tipo, parentId, timestamp, timestamp]
                );
            }
            setModalVisible(false);
            setNombre('');
            setEditingNode(null);
            loadData();
        } catch (e) {
            console.error(e);
            Alert.alert('Error', 'No se pudo guardar');
        }
    };

    const handleDelete = (item: Ubicacion) => {
        Alert.alert(
            'Eliminar Ubicación',
            `¿Estás seguro de eliminar "${item.nombre}"? Se eliminarán también todas las sub-ubicaciones.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            // La restricción ON DELETE CASCADE se encargará de los hijos si está activada
                            // Pero SQLite en Expo a veces requiere habilitarla manualmente con PRAGMA foreign_keys = ON;
                            // Asumimos que está habilitada o lo hacemos manual recursivo (pero CASCADE es mejor)
                            await db.execAsync('PRAGMA foreign_keys = ON;');
                            await db.runAsync('DELETE FROM ubicaciones WHERE id = ?', [item.id]);
                            loadData();
                        } catch (e) {
                            Alert.alert('Error', 'No se pudo eliminar');
                        }
                    }
                }
            ]
        );
    };

    const openEdit = (item: Ubicacion) => {
        setEditingNode(item);
        setNombre(item.nombre);
        setTipo(item.tipo); // El tipo no se suele cambiar, pero lo seteamos
        setModalVisible(true);
    };

    const openCreate = () => {
        setEditingNode(null);
        setNombre('');
        // Tipo ya se seteó en loadData según el padre
        setModalVisible(true);
    };

    const navigateToChildren = (item: Ubicacion) => {
        router.push({ pathname: '/ubicaciones', params: { parentId: item.id } });
    };

    const getIcon = (t: string) => {
        switch (t) {
            case 'edificio': return 'business';
            case 'nivel': return 'layers';
            case 'area': return 'easel';
            default: return 'location';
        }
    };

    const getColor = (t: string) => {
        switch (t) {
            case 'edificio': return '#FF9500';
            case 'nivel': return '#34C759';
            case 'area': return '#5856D6';
            default: return '#888';
        }
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
            <Stack.Screen options={{
                headerTitle: parentLocation ? parentLocation.nombre : 'Ubicaciones',
                headerBackTitle: 'Atrás'
            }} />

            <View style={{ padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16, color: '#666' }}>
                    {parentLocation ? `${parentLocation.tipo.toUpperCase()} ACTUAL` : 'RAÍZ (EDIFICIOS)'}
                </Text>
                <TouchableOpacity onPress={openCreate} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#007AFF', padding: 8, borderRadius: 8 }}>
                    <Ionicons name="add" size={20} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', marginLeft: 5 }}>
                        {parentLocation ? 'Agregar Sub-nivel' : 'Nuevo Edificio'}
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={ubicaciones}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={{ padding: 15 }}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        onPress={() => navigateToChildren(item)}
                        style={{ backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15, flex: 1 }}>
                            <View style={{ backgroundColor: getColor(item.tipo) + '20', padding: 10, borderRadius: 10 }}>
                                <Ionicons name={getIcon(item.tipo) as any} size={24} color={getColor(item.tipo)} />
                            </View>
                            <View>
                                <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{item.nombre}</Text>
                                <Text style={{ fontSize: 12, color: '#888' }}>
                                    {item.tipo.toUpperCase()} • {item.children_count} elementos dentro
                                </Text>
                            </View>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity onPress={(e) => { e.stopPropagation(); openEdit(item); }} style={{ padding: 5 }}>
                                <Ionicons name="pencil" size={20} color="#007AFF" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDelete(item); }} style={{ padding: 5 }}>
                                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                            </TouchableOpacity>
                            <Ionicons name="chevron-forward" size={20} color="#ccc" />
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    <View style={{ alignItems: 'center', marginTop: 50 }}>
                        <Ionicons name="file-tray-outline" size={50} color="#ccc" />
                        <Text style={{ color: '#888', marginTop: 10 }}>No hay ubicaciones aquí</Text>
                    </View>
                }
            />

            {/* Modal Crear/Editar */}
            <Modal visible={modalVisible} transparent animationType="slide">
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
                    <View style={{ backgroundColor: 'white', borderRadius: 20, padding: 20 }}>
                        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 15 }}>
                            {editingNode ? 'Editar Ubicación' : 'Nueva Ubicación'}
                        </Text>

                        <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>TIPO</Text>
                        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                            {['edificio', 'nivel', 'area'].map(t => (
                                <TouchableOpacity
                                    key={t}
                                    onPress={() => !editingNode && setTipo(t as any)} // Solo permitir cambio al crear
                                    disabled={!!editingNode}
                                    style={{
                                        paddingHorizontal: 15,
                                        paddingVertical: 8,
                                        borderRadius: 20,
                                        backgroundColor: tipo === t ? getColor(t) : '#f0f0f0',
                                        opacity: editingNode && tipo !== t ? 0.5 : 1
                                    }}
                                >
                                    <Text style={{ color: tipo === t ? 'white' : '#666', fontWeight: 'bold', fontSize: 12 }}>
                                        {t.toUpperCase()}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>NOMBRE</Text>
                        <TextInput
                            style={{ backgroundColor: '#f9f9f9', padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', marginBottom: 20 }}
                            placeholder="Nombre de la ubicación"
                            value={nombre}
                            onChangeText={setNombre}
                            autoFocus
                        />

                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity onPress={() => setModalVisible(false)} style={{ flex: 1, padding: 15, backgroundColor: '#eee', borderRadius: 10, alignItems: 'center' }}>
                                <Text style={{ fontWeight: 'bold', color: '#666' }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleSave} style={{ flex: 1, padding: 15, backgroundColor: '#007AFF', borderRadius: 10, alignItems: 'center' }}>
                                <Text style={{ fontWeight: 'bold', color: 'white' }}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}
