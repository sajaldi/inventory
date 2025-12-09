import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { documentDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, FlatList, Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from 'react-native';

interface ScanComment {
  id: string;
  text: string;
  photos: string[]; // URIs de fotos
  date: string;
}

interface ScanItem {
  id: string;
  type: string;
  data: string;
  originalData?: string;
  date: string;
  assetInfo?: {
    id: number;
    nombre: string;
    edificio: string;
    nivel: string;
    categoria: string;
    espacio: string;
  } | null;
  comments?: ScanComment[];
}

export default function ScannerScreen() {
  const db = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [history, setHistory] = useState<ScanItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedAsset, setLastScannedAsset] = useState<any>(null);
  const [showAssetModal, setShowAssetModal] = useState(false);

  // Referencia para el sonido
  const successSoundRef = useRef<Audio.Sound | null>(null);

  // Estados para edición
  const [editModal, setEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ScanItem | null>(null);
  const [editCode, setEditCode] = useState('');

  // Estados para comentarios y fotos
  const [detailModal, setDetailModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScanItem | null>(null);
  const [newComment, setNewComment] = useState('');
  const [newPhotos, setNewPhotos] = useState<string[]>([]);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('history').then(d => { if (d) setHistory(JSON.parse(d)) });
  }, []);

  const save = async (newList: ScanItem[]) => {
    setHistory(newList);
    await AsyncStorage.setItem('history', JSON.stringify(newList));
  };

  const extractNumericCode = (rawData: string): string => {
    const parts = rawData.trim().split(/\s+/);
    let code = parts[0];
    const numericMatch = code.match(/^[\d-]+/);
    if (numericMatch && numericMatch[0].length > 0) {
      return numericMatch[0];
    }
    return code;
  };

  const findAssetByCode = async (code: string) => {
    try {
      const result = await db.getFirstAsync<any>(
        'SELECT * FROM activos WHERE codigo = ?',
        [code]
      );
      return result;
    } catch (e) {
      console.log('Error buscando activo:', e);
      return null;
    }
  };

  // Reproducir sonido de éxito (ting)
  const playSuccessSound = async () => {
    try {
      // Configurar audio para que suene incluso en silencio
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      // Sonido de notificación/ting - usando un CDN confiable
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' }, // Ting de notificación
        { shouldPlay: true, volume: 1.0 }
      );

      successSoundRef.current = sound;

      // Limpiar después de reproducir
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      console.log('Error reproduciendo sonido:', error);
      // Si falla el sonido, al menos vibramos más fuerte
      Vibration.vibrate([0, 100, 50, 100]);
    }
  };

  const onScan = async ({ type, data }: any) => {
    if (scanned) return;
    setScanned(true);
    Vibration.vibrate();

    const processedCode = extractNumericCode(data);

    // Verificar si ya fue escaneado
    const alreadyScanned = history.some(item => item.data === processedCode);
    if (alreadyScanned) {
      Alert.alert('⚠️ Duplicado', `El código "${processedCode}" ya fue escaneado anteriormente.`);
      setTimeout(() => setScanned(false), 1000);
      return;
    }

    const asset = await findAssetByCode(processedCode);

    const newItem: ScanItem = {
      id: Date.now().toString(),
      type,
      data: processedCode,
      originalData: data !== processedCode ? data : undefined,
      date: new Date().toLocaleTimeString(),
      assetInfo: asset ? {
        id: asset.id,
        nombre: asset.nombre,
        edificio: asset.edificio,
        nivel: asset.nivel,
        categoria: asset.categoria || '',
        espacio: asset.espacio || ''
      } : null,
      comments: []
    };

    save([newItem, ...history]);

    if (asset) {
      // ¡Activo encontrado! Reproducir sonido de éxito
      await playSuccessSound();
      setLastScannedAsset(asset);
      setShowAssetModal(true);
    }

    setTimeout(() => setScanned(false), 1500);
  };

  // Abrir modal de edición (para items sin asset)
  const openEditModal = (item: ScanItem) => {
    setEditingItem(item);
    setEditCode(item.data);
    setEditModal(true);
  };

  // Abrir modal de detalle/comentarios (para items con asset)
  const openDetailModal = (item: ScanItem) => {
    setSelectedItem(item);
    setNewComment('');
    setNewPhotos([]);
    setDetailModal(true);
  };

  // Manejar clic en item
  const handleItemPress = (item: ScanItem) => {
    if (item.assetInfo) {
      openDetailModal(item);
    } else {
      openEditModal(item);
    }
  };

  // Tomar foto
  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso Denegado', 'Se necesita acceso a la cámara para tomar fotos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setNewPhotos([...newPhotos, result.assets[0].uri]);
    }
  };

  // Seleccionar foto de galería
  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso Denegado', 'Se necesita acceso a la galería.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setNewPhotos([...newPhotos, result.assets[0].uri]);
    }
  };

  // Eliminar foto pendiente
  const removeNewPhoto = (index: number) => {
    setNewPhotos(newPhotos.filter((_, i) => i !== index));
  };

  // Guardar comentario
  const saveComment = async () => {
    if (!selectedItem || (!newComment.trim() && newPhotos.length === 0)) {
      Alert.alert('Error', 'Escribe un comentario o agrega al menos una foto.');
      return;
    }

    const comment: ScanComment = {
      id: Date.now().toString(),
      text: newComment.trim(),
      photos: newPhotos,
      date: new Date().toLocaleString()
    };

    const updatedItem: ScanItem = {
      ...selectedItem,
      comments: [...(selectedItem.comments || []), comment]
    };

    const newList = history.map(item =>
      item.id === selectedItem.id ? updatedItem : item
    );

    await save(newList);
    setSelectedItem(updatedItem);
    setNewComment('');
    setNewPhotos([]);
    Alert.alert('✅ Guardado', 'Comentario agregado correctamente.');
  };

  // Eliminar comentario
  const deleteComment = (commentId: string) => {
    if (!selectedItem) return;

    Alert.alert('Eliminar Comentario', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const updatedItem: ScanItem = {
            ...selectedItem,
            comments: (selectedItem.comments || []).filter(c => c.id !== commentId)
          };

          const newList = history.map(item =>
            item.id === selectedItem.id ? updatedItem : item
          );

          await save(newList);
          setSelectedItem(updatedItem);
        }
      }
    ]);
  };

  const saveEdit = async () => {
    if (!editingItem || !editCode.trim()) return;

    const asset = await findAssetByCode(editCode.trim());

    const updatedItem: ScanItem = {
      ...editingItem,
      data: editCode.trim(),
      assetInfo: asset ? {
        id: asset.id,
        nombre: asset.nombre,
        edificio: asset.edificio,
        nivel: asset.nivel,
        categoria: asset.categoria || '',
        espacio: asset.espacio || ''
      } : null
    };

    const newList = history.map(item =>
      item.id === editingItem.id ? updatedItem : item
    );

    await save(newList);
    setEditModal(false);
    setEditingItem(null);
    setEditCode('');

    if (asset) {
      Alert.alert('✅ Activo Encontrado', `El código "${editCode.trim()}" coincide con:\n\n${asset.nombre}`);
    } else {
      Alert.alert('⚠️ No Encontrado', `El código "${editCode.trim()}" no existe en la base de datos.`);
    }
  };

  const reverifyAll = async () => {
    Alert.alert(
      'Re-verificar Todo',
      '¿Verificar nuevamente todos los códigos contra la base de datos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Verificar',
          onPress: async () => {
            const updatedList = await Promise.all(
              history.map(async (item) => {
                const asset = await findAssetByCode(item.data);
                return {
                  ...item,
                  assetInfo: asset ? {
                    id: asset.id,
                    nombre: asset.nombre,
                    edificio: asset.edificio,
                    nivel: asset.nivel,
                    categoria: asset.categoria || '',
                    espacio: asset.espacio || ''
                  } : null
                };
              })
            );
            await save(updatedList);
            Alert.alert('✅ Completado', 'Se verificaron todos los códigos.');
          }
        }
      ]
    );
  };

  const exportCsv = async () => {
    const csv = "Codigo,CodigoOriginal,Fecha,EncontradoEnDB,Nombre,Edificio,Nivel,NumComentarios\n" +
      history.map(i => {
        const found = i.assetInfo ? 'SI' : 'NO';
        const nombre = i.assetInfo?.nombre || '';
        const edificio = i.assetInfo?.edificio || '';
        const nivel = i.assetInfo?.nivel || '';
        const original = i.originalData || '';
        const numComments = i.comments?.length || 0;
        return `${i.data},${original},${i.date},${found},${nombre},${edificio},${nivel},${numComments}`;
      }).join('\n');
    const uri = documentDirectory + 'scan_inventario.csv';
    await writeAsStringAsync(uri, csv, { encoding: 'utf8' });
    await Sharing.shareAsync(uri);
  };

  const deleteItem = (id: string) => {
    Alert.alert('Eliminar', '¿Eliminar este escaneo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: () => {
          const newList = history.filter(item => item.id !== id);
          save(newList);
        }
      }
    ]);
  };

  if (!permission?.granted) return <Button title="Permiso Cámara" onPress={requestPermission} />;

  const totalScans = history.length;
  const foundInDb = history.filter(h => h.assetInfo).length;
  const notFoundInDb = totalScans - foundInDb;

  return (
    <SafeAreaView style={{ flex: 1, padding: 20, backgroundColor: '#f4f4f4' }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 15 }}>📦 Escáner de Inventario</Text>

      {/* Estadísticas */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
        <View style={{ flex: 1, backgroundColor: '#007AFF', padding: 12, borderRadius: 10, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>{totalScans}</Text>
          <Text style={{ color: 'white', fontSize: 11 }}>Escaneos</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#34C759', padding: 12, borderRadius: 10, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>{foundInDb}</Text>
          <Text style={{ color: 'white', fontSize: 11 }}>En Base</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#FF9500', padding: 12, borderRadius: 10, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>{notFoundInDb}</Text>
          <Text style={{ color: 'white', fontSize: 11 }}>Sin Registrar</Text>
        </View>
      </View>

      {/* Botones */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
        <TouchableOpacity
          onPress={() => setIsScanning(true)}
          style={{ flex: 1, backgroundColor: '#007AFF', padding: 14, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <Ionicons name="scan" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Escanear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={exportCsv}
          style={{ flex: 1, backgroundColor: '#34C759', padding: 14, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <Ionicons name="download-outline" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Exportar</Text>
        </TouchableOpacity>
      </View>

      {history.length > 0 && (
        <TouchableOpacity
          onPress={reverifyAll}
          style={{ backgroundColor: '#5856D6', padding: 10, borderRadius: 8, alignItems: 'center', marginBottom: 15, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <Ionicons name="refresh" size={18} color="white" />
          <Text style={{ color: 'white', fontWeight: '600', fontSize: 13 }}>Re-verificar todos en BD</Text>
        </TouchableOpacity>
      )}

      {/* Lista de escaneos */}
      <Text style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>Historial de Escaneos</Text>
      <FlatList
        data={history}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handleItemPress(item)}
            style={{
              padding: 15,
              backgroundColor: item.assetInfo ? '#E8F5E9' : 'white',
              marginBottom: 10,
              borderRadius: 12,
              borderLeftWidth: 4,
              borderLeftColor: item.assetInfo ? '#34C759' : '#FF9500',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {item.assetInfo ? (
                  <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                ) : (
                  <Ionicons name="alert-circle" size={20} color="#FF9500" />
                )}
                <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{item.data}</Text>
                {item.assetInfo ? (
                  <Ionicons name="chatbubble-ellipses" size={14} color="#007AFF" />
                ) : (
                  <Ionicons name="pencil" size={14} color="#999" />
                )}
              </View>

              {item.originalData && (
                <Text style={{ color: '#999', fontSize: 10, marginTop: 2 }}>Original: {item.originalData}</Text>
              )}

              {item.assetInfo ? (
                <View style={{ marginTop: 5 }}>
                  <Text style={{ color: '#34C759', fontWeight: '600' }}>✓ {item.assetInfo.nombre}</Text>
                  <Text style={{ color: '#666', fontSize: 12 }}>
                    🏢 {item.assetInfo.edificio || 'N/A'} • 🏚️ {item.assetInfo.nivel || 'N/A'}
                  </Text>
                  {item.comments && item.comments.length > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                      <Ionicons name="chatbubbles" size={12} color="#007AFF" />
                      <Text style={{ color: '#007AFF', fontSize: 11 }}>{item.comments.length} comentario(s)</Text>
                      {item.comments.some(c => c.photos.length > 0) && (
                        <>
                          <Ionicons name="images" size={12} color="#5856D6" />
                          <Text style={{ color: '#5856D6', fontSize: 11 }}>con fotos</Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <Text style={{ color: '#FF9500', fontSize: 12, marginTop: 3 }}>⚠️ No encontrado - toca para editar</Text>
              )}

              <Text style={{ color: '#999', fontSize: 11, marginTop: 5 }}>{item.type} • {item.date}</Text>
            </View>

            <TouchableOpacity onPress={() => deleteItem(item.id)} style={{ padding: 8 }}>
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 50 }}>
            <Ionicons name="scan-outline" size={60} color="#ccc" />
            <Text style={{ color: '#999', marginTop: 10 }}>No hay escaneos todavía</Text>
            <Text style={{ color: '#ccc', fontSize: 12 }}>Presiona "Escanear" para comenzar</Text>
          </View>
        }
      />

      {history.length > 0 && (
        <TouchableOpacity
          onPress={() => Alert.alert('Borrar todo', '¿Eliminar todo el historial?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Borrar', style: 'destructive', onPress: () => save([]) }
          ])}
          style={{ backgroundColor: '#FF3B30', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 }}
        >
          <Text style={{ color: 'white', fontWeight: 'bold' }}>🗑️ Limpiar Historial</Text>
        </TouchableOpacity>
      )}

      {/* Modal Cámara Escáner */}
      <Modal visible={isScanning}>
        <CameraView
          style={StyleSheet.absoluteFill}
          onBarcodeScanned={scanned ? undefined : onScan}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "code128", "code39", "pdf417", "aztec", "datamatrix"] }}
        />
        <View style={{ position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 }}>
            <Text style={{ color: 'white', fontWeight: 'bold' }}>Apunta al código</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => setIsScanning(false)}
          style={{ position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'white', paddingHorizontal: 30, paddingVertical: 12, borderRadius: 25 }}
        >
          <Text style={{ fontWeight: 'bold' }}>Cerrar</Text>
        </TouchableOpacity>
      </Modal>

      {/* Modal Activo Encontrado */}
      <Modal visible={showAssetModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 20, padding: 25, width: '100%', maxWidth: 350 }}>
            <View style={{ alignItems: 'center', marginBottom: 15 }}>
              <View style={{ backgroundColor: '#E8F5E9', padding: 15, borderRadius: 50, marginBottom: 10 }}>
                <Ionicons name="checkmark-circle" size={50} color="#34C759" />
              </View>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#34C759' }}>¡Activo Encontrado!</Text>
            </View>

            <View style={{ backgroundColor: '#f8f8f8', padding: 15, borderRadius: 12, marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: '#888' }}>CÓDIGO</Text>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#007AFF', marginBottom: 10 }}>{lastScannedAsset?.codigo}</Text>

              <Text style={{ fontSize: 12, color: '#888' }}>NOMBRE</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 10 }}>{lastScannedAsset?.nombre}</Text>

              <View style={{ flexDirection: 'row', gap: 20 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: '#888' }}>EDIFICIO</Text>
                  <Text style={{ fontSize: 14 }}>{lastScannedAsset?.edificio || 'N/A'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: '#888' }}>NIVEL</Text>
                  <Text style={{ fontSize: 14 }}>{lastScannedAsset?.nivel || 'N/A'}</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              onPress={() => { setShowAssetModal(false); setLastScannedAsset(null); }}
              style={{ backgroundColor: '#34C759', padding: 15, borderRadius: 12, alignItems: 'center' }}
            >
              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Continuar Escaneando</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Edición (para items sin asset) */}
      <Modal visible={editModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 25 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold' }}>✏️ Editar Código</Text>
              <TouchableOpacity onPress={() => { setEditModal(false); setEditingItem(null); }}>
                <Ionicons name="close-circle" size={28} color="#999" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 12, color: '#888', marginBottom: 5 }}>CÓDIGO</Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: '#ddd',
                padding: 15,
                borderRadius: 10,
                fontSize: 18,
                marginBottom: 10,
                backgroundColor: '#f9f9f9'
              }}
              value={editCode}
              onChangeText={setEditCode}
              placeholder="Ingresa el código"
              autoFocus
            />

            {editingItem?.originalData && (
              <Text style={{ color: '#999', fontSize: 12, marginBottom: 15 }}>
                Código original escaneado: {editingItem.originalData}
              </Text>
            )}

            <Text style={{ color: '#666', fontSize: 13, marginBottom: 20, textAlign: 'center' }}>
              Al guardar, se verificará automáticamente si existe en la base de datos.
            </Text>

            <View style={{ gap: 10 }}>
              <TouchableOpacity
                onPress={saveEdit}
                style={{ backgroundColor: '#007AFF', padding: 15, borderRadius: 12, alignItems: 'center' }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>💾 Guardar y Verificar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => { setEditModal(false); setEditingItem(null); }}
                style={{ backgroundColor: '#f0f0f0', padding: 15, borderRadius: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#666', fontWeight: 'bold', fontSize: 16 }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Detalle/Comentarios (para items con asset) */}
      <Modal visible={detailModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee' }}>
            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>📝 Detalle del Activo</Text>
            <TouchableOpacity onPress={() => { setDetailModal(false); setSelectedItem(null); }}>
              <Ionicons name="close-circle" size={28} color="#999" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {/* Info del Activo */}
            {selectedItem?.assetInfo && (
              <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 }}>
                  <View style={{ backgroundColor: '#E8F5E9', padding: 10, borderRadius: 25 }}>
                    <Ionicons name="checkmark-circle" size={24} color="#34C759" />
                  </View>
                  <View>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#007AFF' }}>{selectedItem.data}</Text>
                    <Text style={{ fontSize: 14, color: '#666' }}>{selectedItem.assetInfo.nombre}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 15 }}>
                  <View style={{ flex: 1, backgroundColor: '#f8f8f8', padding: 12, borderRadius: 8 }}>
                    <Text style={{ fontSize: 11, color: '#888' }}>EDIFICIO</Text>
                    <Text style={{ fontSize: 14, fontWeight: '600' }}>{selectedItem.assetInfo.edificio || 'N/A'}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#f8f8f8', padding: 12, borderRadius: 8 }}>
                    <Text style={{ fontSize: 11, color: '#888' }}>NIVEL</Text>
                    <Text style={{ fontSize: 14, fontWeight: '600' }}>{selectedItem.assetInfo.nivel || 'N/A'}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Agregar Comentario */}
            <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 15 }}>💬 Agregar Comentario</Text>

              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: '#ddd',
                  padding: 12,
                  borderRadius: 10,
                  fontSize: 15,
                  minHeight: 80,
                  textAlignVertical: 'top',
                  backgroundColor: '#f9f9f9',
                  marginBottom: 15
                }}
                value={newComment}
                onChangeText={setNewComment}
                placeholder="Escribe un comentario..."
                multiline
              />

              {/* Fotos pendientes */}
              {newPhotos.length > 0 && (
                <View style={{ marginBottom: 15 }}>
                  <Text style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>Fotos a adjuntar:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {newPhotos.map((photo, index) => (
                      <View key={index} style={{ marginRight: 10 }}>
                        <Image source={{ uri: photo }} style={{ width: 80, height: 80, borderRadius: 8 }} />
                        <TouchableOpacity
                          onPress={() => removeNewPhoto(index)}
                          style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#FF3B30', borderRadius: 10, padding: 2 }}
                        >
                          <Ionicons name="close" size={14} color="white" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Botones de foto */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                <TouchableOpacity
                  onPress={takePhoto}
                  style={{ flex: 1, backgroundColor: '#5856D6', padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                >
                  <Ionicons name="camera" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: '600' }}>Tomar Foto</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={pickPhoto}
                  style={{ flex: 1, backgroundColor: '#FF9500', padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                >
                  <Ionicons name="images" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: '600' }}>Galería</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={saveComment}
                style={{ backgroundColor: '#34C759', padding: 14, borderRadius: 10, alignItems: 'center' }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>💾 Guardar Comentario</Text>
              </TouchableOpacity>
            </View>

            {/* Lista de Comentarios */}
            <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 20 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 15 }}>📋 Comentarios ({selectedItem?.comments?.length || 0})</Text>

              {(!selectedItem?.comments || selectedItem.comments.length === 0) ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Ionicons name="chatbubble-outline" size={40} color="#ccc" />
                  <Text style={{ color: '#999', marginTop: 10 }}>No hay comentarios aún</Text>
                </View>
              ) : (
                selectedItem.comments.map((comment) => (
                  <View key={comment.id} style={{ borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 15, marginBottom: 15 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, color: '#333', marginBottom: 5 }}>{comment.text || '(Solo fotos)'}</Text>
                        <Text style={{ fontSize: 11, color: '#999' }}>{comment.date}</Text>
                      </View>
                      <TouchableOpacity onPress={() => deleteComment(comment.id)} style={{ padding: 5 }}>
                        <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>

                    {comment.photos.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                        {comment.photos.map((photo, idx) => (
                          <TouchableOpacity key={idx} onPress={() => setViewingPhoto(photo)}>
                            <Image source={{ uri: photo }} style={{ width: 100, height: 100, borderRadius: 8, marginRight: 10 }} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal Ver Foto Grande */}
      <Modal visible={!!viewingPhoto} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}>
          {viewingPhoto && (
            <Image source={{ uri: viewingPhoto }} style={{ width: '90%', height: '70%', borderRadius: 10 }} resizeMode="contain" />
          )}
          <TouchableOpacity
            onPress={() => setViewingPhoto(null)}
            style={{ position: 'absolute', top: 60, right: 20, backgroundColor: 'white', borderRadius: 20, padding: 10 }}
          >
            <Ionicons name="close" size={24} color="#333" />
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}