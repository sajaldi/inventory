import { Ubicacion } from '@/app/types';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface TreeNode extends Ubicacion {
    children: TreeNode[];
    isExpanded: boolean;
    level: number;
}

interface LocationTreeViewProps {
    onSelect: (location: Ubicacion, fullPath: Ubicacion[]) => void;
    selectedId?: number | null;
}

export default function LocationTreeView({ onSelect, selectedId }: LocationTreeViewProps) {
    const db = useSQLiteContext();
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPath, setSelectedPath] = useState<number[]>([]);

    useEffect(() => {
        loadTree();
    }, []);

    useEffect(() => {
        if (selectedId) {
            loadSelectedPath(selectedId);
        }
    }, [selectedId]);

    const loadSelectedPath = async (id: number) => {
        try {
            const path: number[] = [];
            let currentId: number | null = id;

            while (currentId) {
                path.unshift(currentId);
                const item = await db.getFirstAsync<Ubicacion>(
                    'SELECT * FROM ubicaciones WHERE id = ?',
                    [currentId]
                );
                currentId = item?.parent_id || null;
            }

            setSelectedPath(path);
            // Auto-expandir el path seleccionado
            expandPath(path);
        } catch (e) {
            console.log('Error loading path:', e);
        }
    };

    const expandPath = (path: number[]) => {
        setTree(prevTree => {
            const newTree = [...prevTree];
            expandNodesInPath(newTree, path, 0);
            return newTree;
        });
    };

    const expandNodesInPath = (nodes: TreeNode[], path: number[], pathIndex: number) => {
        for (let node of nodes) {
            if (path[pathIndex] === node.id) {
                node.isExpanded = true;
                if (pathIndex < path.length - 1) {
                    expandNodesInPath(node.children, path, pathIndex + 1);
                }
            }
        }
    };

    const loadTree = async () => {
        try {
            setLoading(true);
            const allLocations = await db.getAllAsync<Ubicacion>(
                'SELECT * FROM ubicaciones ORDER BY nombre'
            );

            // Construir árbol
            const treeData = buildTree(allLocations, null, 0);
            setTree(treeData);
        } catch (e) {
            console.log('Error loading tree:', e);
        } finally {
            setLoading(false);
        }
    };

    const buildTree = (locations: Ubicacion[], parentId: number | null, level: number): TreeNode[] => {
        return locations
            .filter(loc => loc.parent_id === parentId)
            .map(loc => ({
                ...loc,
                children: buildTree(locations, loc.id, level + 1),
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

    const handleSelect = (node: TreeNode) => {
        // Construir path completo
        const path = buildPathToNode(tree, node.id, []);
        if (path) {
            setSelectedPath(path.map(n => n.id));
            onSelect(node, path);
        }
    };

    const buildPathToNode = (nodes: TreeNode[], targetId: number, currentPath: TreeNode[]): TreeNode[] | null => {
        for (let node of nodes) {
            const newPath = [...currentPath, node];
            if (node.id === targetId) {
                return newPath;
            }
            if (node.children.length > 0) {
                const result = buildPathToNode(node.children, targetId, newPath);
                if (result) return result;
            }
        }
        return null;
    };

    const renderNode = (node: TreeNode) => {
        const hasChildren = node.children.length > 0;
        const isSelected = selectedId === node.id;
        const isInPath = selectedPath.includes(node.id);

        const getIcon = () => {
            if (node.tipo === 'edificio') return 'business';
            if (node.tipo === 'nivel') return 'layers';
            return 'location';
        };

        const getColor = () => {
            if (isSelected) return '#007AFF';
            if (node.tipo === 'edificio') return '#FF9500';
            if (node.tipo === 'nivel') return '#34C759';
            return '#5856D6';
        };

        return (
            <View key={node.id} style={{ marginLeft: node.level * 20 }}>
                <TouchableOpacity
                    style={[
                        styles.nodeContainer,
                        isSelected && styles.nodeSelected,
                        isInPath && !isSelected && styles.nodeInPath
                    ]}
                    onPress={() => handleSelect(node)}
                    onLongPress={() => hasChildren && toggleNode(node.id)}
                >
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

                        {/* Icono de tipo */}
                        <View style={[styles.nodeIcon, { backgroundColor: getColor() }]}>
                            <Ionicons name={getIcon() as any} size={18} color="white" />
                        </View>

                        {/* Información */}
                        <View style={styles.nodeInfo}>
                            <Text style={[styles.nodeName, isSelected && styles.nodeNameSelected]}>
                                {node.nombre}
                            </Text>
                            <Text style={styles.nodeType}>{node.tipo.toUpperCase()}</Text>
                        </View>
                    </View>

                    {/* Badge de hijos */}
                    {hasChildren && (
                        <View style={styles.childrenBadge}>
                            <Text style={styles.childrenBadgeText}>{node.children.length}</Text>
                        </View>
                    )}

                    {/* Checkmark si está seleccionado */}
                    {isSelected && (
                        <Ionicons name="checkmark-circle" size={24} color="#007AFF" />
                    )}
                </TouchableOpacity>

                {/* Renderizar hijos si está expandido */}
                {node.isExpanded && node.children.map(child => renderNode(child))}
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>Cargando ubicaciones...</Text>
            </View>
        );
    }

    if (tree.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Ionicons name="file-tray-outline" size={50} color="#ccc" />
                <Text style={styles.emptyText}>No hay ubicaciones</Text>
                <Text style={styles.emptySubtext}>Crea ubicaciones primero</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
                <Ionicons name="git-network-outline" size={20} color="#666" />
                <Text style={styles.headerText}>Navega por la jerarquía</Text>
            </View>

            <View style={styles.legend}>
                <View style={styles.legendItem}>
                    <View style={[styles.legendIcon, { backgroundColor: '#FF9500' }]}>
                        <Ionicons name="business" size={12} color="white" />
                    </View>
                    <Text style={styles.legendText}>Edificio</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={[styles.legendIcon, { backgroundColor: '#34C759' }]}>
                        <Ionicons name="layers" size={12} color="white" />
                    </View>
                    <Text style={styles.legendText}>Nivel</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={[styles.legendIcon, { backgroundColor: '#5856D6' }]}>
                        <Ionicons name="location" size={12} color="white" />
                    </View>
                    <Text style={styles.legendText}>Área</Text>
                </View>
            </View>

            <View style={styles.treeContainer}>
                {tree.map(node => renderNode(node))}
            </View>

            <View style={styles.hint}>
                <Ionicons name="information-circle-outline" size={16} color="#888" />
                <Text style={styles.hintText}>
                    Toca una ubicación para seleccionarla. Toca la flecha para expandir/colapsar.
                </Text>
            </View>
        </ScrollView>
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
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40
    },
    emptyText: {
        fontSize: 16,
        color: '#999',
        marginTop: 15,
        fontWeight: '600'
    },
    emptySubtext: {
        fontSize: 14,
        color: '#bbb',
        marginTop: 5
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        gap: 8
    },
    headerText: {
        fontSize: 14,
        color: '#666',
        fontWeight: '600'
    },
    legend: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        padding: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0'
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6
    },
    legendIcon: {
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center'
    },
    legendText: {
        fontSize: 11,
        color: '#666',
        fontWeight: '500'
    },
    treeContainer: {
        padding: 10,
        paddingBottom: 20
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
        borderColor: '#e8e8e8',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1
    },
    nodeSelected: {
        backgroundColor: '#E3F2FD',
        borderColor: '#007AFF',
        borderWidth: 2
    },
    nodeInPath: {
        backgroundColor: '#F5F5F5',
        borderColor: '#ccc'
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
    nodeNameSelected: {
        color: '#007AFF'
    },
    nodeType: {
        fontSize: 10,
        color: '#888',
        marginTop: 2,
        fontWeight: '500'
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
    hint: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 15,
        backgroundColor: '#FFF9E6',
        margin: 10,
        borderRadius: 10,
        gap: 8
    },
    hintText: {
        flex: 1,
        fontSize: 12,
        color: '#888',
        lineHeight: 18
    }
});
