import { Categoria } from '@/app/types';
import { generateUUID, getCurrentTimestamp } from '@/utils/sync';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface TreeNode extends Categoria {
    children: TreeNode[];
    isExpanded: boolean;
    level: number;
}

const ICONOS_DISPONIBLES = [
    'cube', 'laptop', 'desktop', 'phone-portrait', 'print', 'car',
    'hammer', 'construct', 'briefcase', 'folder', 'document', 'clipboard',
    'cart', 'home', 'business', 'medical', 'fitness', 'restaurant',
    'pricetag', 'pricetags', 'star', 'heart', 'flash', 'trophy'
];

const COLORES_DISPONIBLES = [
    '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#AF52DE',
    '#FF2D55', '#5AC8FA', '#FFCC00', '#FF6482', '#30B0C7', '#32ADE6'
];

export default function CategoryTreeView() {
    const db = useSQLiteContext();
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal para crear/editar
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [parentId, setParentId] = useState<number | null>(null);
    const [nombre, setNombre] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [iconoSeleccionado, setIconoSeleccionado] = useState('pricetag');
    const [colorSeleccionado, setColorSeleccionado] = useState('#FF9500');

    useEffect(() => {
        loadTree();
    }, []);

    const loadTree = async () => {
        try {
            setLoading(true);
            const allCategories = await db.getAllAsync<Categoria>(
                'SELECT * FROM categorias ORDER BY nombre'
            );

            const treeData = buildTree(allCategories, null, 0);
            setTree(treeData);
        } catch (e) {
            console.log('Error cargando categorías:', e);
        } finally {
            setLoading(false);
        }
    };

    const buildTree = (categories: Categoria[], parentId: number | null, level: number): TreeNode[] => {
        return categories
            .filter(cat => cat.parent_id === parentId)
            .map(cat => ({
                ...cat,
                children: buildTree(categories, cat.id, level + 1),
                isExpanded: false,
                level
            }));
    };

    const toggleNode = (nodeId: number) => {
        setTree(prevTree => {
            const newTree = [...prevTree];
            toggleNodeRecursive(newTree, nodeId);
            return newTree;
        });
    };

    const toggleNodeRecursive = (nodes: TreeNode[], nodeId: number): boolean => {
        for (let node of nodes) {
            if (node.id === nodeId) {
                node.isExpanded = !node.isExpanded;
                return true;
            }
            if (node.children.length > 0) {
                if (toggleNodeRecursive(node.children, nodeId)) {
                    return true;
                }
            }
        }
        return false;
    };

    const openModal = (categoria?: TreeNode, parent?: TreeNode) => {
        if (categoria) {
            setEditingId(categoria.id);
            setNombre(categoria.nombre);
            setDescripcion(categoria.descripcion || '');
            setIconoSeleccionado(categoria.icono || 'pricetag');
            setColorSeleccionado(categoria.color || '#FF9500');
            setParentId(categoria.parent_id);
        } else {
            setEditingId(null);
            setNombre('');
            setDescripcion('');
            setIconoSeleccionado('pricetag');
            setColorSeleccionado('#FF9500');
            setParentId(parent?.id || null);
        }
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingId(null);
        setParentId(null);
        setNombre('');
        setDescripcion('');
    };

    const saveCategoria = async () => {
        if (!nombre.trim()) {
            Alert.alert('Error', 'El nombre es requerido');
            return;
        }

        try {
            const timestamp = getCurrentTimestamp();

            if (editingId) {
                await db.runAsync(
                    'UPDATE categorias SET nombre = ?, descripcion = ?, icono = ?, color = ?, updated_at = ? WHERE id = ?',
                    [nombre.trim(), descripcion.trim(), iconoSeleccionado, colorSeleccionado, timestamp, editingId]
                );
                Alert.alert('✅ Actualizado', 'Categoría actualizada correctamente');
            } else {
                const syncId = generateUUID();
                await db.runAsync(
                    'INSERT INTO categorias (sync_id, nombre, descripcion, icono, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [syncId, nombre.trim(), descripcion.trim(), iconoSeleccionado, colorSeleccionado, parentId, timestamp, timestamp]
                );
                Alert.alert('✅ Guardado', 'Categoría creada correctamente');
            }

            closeModal();
            loadTree();
        } catch (e: any) {
            Alert.alert('Error', 'No se pudo guardar la categoría');
            console.log(e);
        }
    };

    const deleteCategoria = async (id: number, nombre: string) => {
        // Verificar si hay activos usando esta categoría
        const count = await db.getFirstAsync<{ total: number }>(
            'SELECT COUNT(*) as total FROM activos WHERE categoria = ?',
            [nombre]
        );

        if (count && count.total > 0) {
            Alert.alert(
                'No se puede eliminar',
                `Hay ${count.total} activo(s) usando esta categoría.`
            );
            return;
        }

        // Verificar si tiene subcategorías
        const childCount = await db.getFirstAsync<{ total: number }>(
            'SELECT COUNT(*) as total FROM categorias WHERE parent_id = ?',
            [id]
        );

        if (childCount && childCount.total > 0) {
            Alert.alert(
                'No se puede eliminar',
                `Esta categoría tiene ${childCount.total} subcategoría(s).`
            );
            return;
        }

        Alert.alert(
            'Eliminar Categoría',
            `¿Estás seguro de eliminar "${nombre}"?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        await db.runAsync('DELETE FROM categorias WHERE id = ?', [id]);
                        loadTree();
                    }
                }
            ]
        );
    };

    const renderNode = (node: TreeNode) => {
        const hasChildren = node.children.length > 0;

        return (
            <View key={node.id} style={{ marginLeft: node.level * 20 }}>
                <View style={styles.nodeContainer}>
                    <View style={styles.nodeLeft}>
                        {/* Indicador de expansión */}
                        <View style={styles.expandIndicator}>
                            {hasChildren ? (
                                <TouchableOpacity onPress={() => toggleNode(node.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                    <Ionicons
                                        name={node.isExpanded ? 'chevron-down' : 'chevron-forward'}
                                        size={20}
                                        color="#666"
                                    />
                                </TouchableOpacity>
                            ) : (
                                <View style={{ width: 20 }} />
                            )}
                        </View>

                        {/* Icono de categoría */}
                        <View style={[styles.nodeIcon, { backgroundColor: node.color || '#FF9500' }]}>
                            <Ionicons name={node.icono as any || 'pricetag'} size={18} color="white" />
                        </View>

                        {/* Información */}
                        <View style={styles.nodeInfo}>
                            <Text style={styles.nodeName}>{node.nombre}</Text>
                            {node.descripcion && (
                                <Text style={styles.nodeDescription}>{node.descripcion}</Text>
                            )}
                        </View>
                    </View>

                    {/* Badge de hijos */}
                    {hasChildren && (
                        <View style={styles.childrenBadge}>
                            <Text style={styles.childrenBadgeText}>{node.children.length}</Text>
                        </View>
                    )}

                    {/* Acciones */}
                    <View style={styles.actions}>
                        <TouchableOpacity onPress={() => openModal(undefined, node)} style={styles.actionButton}>
                            <Ionicons name="add-circle-outline" size={20} color="#34C759" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => openModal(node)} style={styles.actionButton}>
                            <Ionicons name="create-outline" size={20} color="#007AFF" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deleteCategoria(node.id, node.nombre)} style={styles.actionButton}>
                            <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Renderizar hijos si está expandido */}
                {node.isExpanded && node.children.map(child => renderNode(child))}
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>Cargando categorías...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="git-network-outline" size={20} color="#666" />
                    <Text style={styles.headerText}>Jerarquía de Categorías</Text>
                </View>
                <TouchableOpacity onPress={() => openModal()} style={styles.addButton}>
                    <Ionicons name="add-circle" size={24} color="#34C759" />
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.treeContainer} showsVerticalScrollIndicator={false}>
                {tree.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="pricetags-outline" size={50} color="#ccc" />
                        <Text style={styles.emptyText}>No hay categorías</Text>
                        <TouchableOpacity onPress={() => openModal()} style={styles.createFirstButton}>
                            <Text style={styles.createFirstButtonText}>Crear primera categoría</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    tree.map(node => renderNode(node))
                )}
            </ScrollView>

            {/* Modal Crear/Editar */}
            <Modal visible={showModal} animationType="slide" transparent>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>
                                {editingId ? 'Editar Categoría' : parentId ? 'Nueva Subcategoría' : 'Nueva Categoría'}
                            </Text>
                            <TouchableOpacity onPress={closeModal}>
                                <Ionicons name="close-circle" size={28} color="#999" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.modalBody}>
                            <Text style={styles.label}>NOMBRE *</Text>
                            <TextInput
                                value={nombre}
                                onChangeText={setNombre}
                                placeholder="Ej: Equipos de Cómputo"
                                style={styles.input}
                            />

                            <Text style={styles.label}>DESCRIPCIÓN</Text>
                            <TextInput
                                value={descripcion}
                                onChangeText={setDescripcion}
                                placeholder="Descripción opcional"
                                style={[styles.input, { height: 80 }]}
                                multiline
                                numberOfLines={3}
                            />

                            <Text style={styles.label}>ICONO</Text>
                            <View style={styles.iconGrid}>
                                {ICONOS_DISPONIBLES.map(icono => (
                                    <TouchableOpacity
                                        key={icono}
                                        style={[
                                            styles.iconOption,
                                            iconoSeleccionado === icono && styles.iconOptionSelected
                                        ]}
                                        onPress={() => setIconoSeleccionado(icono)}
                                    >
                                        <Ionicons name={icono as any} size={24} color={iconoSeleccionado === icono ? 'white' : '#666'} />
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Text style={styles.label}>COLOR</Text>
                            <View style={styles.colorGrid}>
                                {COLORES_DISPONIBLES.map(color => (
                                    <TouchableOpacity
                                        key={color}
                                        style={[
                                            styles.colorOption,
                                            { backgroundColor: color },
                                            colorSeleccionado === color && styles.colorOptionSelected
                                        ]}
                                        onPress={() => setColorSeleccionado(color)}
                                    >
                                        {colorSeleccionado === color && (
                                            <Ionicons name="checkmark" size={20} color="white" />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <TouchableOpacity onPress={saveCategoria} style={styles.saveButton}>
                                <Text style={styles.saveButtonText}>
                                    {editingId ? 'Actualizar' : 'Guardar'}
                                </Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9f9f9'
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40
    },
    loadingText: {
        marginTop: 10,
        color: '#666',
        fontSize: 14
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 15,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0'
    },
    headerText: {
        fontSize: 14,
        color: '#666',
        fontWeight: '600'
    },
    addButton: {
        padding: 5
    },
    treeContainer: {
        flex: 1,
        padding: 10
    },
    nodeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'white',
        padding: 12,
        marginVertical: 3,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e8e8e8'
    },
    nodeLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 8
    },
    expandIndicator: {
        width: 24,
        alignItems: 'center'
    },
    nodeIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center'
    },
    nodeInfo: {
        flex: 1
    },
    nodeName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#333'
    },
    nodeDescription: {
        fontSize: 11,
        color: '#888',
        marginTop: 2
    },
    childrenBadge: {
        backgroundColor: '#f0f0f0',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        marginRight: 8
    },
    childrenBadgeText: {
        fontSize: 11,
        color: '#666',
        fontWeight: '600'
    },
    actions: {
        flexDirection: 'row',
        gap: 8
    },
    actionButton: {
        padding: 4
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 80,
        padding: 20
    },
    emptyText: {
        fontSize: 16,
        color: '#999',
        marginTop: 15,
        fontWeight: '600'
    },
    createFirstButton: {
        marginTop: 20,
        backgroundColor: '#34C759',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10
    },
    createFirstButtonText: {
        color: 'white',
        fontWeight: 'bold'
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end'
    },
    modalContent: {
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '85%'
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0'
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold'
    },
    modalBody: {
        padding: 20
    },
    label: {
        fontSize: 12,
        color: '#888',
        marginBottom: 8,
        marginTop: 15,
        fontWeight: '600'
    },
    input: {
        backgroundColor: '#f9f9f9',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
        fontSize: 15
    },
    iconGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 5
    },
    iconOption: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#f0f0f0',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: 'transparent'
    },
    iconOptionSelected: {
        backgroundColor: '#FF9500',
        borderColor: '#CC7700'
    },
    colorGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 5
    },
    colorOption: {
        width: 50,
        height: 50,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        borderColor: 'transparent'
    },
    colorOptionSelected: {
        borderColor: '#333'
    },
    saveButton: {
        backgroundColor: '#34C759',
        padding: 16,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 30,
        marginBottom: 20
    },
    saveButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold'
    }
});
