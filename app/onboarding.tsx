import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Dimensions, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const { width } = Dimensions.get('window');

const slides = [
    {
        id: 1,
        title: 'Bienvenido a CCG-Inventario',
        description: 'La herramienta para gestionar y auditar los bienes afectos del CCG de manera eficiente.',
        icon: 'cube-outline',
        color: '#4CAF50'
    },
    {
        id: 2,
        title: 'Escaneo Rápido',
        description: 'Utiliza la cámara de tu dispositivo para escanear códigos de barras y verificar inventarios al instante.',
        icon: 'scan-circle-outline',
        color: '#2196F3'
    },
    {
        id: 3,
        title: 'Permisos Necesarios',
        description: 'Para poder escanear, necesitamos acceso a tu cámara. No te preocupes, solo la usaremos para esto.',
        icon: 'camera-outline',
        color: '#FF9500'
    },
    {
        id: 4,
        title: '¡Todo Listo!',
        description: 'Ya puedes comenzar a auditar tus ubicaciones y mantener tu inventario al día.',
        icon: 'checkmark-circle-outline',
        color: '#673AB7'
    }
];

export default function OnboardingScreen() {
    const [currentStep, setCurrentStep] = useState(0);
    const [permission, requestPermission] = useCameraPermissions();
    const router = useRouter();

    const handleNext = async () => {
        if (currentStep < slides.length - 1) {
            // Si estamos en el paso de permisos (índice 2), pedimos permiso
            if (currentStep === 2) {
                if (!permission?.granted) {
                    const result = await requestPermission();
                    if (!result.granted) {
                        // Opcional: Mostrar alerta si niega
                        return;
                    }
                }
            }
            setCurrentStep(currentStep + 1);
        } else {
            // Finalizar onboarding
            await AsyncStorage.setItem('alreadyLaunched', 'true');
            router.replace('/(tabs)');
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const slide = slides[currentStep];

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.contentContainer}>
                {/* Icono Principal */}
                <View style={[styles.iconContainer, { backgroundColor: slide.color + '20' }]}>
                    <Ionicons name={slide.icon as any} size={80} color={slide.color} />
                </View>

                {/* Texto */}
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.description}>{slide.description}</Text>

                {/* Permisos Feedback (Solo slide 2) */}
                {currentStep === 2 && (
                    <View style={styles.permissionStatus}>
                        <Text style={{ color: permission?.granted ? '#4CAF50' : '#F44336', fontWeight: 'bold' }}>
                            Estado: {permission?.granted ? 'Permiso Concedido ✅' : 'Esperando permiso...'}
                        </Text>
                    </View>
                )}
            </View>

            {/* Pagination Indicators */}
            <View style={styles.pagination}>
                {slides.map((_, index) => (
                    <View
                        key={index}
                        style={[
                            styles.dot,
                            currentStep === index ? styles.activeDot : null,
                            { backgroundColor: currentStep === index ? slide.color : '#ccc' }
                        ]}
                    />
                ))}
            </View>

            {/* Buttons */}
            <View style={styles.footer}>
                {currentStep > 0 ? (
                    <TouchableOpacity onPress={handleBack} style={[styles.button, styles.backButton]}>
                        <Text style={styles.backButtonText}>Atrás</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={{ flex: 1 }} />
                )}

                <TouchableOpacity
                    onPress={handleNext}
                    style={[styles.button, styles.nextButton, { backgroundColor: slide.color }]}
                >
                    <Text style={styles.nextButtonText}>
                        {currentStep === 2 && !permission?.granted
                            ? 'Conceder Permiso'
                            : currentStep === slides.length - 1
                                ? 'Comenzar'
                                : 'Siguiente'}
                    </Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'white',
        justifyContent: 'space-between'
    },
    contentContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    iconContainer: {
        width: 160,
        height: 160,
        borderRadius: 80,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 40,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#333',
        textAlign: 'center',
        marginBottom: 15,
    },
    description: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        lineHeight: 24,
    },
    permissionStatus: {
        marginTop: 20,
        padding: 10,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
    },
    pagination: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 20,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginHorizontal: 5,
    },
    activeDot: {
        width: 20,
    },
    footer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingBottom: 40,
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    button: {
        paddingVertical: 15,
        paddingHorizontal: 30,
        borderRadius: 12,
        minWidth: 120,
        alignItems: 'center',
    },
    backButton: {
        backgroundColor: '#f0f0f0',
    },
    backButtonText: {
        color: '#666',
        fontWeight: '600',
        fontSize: 16,
    },
    nextButton: {
        // dynamic bg
    },
    nextButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    }
});
