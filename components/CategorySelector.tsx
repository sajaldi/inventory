import { Categoria } from '@/app/types';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface CategorySelectorProps {
    value?: number | null;
    onSelect: (category: Categoria, fullPath: Categoria[]) => void;
    placeholder?: string;
}

export default function CategorySelector({ value, onSelect, placeholder = "Seleccionar Categoría" }: CategorySelectorProps) {
    const db = useSQLiteContext();
    const [modalVisible, setModalVisible] = useState(false);
    const [currentParent, setCurrentParent] = useState<number | null>(null);
    const [items, setItems] = useState<Categoria[]>([]);
    const [breadcrumbs, setBreadcrumbs] = useState<Categoria[]>([]);

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
            const path: Categoria[] = [];
            let currentId: number | null = id;

            while (currentId) {
                const item = await db.getFirstAsync<Categoria>('SELECT * FROM categorias WHERE id = ?', [currentId]);
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
                ? 'SELECT * FROM categorias WHERE parent_id = ? ORDER BY nombre'
                : 'SELECT * FROM categorias WHERE parent_id IS NULL ORDER BY nombre';

            const results = await db.getAllAsync<Categoria>(query, parentId ? [parentId] : []);

            // Check children count
            const resultsWithCount = await Promise.all(results.map(async (c) => {
                const countRes = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM categorias WHERE parent_id = ?', [c.id]);
                return { ...c, children_count: countRes?.c || 0 };
            }));

            setItems(resultsWithCount);
        } catch (e) {
            console.log(e);
        }
    };

    const enterLevel = (item: Categoria) => {
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

    const createPathString = (path: Categoria[]) => path.map(p => p.nombre).join(' > ');

    const confirmSelection = (item: Categoria) => {
        const fullPath = [...breadcrumbs, item];
        setDisplayText(createPathString(fullPath));
        onSelect(item, fullPath);
        setModalVisible(false);
        // Reset state
        setBreadcrumbs([]);
        setCurrentParent(null);
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
                                {breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].nombre : 'Seleccionar Categoría'}
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
                                        <View style={[styles.iconBox, { backgroundColor: item.color || '#f0f0f0' }]}>
                                            <Ionicons name={item.icono as any || 'pricetag'} size={20} color="white" />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.itemName}>{item.nombre}</Text>
                                            {item.descripcion && (
                                                <Text style={styles.itemSub}>{item.descripcion}</Text>
                                            )}
                                        </View>
                                        {item.children_count && item.children_count > 0 ? (
                                            <Ionicons name="chevron-forward" size={20} color="#ccc" />
                                        ) : null}
                                    </TouchableOpacity>

                                    {/* Botón explícito de Selección si tiene hijos */}
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
                                    <Text style={{ color: '#888' }}>No hay categorías</Text>
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
        backgroundColor: '#FF9500',
        height: '100%',
        paddingHorizontal: 15,
        justifyContent: 'center',
        alignItems: 'center'
    }
});
