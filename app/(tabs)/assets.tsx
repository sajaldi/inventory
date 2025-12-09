import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Ubicacion } from '@/app/types';
import CategorySelector from '@/components/CategorySelector';
import LocationSelector from '@/components/LocationSelector';
import { downloadExcelTemplate, exportToExcel, importFromExcel } from '@/utils/excel';
import { checkServerConnection, generateUUID, getCurrentTimestamp, syncWithServer } from '@/utils/sync';

const PAGE_SIZE = 30;

interface Asset {
  id: number;
  codigo: string;
  nombre: string;
  edificio: string;
  nivel: string;
  categoria: string;
  espacio: string;
  serie?: string;
  ubicacion_id?: number | null;
}

interface FilterOptions {
  edificios: string[];
  niveles: string[];
  categorias: string[];
  espacios: string[];
}

export default function AssetsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ edificios: [], niveles: [], categorias: [], espacios: [] });

  const [searchText, setSearchText] = useState('');
  const [filterBuilding, setFilterBuilding] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [modal, setModal] = useState(false);
  const [cam, setCam] = useState(false);
  const [searchScanner, setSearchScanner] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [serie, setSerie] = useState('');
  const [build, setBuild] = useState('');
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [space, setSpace] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<Ubicacion | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const loadFilterOptions = async () => {
    try {
      const edificios = await db.getAllAsync<{ edificio: string }>('SELECT DISTINCT edificio FROM activos WHERE edificio IS NOT NULL AND edificio != "" ORDER BY edificio');
      const niveles = await db.getAllAsync<{ nivel: string }>('SELECT DISTINCT nivel FROM activos WHERE nivel IS NOT NULL AND nivel != "" ORDER BY nivel');
      const categorias = await db.getAllAsync<{ categoria: string }>('SELECT DISTINCT categoria FROM activos WHERE categoria IS NOT NULL AND categoria != "" ORDER BY categoria');
      const espacios = await db.getAllAsync<{ espacio: string }>('SELECT DISTINCT espacio FROM activos WHERE espacio IS NOT NULL AND espacio != "" ORDER BY espacio');

      setFilterOptions({
        edificios: edificios.map(e => e.edificio),
        niveles: niveles.map(n => n.nivel),
        categorias: categorias.map(c => c.categoria),
        espacios: espacios.map(s => s.espacio)
      });
    } catch (e) {
      console.log('Error cargando opciones:', e);
    }
  };

  const loadAssets = async (resetPage: boolean = false) => {
    try {
      if (resetPage) {
        setLoading(true);
        setPage(0);
      } else {
        setLoadingMore(true);
      }

      const currentPage = resetPage ? 0 : page;

      let conditions: string[] = [];
      let countParams: any[] = [];

      if (searchText.trim()) {
        conditions.push('(codigo LIKE ? OR nombre LIKE ? OR serie LIKE ?)');
        countParams.push(`%${searchText.trim()}%`, `%${searchText.trim()}%`, `%${searchText.trim()}%`);
      }
      if (filterBuilding) {
        conditions.push('edificio = ?');
        countParams.push(filterBuilding);
      }
      if (filterLevel) {
        conditions.push('nivel = ?');
        countParams.push(filterLevel);
      }
      if (filterCategory) {
        conditions.push('categoria = ?');
        countParams.push(filterCategory);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await db.getFirstAsync<{ total: number }>(`SELECT COUNT(*) as total FROM activos ${whereClause}`, countParams);
      setTotalCount(countResult?.total || 0);

      const query = `SELECT * FROM activos ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`;
      const params = [...countParams, PAGE_SIZE, currentPage * PAGE_SIZE];
      const rows = await db.getAllAsync<Asset>(query, params);

      if (resetPage) {
        setAssets(rows);
      } else {
        setAssets(prev => [...prev, ...rows]);
      }
    } catch (e) {
      console.log('Error cargando activos:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = useCallback(() => {
    if (!loadingMore && assets.length < totalCount) {
      setPage(prev => prev + 1);
    }
  }, [loadingMore, assets.length, totalCount]);

  useEffect(() => {
    loadFilterOptions();
    loadAssets(true);
  }, []);

  useEffect(() => {
    if (page > 0) {
      loadAssets(false);
    }
  }, [page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAssets(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, filterBuilding, filterLevel, filterCategory]);

  const clearFilters = () => {
    setSearchText('');
    setFilterBuilding('');
    setFilterLevel('');
    setFilterCategory('');
  };

  const activeFiltersCount = [searchText, filterBuilding, filterLevel, filterCategory].filter(Boolean).length;
  const hasMore = assets.length < totalCount;

  const add = async () => {
    if (!code.trim() || !name.trim()) {
      Alert.alert('Error', 'Código y Nombre son requeridos');
      return;
    }
    try {
      const syncId = generateUUID();
      const updatedAt = getCurrentTimestamp();
      await db.runAsync(
        'INSERT INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, ubicacion_id, updated_at, serie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [syncId, code.trim(), name.trim(), build.trim(), level.trim(), category.trim(), space.trim(), selectedLocationId, updatedAt, serie.trim()]
      );
      Alert.alert("✅ Guardado", "Activo registrado correctamente");
      setModal(false);
      setCode(''); setName(''); setSerie(''); setBuild(''); setLevel(''); setCategory(''); setSpace('');
      setSelectedLocation(null); setSelectedLocationId(null); setSelectedCategoryId(null);
      loadFilterOptions();
      loadAssets(true);
    } catch (e) {
      Alert.alert("Error", "Código duplicado o error al guardar");
    }
  };

  const updateAsset = async () => {
    if (!selectedAsset || !code.trim() || !name.trim()) {
      Alert.alert('Error', 'Código y Nombre son requeridos');
      return;
    }
    try {
      const updatedAt = getCurrentTimestamp();
      await db.runAsync(
        'UPDATE activos SET codigo = ?, nombre = ?, edificio = ?, nivel = ?, categoria = ?, espacio = ?, ubicacion_id = ?, updated_at = ?, serie = ? WHERE id = ?',
        [code.trim(), name.trim(), build.trim(), level.trim(), category.trim(), space.trim(), selectedLocationId, updatedAt, serie.trim(), selectedAsset.id]
      );
      Alert.alert('✅ Actualizado', 'El activo fue modificado correctamente.');
      closeDetail();
      loadFilterOptions();
      loadAssets(true);
    } catch (e: any) {
      console.log("Error updating asset:", e);
      if (e.message && e.message.includes('UNIQUE constraint failed: activos.codigo')) { // Simplify check for sqlite unique error
        Alert.alert('Error', `El código "${code.trim()}" ya está registrado en otro activo. Por favor usa un código único.`);
      } else {
        Alert.alert('Error', `No se pudo actualizar el activo: ${e.message}`);
      }
    }
  };

  const del = async (id: number) => {
    Alert.alert('Eliminar', '¿Estás seguro de eliminar este activo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await db.runAsync('DELETE FROM activos WHERE id = ?', [id]);
          closeDetail();
          loadFilterOptions();
          loadAssets(true);
        }
      }
    ]);
  };

  const openDetail = async (item: Asset) => {
    setSelectedAsset(item);
    setCode(item.codigo);
    setName(item.nombre);
    setSerie(item.serie || '');
    setBuild(item.edificio || '');
    setLevel(item.nivel || '');
    setCategory(item.categoria || '');
    setSpace(item.espacio || '');
    setSelectedLocationId(item.ubicacion_id || null);

    // Buscar ID de categoría si existe
    if (item.categoria) {
      try {
        const cat = await db.getFirstAsync<{ id: number }>('SELECT id FROM categorias WHERE nombre = ?', [item.categoria]);
        setSelectedCategoryId(cat?.id || null);
      } catch (e) {
        setSelectedCategoryId(null);
      }
    } else {
      setSelectedCategoryId(null);
    }

    setIsEditing(false);
    setDetailModal(true);
  };

  const closeDetail = () => {
    setDetailModal(false);
    setSelectedAsset(null);
    setIsEditing(false);
    setCode(''); setName(''); setSerie(''); setBuild(''); setLevel(''); setCategory(''); setSpace('');
    setSelectedLocation(null); setSelectedLocationId(null); setSelectedCategoryId(null);
  };

  const handleSearchScan = async ({ data }: any) => {
    try {
      // Extraer código del escaneo
      const parts = data.split(' ');
      const match = parts[0].match(/^[\d-]+/);
      const scannedCode = match ? match[0] : parts[0];

      // Buscar el activo
      const asset = await db.getFirstAsync<Asset>(
        'SELECT * FROM activos WHERE codigo = ?',
        [scannedCode]
      );

      setSearchScanner(false);

      if (asset) {
        // Abrir el detalle del activo encontrado
        openDetail(asset);
      } else {
        Alert.alert('❌ No encontrado', `El código "${scannedCode}" no existe en la base de datos.`);
      }
    } catch (e) {
      console.log('Error en búsqueda por scanner:', e);
      setSearchScanner(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const isConnected = await checkServerConnection();
      if (!isConnected) {
        Alert.alert('Sin conexión', 'No se puede conectar al servidor de sincronización.');
        return;
      }

      const result = await syncWithServer(db);

      if (result.success) {
        Alert.alert(
          '✅ Sincronizado',
          `Subidos: ${result.uploaded.activos} activos\nDescargados: ${result.downloaded.activos} activos`
        );
        loadFilterOptions();
        loadAssets(true);
      } else {
        Alert.alert('Error', result.errors.join('\n') || 'Error desconocido');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Error de sincronización');
    } finally {
      setSyncing(false);
    }
  };

  const importCsv = async () => {
    try {
      const doc = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (doc.canceled) return;

      const txt = await readAsStringAsync(doc.assets[0].uri);
      const rows = txt.split('\n');

      let count = 0;
      for (let r of rows) {
        const c = r.split(',');
        if (c.length >= 2 && !r.toLowerCase().includes('codigo')) {
          try {
            const syncId = generateUUID();
            const updatedAt = getCurrentTimestamp();
            await db.runAsync(
              'INSERT OR IGNORE INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, serie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [syncId, c[0]?.trim(), c[1]?.trim(), c[2]?.trim() || '', c[3]?.trim() || '', c[4]?.trim() || '', c[5]?.trim() || '', updatedAt, c[6]?.trim() || '']
            );
            count++;
          } catch (e) { }
        }
      }
      Alert.alert("✅ Importado", `${count} registros procesados.`);
      loadFilterOptions();
      loadAssets(true);
    } catch (e) {
      Alert.alert("Error", "Fallo al leer archivo");
    }
  };

  const exportAssets = async () => {
    try {
      let conditions: string[] = [];
      let params: any[] = [];

      if (searchText.trim()) {
        conditions.push('(codigo LIKE ? OR nombre LIKE ?)');
        params.push(`%${searchText.trim()}%`, `%${searchText.trim()}%`);
      }
      if (filterBuilding) {
        conditions.push('edificio = ?');
        params.push(filterBuilding);
      }
      if (filterLevel) {
        conditions.push('nivel = ?');
        params.push(filterLevel);
      }
      if (filterCategory) {
        conditions.push('categoria = ?');
        params.push(filterCategory);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const allData = await db.getAllAsync<Asset>(`SELECT * FROM activos ${whereClause} ORDER BY id DESC`, params);

      const csv = "codigo,nombre,edificio,nivel,categoria,espacio,serie\n" +
        allData.map(a => `${a.codigo},${a.nombre},${a.edificio || ''},${a.nivel || ''},${a.categoria || ''},${a.espacio || ''},${a.serie || ''}`).join('\n');

      const fileName = activeFiltersCount > 0 ? 'activos_filtrados.csv' : 'activos_todos.csv';
      const fileUri = documentDirectory + fileName;
      await writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });

      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Exportar Activos',
        UTI: 'public.comma-separated-values-text'
      });
    } catch (error) {
      Alert.alert('Error', 'No se pudo exportar.');
    }
  };

  const downloadTemplate = async () => {
    try {
      const templateContent = `codigo,nombre,edificio,nivel,categoria,espacio,serie
ACT-001,Laptop Dell XPS,Edificio A,Piso 1,Equipos de Cómputo,Sala de Juntas,CN-0G5J8H
ACT-002,Monitor Samsung 24,Edificio A,Piso 2,Equipos de Cómputo,Oficina 101,Z3R93LA
ACT-003,Impresora HP LaserJet,Edificio B,Piso 1,Impresoras,Recepción,VNB3K12345
ACT-004,Escritorio Ejecutivo,Edificio B,Piso 3,Mobiliario,Dirección,
ACT-005,Silla Ergonómica,Edificio A,Piso 1,Mobiliario,Sala de Juntas,`;

      const fileUri = documentDirectory + 'plantilla_activos.csv';
      await writeAsStringAsync(fileUri, templateContent, { encoding: 'utf8' });

      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Descargar Plantilla CSV',
        UTI: 'public.comma-separated-values-text'
      });
    } catch (error) {
      Alert.alert('Error', 'No se pudo generar la plantilla.');
    }
  };

  const importExcel = async () => {
    try {
      const data = await importFromExcel();
      if (data.length === 0) return;

      let count = 0;
      for (let row of data) {
        if (row.codigo && row.nombre) {
          try {
            const syncId = generateUUID();
            const updatedAt = getCurrentTimestamp();

            // Insertar activo
            await db.runAsync(
              'INSERT OR IGNORE INTO activos (sync_id, codigo, nombre, edificio, nivel, categoria, espacio, updated_at, serie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                syncId,
                String(row.codigo).trim(),
                String(row.nombre).trim(),
                String(row.edificio || '').trim(),
                String(row.nivel || '').trim(),
                String(row.categoria || '').trim(),
                String(row.espacio || '').trim(),
                updatedAt,
                String(row.serie || '').trim()
              ]
            );

            // Procesar categoría si existe
            if (row.categoria) {
              const catName = String(row.categoria).trim();
              const existingCat = await db.getFirstAsync('SELECT id FROM categorias WHERE nombre = ?', [catName]);

              if (!existingCat) {
                const catSyncId = generateUUID();
                await db.runAsync(
                  'INSERT INTO categorias (sync_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)',
                  [catSyncId, catName, updatedAt, updatedAt]
                );
              }
            }

            count++;
          } catch (e) {
            console.log('Error insertando fila:', e);
          }
        }
      }
      Alert.alert("✅ Importado", `${count} registros procesados desde Excel.`);
      loadFilterOptions();
      loadAssets(true);
    } catch (e) {
      console.log('Error importando Excel:', e);
    }
  };

  const exportExcel = async () => {
    try {
      let conditions: string[] = [];
      let params: any[] = [];

      if (searchText.trim()) {
        conditions.push('(codigo LIKE ? OR nombre LIKE ?)');
        params.push(`%${searchText.trim()}%`, `%${searchText.trim()}%`);
      }
      if (filterBuilding) {
        conditions.push('edificio = ?');
        params.push(filterBuilding);
      }
      if (filterLevel) {
        conditions.push('nivel = ?');
        params.push(filterLevel);
      }
      if (filterCategory) {
        conditions.push('categoria = ?');
        params.push(filterCategory);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const allData = await db.getAllAsync<Asset>(`SELECT * FROM activos ${whereClause} ORDER BY id DESC`, params);

      const excelData = allData.map(a => ({
        codigo: a.codigo,
        nombre: a.nombre,
        edificio: a.edificio || '',
        nivel: a.nivel || '',
        categoria: a.categoria || '',
        espacio: a.espacio || '',
        serie: a.serie || ''
      }));

      const fileName = activeFiltersCount > 0 ? 'activos_filtrados.xlsx' : 'activos_todos.xlsx';
      await exportToExcel(excelData, fileName, 'Activos');
    } catch (error) {
      console.log('Error exportando Excel:', error);
    }
  };

  const downloadExcelTemplateFile = async () => {
    try {
      const sampleData = [
        { codigo: 'ACT-001', nombre: 'Laptop Dell XPS', edificio: 'Edificio A', nivel: 'Piso 1', categoria: 'Equipos de Cómputo', espacio: 'Sala de Juntas' },
        { codigo: 'ACT-002', nombre: 'Monitor Samsung 24', edificio: 'Edificio A', nivel: 'Piso 2', categoria: 'Equipos de Cómputo', espacio: 'Oficina 101' },
        { codigo: 'ACT-003', nombre: 'Impresora HP LaserJet', edificio: 'Edificio B', nivel: 'Piso 1', categoria: 'Impresoras', espacio: 'Recepción' },
        { codigo: 'ACT-004', nombre: 'Escritorio Ejecutivo', edificio: 'Edificio B', nivel: 'Piso 3', categoria: 'Mobiliario', espacio: 'Dirección' },
        { codigo: 'ACT-005', nombre: 'Silla Ergonómica', edificio: 'Edificio A', nivel: 'Piso 1', categoria: 'Mobiliario', espacio: 'Sala de Juntas' }
      ];

      await downloadExcelTemplate(
        ['codigo', 'nombre', 'edificio', 'nivel', 'categoria', 'espacio', 'serie'],
        sampleData.map(d => ({ ...d, serie: '' })), // Placeholder for template
        'plantilla_activos.xlsx'
      );
    } catch (error) {
      console.log('Error generando plantilla Excel:', error);
    }
  };

  const renderFooter = () => {
    if (!hasMore) {
      if (assets.length > 0) {
        return (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: '#999', fontSize: 12 }}>— Fin de la lista —</Text>
          </View>
        );
      }
      return null;
    }
    return (
      <TouchableOpacity
        onPress={loadMore}
        disabled={loadingMore}
        style={{ padding: 15, alignItems: 'center', backgroundColor: '#E3F2FD', borderRadius: 10, marginVertical: 10 }}
      >
        {loadingMore ? (
          <ActivityIndicator color="#007AFF" />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="chevron-down" size={18} color="#007AFF" />
            <Text style={{ color: '#007AFF', fontWeight: '600' }}>
              Cargar más ({totalCount - assets.length} restantes)
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const FilterChips = ({ title, options, selected, onSelect }: { title: string, options: string[], selected: string, onSelect: (v: string) => void }) => (
    <View style={{ marginBottom: 15 }}>
      <Text style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => onSelect('')}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: selected === '' ? '#007AFF' : '#f0f0f0',
            marginRight: 8
          }}
        >
          <Text style={{ color: selected === '' ? 'white' : '#666', fontSize: 13, fontWeight: selected === '' ? '600' : '400' }}>Todos</Text>
        </TouchableOpacity>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            onPress={() => onSelect(opt)}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              backgroundColor: selected === opt ? '#007AFF' : '#f0f0f0',
              marginRight: 8
            }}
          >
            <Text style={{ color: selected === opt ? 'white' : '#666', fontSize: 13, fontWeight: selected === opt ? '600' : '400' }}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
      <View style={{ padding: 15, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: 'bold', textAlign: 'center' }}>📦 Base de Datos</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <View style={{ flex: 1, backgroundColor: '#007AFF', padding: 10, borderRadius: 10, alignItems: 'center' }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>{totalCount}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>Total Activos</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/ubicaciones')}
            style={{ flex: 1, backgroundColor: '#34C759', padding: 10, borderRadius: 10, alignItems: 'center' }}
          >
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>{filterOptions.edificios.length}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>Edificios</Text>
            <Ionicons name="settings-outline" size={12} color="rgba(255,255,255,0.6)" style={{ marginTop: 2 }} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/categorias')}
            style={{ flex: 1, backgroundColor: '#FF9500', padding: 10, borderRadius: 10, alignItems: 'center' }}
          >
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>{filterOptions.categorias.length}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>Categorías</Text>
            <Ionicons name="settings-outline" size={12} color="rgba(255,255,255,0.6)" style={{ marginTop: 2 }} />
          </TouchableOpacity>
          <View style={{ flex: 1, backgroundColor: '#5856D6', padding: 10, borderRadius: 10, alignItems: 'center' }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>{filterOptions.espacios.length}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>Espacios</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e0e0e0' }}>
            <Ionicons name="search" size={18} color="#999" />
            <TextInput
              style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 8, fontSize: 15 }}
              placeholder="Buscar código, nombre o serie..."
              value={searchText}
              onChangeText={setSearchText}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchText ? (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Ionicons name="close-circle" size={18} color="#999" />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            onPress={() => setSearchScanner(true)}
            style={{
              width: 44, height: 44, borderRadius: 10,
              backgroundColor: '#5856D6',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: '#5856D6'
            }}
          >
            <Ionicons name="barcode-outline" size={22} color="white" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSync}
            disabled={syncing}
            style={{
              width: 44, height: 44, borderRadius: 10,
              backgroundColor: 'white',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: '#e0e0e0'
            }}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={20} color="#007AFF" />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setShowFilters(!showFilters)}
            style={{
              width: 44, height: 44, borderRadius: 10,
              backgroundColor: activeFiltersCount > 0 ? '#007AFF' : 'white',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: activeFiltersCount > 0 ? '#007AFF' : '#e0e0e0'
            }}
          >
            <Ionicons name="options" size={20} color={activeFiltersCount > 0 ? 'white' : '#666'} />
            {activeFiltersCount > 0 && (
              <View style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#FF3B30', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>{activeFiltersCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {showFilters && (
          <View style={{ marginTop: 15, backgroundColor: 'white', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#e0e0e0' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Filtros</Text>
              {activeFiltersCount > 0 && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={{ color: '#007AFF', fontSize: 14 }}>Limpiar todo</Text>
                </TouchableOpacity>
              )}
            </View>

            <FilterChips title="EDIFICIO" options={filterOptions.edificios} selected={filterBuilding} onSelect={setFilterBuilding} />
            <FilterChips title="NIVEL" options={filterOptions.niveles} selected={filterLevel} onSelect={setFilterLevel} />
            <FilterChips title="CATEGORÍA" options={filterOptions.categorias} selected={filterCategory} onSelect={setFilterCategory} />
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={{ marginTop: 10, color: '#666' }}>Cargando activos...</Text>
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={i => i.id.toString()}
          contentContainerStyle={{ padding: 15, paddingTop: 5 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => openDetail(item)}
              style={{
                backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 8,
                borderWidth: 1, borderColor: '#e8e8e8',
                shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#007AFF' }}>{item.codigo}</Text>
                  <Text style={{ fontSize: 14, color: '#333', marginTop: 2 }}>{item.nombre}</Text>
                  {item.serie ? (
                    <Text style={{ fontSize: 12, color: '#555', marginTop: 2, fontStyle: 'italic' }}>S/N: {item.serie}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {item.edificio && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                        <Ionicons name="business-outline" size={12} color="#666" />
                        <Text style={{ fontSize: 11, color: '#666', marginLeft: 4 }}>{item.edificio}</Text>
                      </View>
                    )}
                    {item.nivel && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                        <Ionicons name="layers-outline" size={12} color="#666" />
                        <Text style={{ fontSize: 11, color: '#666', marginLeft: 4 }}>{item.nivel}</Text>
                      </View>
                    )}
                    {item.categoria && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                        <Ionicons name="pricetag-outline" size={12} color="#FF9500" />
                        <Text style={{ fontSize: 11, color: '#FF9500', marginLeft: 4 }}>{item.categoria}</Text>
                      </View>
                    )}
                    {item.espacio && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EDE7F6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                        <Ionicons name="location-outline" size={12} color="#5856D6" />
                        <Text style={{ fontSize: 11, color: '#5856D6', marginLeft: 4 }}>{item.espacio}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#ccc" />
              </View>
            </TouchableOpacity>
          )}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 50, padding: 20 }}>
              <Ionicons name="cube-outline" size={60} color="#ccc" />
              <Text style={{ color: '#999', marginTop: 15, fontSize: 16 }}>No hay activos</Text>
              <Text style={{ color: '#bbb', marginTop: 5, textAlign: 'center' }}>
                {activeFiltersCount > 0 ? 'Prueba con otros filtros' : 'Agrega activos o importa un CSV'}
              </Text>
            </View>
          }
        />
      )}

      <View style={{ flexDirection: 'row', padding: 15, gap: 10, borderTopWidth: 1, borderTopColor: '#e0e0e0', backgroundColor: 'white' }}>
        <TouchableOpacity onPress={() => setModal(true)} style={{ flex: 1, backgroundColor: '#007AFF', padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="add-circle" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Nuevo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={importCsv} style={{ flex: 1, backgroundColor: '#FF9500', padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="cloud-upload" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Importar</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={exportAssets} style={{ flex: 1, backgroundColor: '#34C759', padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="download" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Exportar</Text>
        </TouchableOpacity>
      </View>

      {/* Modal Nuevo Activo */}
      <Modal visible={modal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
          <View style={{ padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Nuevo Activo</Text>
              <TouchableOpacity onPress={() => { setModal(false); setCode(''); setName(''); setSerie(''); setBuild(''); setLevel(''); setCategory(''); setSpace(''); setSelectedLocation(null); setSelectedLocationId(null); setSelectedCategoryId(null); }}>
                <Ionicons name="close-circle" size={30} color="#999" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setCam(true)} style={{ backgroundColor: '#007AFF', padding: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 15 }}>
              <Ionicons name="scan" size={20} color="white" />
              <Text style={{ color: 'white', fontWeight: 'bold' }}>Escanear Código</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CÓDIGO *</Text>
            <TextInput value={code} onChangeText={setCode} placeholder="Ej: ACT-001" style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} autoCapitalize="characters" />

            <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>NOMBRE *</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Nombre del activo" style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} />

            <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>SERIE</Text>
            <TextInput value={serie} onChangeText={setSerie} placeholder="Número de serie" style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} />

            <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CATEGORÍA</Text>
            <CategorySelector
              value={selectedCategoryId}
              onSelect={(cat) => {
                setCategory(cat.nombre);
                setSelectedCategoryId(cat.id);
              }}
              placeholder="Seleccionar categoría"
            />

            <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>UBICACIÓN</Text>
            <LocationSelector
              value={selectedLocationId}
              onSelect={(location: Ubicacion, fullPath: Ubicacion[]) => {
                setSelectedLocationId(location.id);
                setSelectedLocation(location);
                // Actualizar campos legacy para compatibilidad
                if (fullPath.length >= 1) setBuild(fullPath[0].nombre);
                if (fullPath.length >= 2) setLevel(fullPath[1].nombre);
                if (fullPath.length >= 3) setSpace(fullPath[2].nombre);
              }}
              placeholder="Seleccionar ubicación"
            />

            <TouchableOpacity onPress={add} style={{ backgroundColor: '#34C759', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 20 }}>
              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Guardar Activo</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={downloadTemplate} style={{ marginTop: 20, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: '#007AFF' }}>📥 Descargar plantilla CSV</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Scanner dentro del modal */}
        <Modal visible={cam} animationType="fade">
          <SafeAreaView style={{ flex: 1, backgroundColor: 'black' }}>
            <CameraView
              style={{ flex: 1 }}
              onBarcodeScanned={({ data }) => {
                const parts = data.split(' ');
                setCode(parts[0].match(/^[\d-]+/)?.[0] || parts[0]);
                setCam(false);
              }}
            />
            <TouchableOpacity onPress={() => setCam(false)} style={{ position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'white', paddingHorizontal: 30, paddingVertical: 12, borderRadius: 25 }}>
              <Text style={{ fontWeight: 'bold' }}>Cancelar</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Modal>
      </Modal>

      {/* Modal Detalle/Editar */}
      <Modal visible={detailModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
          <ScrollView style={{ padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold' }}>{isEditing ? 'Editar Activo' : 'Detalle'}</Text>
              <TouchableOpacity onPress={closeDetail}>
                <Ionicons name="close-circle" size={30} color="#999" />
              </TouchableOpacity>
            </View>

            {!isEditing ? (
              <>
                <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, marginBottom: 15 }}>
                  <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#007AFF', marginBottom: 5 }}>{selectedAsset?.codigo}</Text>
                  <Text style={{ fontSize: 18, color: '#333' }}>{selectedAsset?.nombre}</Text>
                  {selectedAsset?.serie ? (
                    <Text style={{ fontSize: 14, color: '#555', marginTop: 4, fontStyle: 'italic' }}>Serie: {selectedAsset.serie}</Text>
                  ) : null}

                  <View style={{ marginTop: 20 }}>
                    {selectedAsset?.edificio && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <Ionicons name="business" size={18} color="#666" />
                        <Text style={{ marginLeft: 10, fontSize: 15, color: '#666' }}>{selectedAsset.edificio}</Text>
                      </View>
                    )}
                    {selectedAsset?.nivel && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <Ionicons name="layers" size={18} color="#666" />
                        <Text style={{ marginLeft: 10, fontSize: 15, color: '#666' }}>{selectedAsset.nivel}</Text>
                      </View>
                    )}
                    {selectedAsset?.categoria && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <Ionicons name="pricetag" size={18} color="#FF9500" />
                        <Text style={{ marginLeft: 10, fontSize: 15, color: '#FF9500' }}>{selectedAsset.categoria}</Text>
                      </View>
                    )}
                    {selectedAsset?.espacio && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <Ionicons name="location" size={18} color="#5856D6" />
                        <Text style={{ marginLeft: 10, fontSize: 15, color: '#5856D6' }}>{selectedAsset.espacio}</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setIsEditing(true)} style={{ flex: 1, backgroundColor: '#007AFF', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => del(selectedAsset!.id)} style={{ flex: 1, backgroundColor: '#FF3B30', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CÓDIGO *</Text>
                <TextInput value={code} onChangeText={setCode} style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} />

                <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>NOMBRE *</Text>
                <TextInput value={name} onChangeText={setName} style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} />

                <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>SERIE</Text>
                <TextInput value={serie} onChangeText={setSerie} style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' }} />

                <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CATEGORÍA</Text>
                <CategorySelector
                  value={selectedCategoryId}
                  onSelect={(cat) => {
                    setCategory(cat.nombre);
                    setSelectedCategoryId(cat.id);
                  }}
                  placeholder="Seleccionar categoría"
                />

                <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>UBICACIÓN</Text>
                <LocationSelector
                  value={selectedLocationId}
                  onSelect={(location: Ubicacion, fullPath: Ubicacion[]) => {
                    setSelectedLocationId(location.id);
                    setSelectedLocation(location);
                    // Actualizar campos legacy para compatibilidad
                    if (fullPath.length >= 1) setBuild(fullPath[0].nombre);
                    if (fullPath.length >= 2) setLevel(fullPath[1].nombre);
                    if (fullPath.length >= 3) setSpace(fullPath[2].nombre);
                  }}
                  placeholder="Seleccionar ubicación"
                />

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                  <TouchableOpacity onPress={() => setIsEditing(false)} style={{ flex: 1, backgroundColor: '#8E8E93', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={updateAsset} style={{ flex: 1, backgroundColor: '#34C759', padding: 15, borderRadius: 10, alignItems: 'center' }}>
                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Guardar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal Scanner de Búsqueda */}
      <Modal visible={searchScanner} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            onBarcodeScanned={handleSearchScan}
          />

          <View style={{
            position: 'absolute',
            top: 50,
            left: 20,
            right: 20,
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: 20,
            borderRadius: 15
          }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 }}>
              🔍 Buscar Activo
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center' }}>
              Escanea el código de barras del activo que deseas buscar
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => setSearchScanner(false)}
            style={{
              position: 'absolute',
              bottom: 50,
              alignSelf: 'center',
              backgroundColor: 'white',
              paddingHorizontal: 30,
              paddingVertical: 15,
              borderRadius: 25
            }}
          >
            <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Cancelar</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}