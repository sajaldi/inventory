
import React from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

interface ZoomableViewProps {
    children: React.ReactNode;
    contentWidth: number;
    contentHeight: number;
    onLayout?: (event: LayoutChangeEvent) => void;
    onSingleTap?: (x: number, y: number) => void;
}

export default function ZoomableView({ children, contentWidth, contentHeight, onLayout, onSingleTap }: ZoomableViewProps) {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const containerWidth = useSharedValue(0);
    const containerHeight = useSharedValue(0);

    const pinch = Gesture.Pinch()
        .onUpdate((e) => {
            scale.value = savedScale.value * e.scale;
        })
        .onEnd(() => {
            if (scale.value < 1) {
                scale.value = withTiming(1);
                translateX.value = withTiming(0);
                translateY.value = withTiming(0);
            } else {
                savedScale.value = scale.value;
            }
        });

    const pan = Gesture.Pan()
        .averageTouches(true)
        .onUpdate((e) => {
            if (scale.value > 1) {
                translateX.value = savedTranslateX.value + e.translationX;
                translateY.value = savedTranslateY.value + e.translationY;
            }
        })
        .onEnd(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        });

    const tap = Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250)
        .maxDistance(20)
        .onEnd((e) => {
            if (onSingleTap) {
                // Fallback if layout not measured yet (rare but possible)
                const cW = containerWidth.value || 0;
                const cH = containerHeight.value || 0;

                // If not measured, just use raw coordinates relative to the view
                // note: e.x and e.y are relative to the view the gesture is attached to (ZoomableView container)

                const containerCenterX = cW > 0 ? cW / 2 : 0;
                const containerCenterY = cH > 0 ? cH / 2 : 0;

                // If not centered/measured, assume 0,0 is center (not ideal but safe)

                const deltaX = e.x - containerCenterX;
                const deltaY = e.y - containerCenterY;

                const contentDeltaX = (deltaX - translateX.value) / scale.value;
                const contentDeltaY = (deltaY - translateY.value) / scale.value;

                // If cW is 0, we can't really know center. But assuming it's usually valid:

                const finalX = (contentWidth / 2) + contentDeltaX;
                const finalY = (contentHeight / 2) + contentDeltaY;

                runOnJS(onSingleTap)(finalX, finalY);
            }
        });

    const composed = Gesture.Simultaneous(pinch, pan, tap);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    const onContainerLayout = (event: LayoutChangeEvent) => {
        containerWidth.value = event.nativeEvent.layout.width;
        containerHeight.value = event.nativeEvent.layout.height;
        if (onLayout) onLayout(event);
    };

    return (
        <GestureHandlerRootView style={styles.container} onLayout={onContainerLayout}>
            <GestureDetector gesture={composed}>
                <Animated.View style={[styles.content, animatedStyle]}>
                    <View onLayout={onLayout}>
                        {children}
                    </View>
                </Animated.View>
            </GestureDetector>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        overflow: 'hidden',
        backgroundColor: '#1a1a2e',
    },
    content: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
