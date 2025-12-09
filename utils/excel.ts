import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import * as XLSX from 'xlsx';

export interface ExcelRow {
    [key: string]: string | number | null;
}

/**
 * Exporta datos a un archivo Excel (.xlsx)
 */
export async function exportToExcel(
    data: ExcelRow[],
    fileName: string,
    sheetName: string = 'Hoja1'
): Promise<void> {
    try {
        // Crear workbook y worksheet
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);

        // Generar archivo Excel en base64
        const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

        // Guardar archivo
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, wbout, {
            encoding: FileSystem.EncodingType.Base64,
        });

        // Compartir archivo
        await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Exportar Excel',
            UTI: 'com.microsoft.excel.xlsx'
        });
    } catch (error) {
        console.error('Error exportando a Excel:', error);
        Alert.alert('Error', 'No se pudo exportar el archivo Excel');
        throw error;
    }
}

/**
 * Importa datos desde un archivo Excel (.xlsx o .xls)
 */
export async function importFromExcel(): Promise<ExcelRow[]> {
    try {
        // Seleccionar archivo
        const result = await DocumentPicker.getDocumentAsync({
            type: [
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-excel'
            ],
            copyToCacheDirectory: true
        });

        if (result.canceled) {
            return [];
        }

        // Leer archivo
        const fileContent = await FileSystem.readAsStringAsync(result.assets[0].uri, {
            encoding: FileSystem.EncodingType.Base64,
        });

        // Parsear Excel
        const wb = XLSX.read(fileContent, { type: 'base64' });

        // Obtener primera hoja
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];

        // Convertir a JSON
        const data = XLSX.utils.sheet_to_json<ExcelRow>(ws);

        return data;
    } catch (error) {
        console.error('Error importando desde Excel:', error);
        Alert.alert('Error', 'No se pudo leer el archivo Excel');
        throw error;
    }
}

/**
 * Genera una plantilla Excel con las columnas especificadas
 */
export async function downloadExcelTemplate(
    columns: string[],
    sampleData: ExcelRow[],
    fileName: string
): Promise<void> {
    try {
        // Crear workbook y worksheet con datos de ejemplo
        const ws = XLSX.utils.json_to_sheet(sampleData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');

        // Generar archivo Excel en base64
        const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

        // Guardar archivo
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, wbout, {
            encoding: FileSystem.EncodingType.Base64,
        });

        // Compartir archivo
        await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Descargar Plantilla Excel',
            UTI: 'com.microsoft.excel.xlsx'
        });
    } catch (error) {
        console.error('Error generando plantilla Excel:', error);
        Alert.alert('Error', 'No se pudo generar la plantilla Excel');
        throw error;
    }
}
