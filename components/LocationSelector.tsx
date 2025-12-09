import { Ubicacion } from '@/app/types';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface LocationSelectorProps {
    value?: number | null;
    onSelect: (location: Ubicacion, fullPath: Ubicacion[]) => void;
    placeholder?: string;
}

export default function LocationSelector({ value, onSelect, placeholder = "Seleccionar Ubicación" }: LocationSelectorProps) {
    const db = useSQLiteContext();
    const [modalVisible, setModalVisible] = useState(false);
    const [currentParent, setCurrentParent] = useState<number | null>(null);
    const [items, setItems] = useState<Ubicacion[]>([]);
    const [breadcrumbs, setBreadcrumbs] = useState<Ubicacion[]>([]);

    // Texto para mostrar (path)
    const [displayText, setDisplayText] = useState('');

    useEffect(() => {
        if (value) {
            loadPath(value);
        } else {
            setDisplayText('');
        }
    }, [value]);

    useEffect(() => {
        if (modalVisible) {
            loadItems(currentParent);
        }
    }, [modalVisible, currentParent]);

    const loadPath = async (id: number) => {
        try {
            const path: Ubicacion[] = [];
            let currentId: number | null = id;

            while (currentId) {
                const item = await db.getFirstAsync<Ubicacion>('SELECT * FROM ubicaciones WHERE id = ?', [currentId]);
                if (item) {
                    path.unshift(item);
                    currentId = item.parent_id;
                } else {
                    break;
                }
            }

            if (path.length > 0) {
                setDisplayText(path.map(p => p.nombre).join(' > '));
            }
        } catch (e) {
            console.log(e);
        }
    };

    const loadItems = async (parentId: number | null) => {
        try {
            const query = parentId
                ? 'SELECT * FROM ubicaciones WHERE parent_id = ? ORDER BY nombre'
                : 'SELECT * FROM ubicaciones WHERE parent_id IS NULL ORDER BY nombre';

            const results = await db.getAllAsync<Ubicacion>(query, parentId ? [parentId] : []);

            // Check children count
            const resultsWithCount = await Promise.all(results.map(async (u) => {
                const countRes = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM ubicaciones WHERE parent_id = ?', [u.id]);
                return { ...u, children_count: countRes?.c || 0 };
            }));

            setItems(resultsWithCount);
        } catch (e) {
            console.log(e);
        }
    };

    const handleSelect = async (item: Ubicacion) => {
        // Obtenemos el path completo de la selección actual
        const path = [...breadcrumbs, item];

        // Si es una hoja (o el usuario decide seleccionar aquí), retornamos
        // Por ahora, permitimos seleccionar cualquier nivel
        // Pero navegamos si tiene hijos.
        // Mejor estrategia: Botón "Seleccionar este nivel" arriba, o tap en el item navega.
        // Vamos a hacer: Tap navega, Long Press o botón derecho selecciona.
        // O mejor: Tap navega si tiene hijos, selecciona si no. 
        // Para consistencia: Tap selecciona Y navega si tiene hijos? No.

        // UX: Tap en item -> Entra al nivel.
        // Botón "Seleccionar '{item.nombre}'" aparece junto al item?

        // Simplificación: Tap entra. Si es lo que quieres, le das al check de arriba?
        // No, el selector debe devolver un ID específico.

        // Vamos a poner un botón "Seleccionar" al lado de cada item. 
        // Y si tocas el cuerpo del item, navega (si tiene hijos).
    };

    const enterLevel = (item: Ubicacion) => {
        setBreadcrumbs([...breadcrumbs, item]);
        setCurrentParent(item.id);
    };

    const goBack = () => {
        if (breadcrumbs.length === 0) {
            setModalVisible(false);
            return;
        }
        const newBreadcrumbs = [...breadcrumbs];
        newBreadcrumbs.pop();
        setBreadcrumbs(newBreadcrumbs);
        setCurrentParent(newBreadcrumbs.length > 0 ? newBreadcrumbs[newBreadcrumbs.length - 1].id : null);
    };

    const createPathString = (path: Ubicacion[]) => path.map(p => p.nombre).join(' > ');

    const confirmSelection = (item: Ubicacion) => {
        const fullPath = [...breadcrumbs, item];
        setDisplayText(createPathString(fullPath));
        onSelect(item, fullPath);
        setModalVisible(false);
        // Reset state
        setBreadcrumbs([]);
        setCurrentParent(null);
    };

    const getIcon = (t: string) => {
        switch (t) {
            case 'edificio': return 'business';
            case 'nivel': return 'layers';
            case 'area': return 'easel';
            default: return 'location';
        }
    };

    return (
        <View>
            <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.input}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: displayText ? '#000' : '#888', flex: 1 }}>
                        {displayText || placeholder}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color="#666" />
                </View>
            </TouchableOpacity>

            <Modal visible={modalVisible} animationType="slide" transparent>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        {/* Header */}
                        <View style={styles.header}>
                            <TouchableOpacity onPress={goBack}>
                                <Ionicons name={breadcrumbs.length > 0 ? "arrow-back" : "close"} size={24} color="#333" />
                            </TouchableOpacity>
                            <Text style={styles.headerTitle} numberOfLines={1}>
                                {breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].nombre : 'Seleccionar Ubicación'}
                            </Text>
                            <View style={{ width: 24 }} />
                        </View>

                        {/* Breadcrumbs (small text) */}
                        {breadcrumbs.length > 0 && (
                            <View style={{ paddingHorizontal: 15, paddingBottom: 10 }}>
                                <Text style={{ fontSize: 12, color: '#666' }}>
                                    {breadcrumbs.map(b => b.nombre).join(' > ')}
                                </Text>
                            </View>
                        )}

                        <FlatList
                            data={items}
                            keyExtractor={item => item.id.toString()}
                            contentContainerStyle={{ padding: 10 }}
                            renderItem={({ item }) => (
                                <View style={styles.itemContainer}>
                                    <TouchableOpacity
                                        style={styles.itemMain}
                                        onPress={() => item.children_count && item.children_count > 0 ? enterLevel(item) : confirmSelection(item)}
                                    >
                                        <View style={[styles.iconBox, { backgroundColor: item.children_count ? '#E3F2FD' : '#f0f0f0' }]}>
                                            <Ionicons name={getIcon(item.tipo) as any} size={20} color="#555" />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.itemName}>{item.nombre}</Text>
                                            <Text style={styles.itemSub}>{item.tipo.toUpperCase()}</Text>
                                        </View>
                                        {item.children_count && item.children_count > 0 ? (
                                            <Ionicons name="chevron-forward" size={20} color="#ccc" />
                                        ) : null}
                                    </TouchableOpacity>

                                    {/* Botón explícito de Selección si tiene hijos (para poder seleccionar un edificio entero por ejemplo) */}
                                    <TouchableOpacity
                                        style={styles.selectBtn}
                                        onPress={() => confirmSelection(item)}
                                    >
                                        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>Elegir</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                            ListEmptyComponent={
                                <View style={{ alignItems: 'center', padding: 30 }}>
                                    <Text style={{ color: '#888' }}>No hay elementos</Text>
                                </View>
                            }
                        />
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    input: {
        backgroundColor: 'white',
        padding: 15,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#ddd',
        marginBottom: 10
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
        height: '80%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#ddd',
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        flex: 1,
        textAlign: 'center',
        marginHorizontal: 10
    },
    itemContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 8,
        overflow: 'hidden'
    },
    itemMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 10
    },
    iconBox: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center'
    },
    itemName: {
        fontSize: 16,
        fontWeight: '600'
    },
    itemSub: {
        fontSize: 11,
        color: '#888'
    },
    selectBtn: {
        backgroundColor: '#007AFF',
        height: '100%',
        paddingHorizontal: 15,
        justifyContent: 'center',
        alignItems: 'center'
    }
});
