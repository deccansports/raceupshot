/*
 * Reanimated mutates shared values (`.value`) inside worklets and effects, which
 * the React Compiler's immutability lint rule flags as a false positive. Disable
 * it for this gesture-driven component.
 */
/* eslint-disable react-hooks/immutability */
import { useEffect, type ReactNode } from 'react';
import { Modal as RNModal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/core/theme';

import { Text } from './Text';

const absoluteFillObject = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  height?: number;
  inline?: boolean;
  children?: ReactNode;
};

/** Gesture-driven bottom sheet with drag-to-dismiss (reduce-motion aware). */
export function BottomSheet({ visible, onClose, title, height = 340, inline = false, children }: BottomSheetProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = Math.min(height, screenHeight * 0.9);
  const translateY = useSharedValue(sheetHeight);

  useEffect(() => {
    translateY.value = visible
      ? reduced
        ? 0
        : withSpring(0, theme.motion.spring)
      : reduced
        ? sheetHeight
        : withTiming(sheetHeight, { duration: theme.motion.duration.base });
  }, [visible, reduced, sheetHeight, translateY, theme.motion.spring, theme.motion.duration.base]);

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onChange((e) => {
      translateY.value = Math.max(0, Math.min(sheetHeight, translateY.value + e.changeY));
    })
    .onEnd((e) => {
      if (translateY.value > sheetHeight * 0.4 || e.velocityY > 800) {
        if (reduced) {
          translateY.value = sheetHeight;
          runOnJS(onClose)();
          return;
        }
        translateY.value = withTiming(
          sheetHeight,
          { duration: theme.motion.duration.base },
          (finished) => {
            if (finished) runOnJS(onClose)();
          },
        );
      } else {
        translateY.value = withSpring(0, theme.motion.spring);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (inline) {
    if (!visible) return null;

    if (Platform.OS === 'android') {
      return (
        <RNModal
          visible
          transparent
          statusBarTranslucent
          hardwareAccelerated
          animationType="none"
          onRequestClose={onClose}
        >
          <View style={styles.root}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[StyleSheet.absoluteFill, styles.inlineModalBackdrop]}
              onPress={onClose}
            />
            <Animated.View
              accessibilityViewIsModal
              pointerEvents="auto"
              renderToHardwareTextureAndroid
              style={[
                styles.sheet,
                theme.shadows.modal,
                sheetStyle,
                {
                  height: sheetHeight,
                  backgroundColor: theme.colors.surfaceElevated,
                  borderTopLeftRadius: theme.radius.large,
                  borderTopRightRadius: theme.radius.large,
                  paddingHorizontal: theme.spacing.base,
                  width: '100%',
                },
              ]}
            >
              <GestureDetector gesture={pan}>
                <Animated.View style={styles.handleTouchTarget}>
                  <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
                </Animated.View>
              </GestureDetector>
              {title ? (
                <Text variant="headline" style={{ marginBottom: theme.spacing.sm }}>
                  {title}
                </Text>
              ) : null}
              <View style={styles.content}>{children}</View>
            </Animated.View>
          </View>
        </RNModal>
      );
    }

    return (
      <View pointerEvents={visible ? 'box-none' : 'none'} style={styles.inlineRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.inlineBackdrop}
        />
        <Animated.View
          accessibilityViewIsModal
          pointerEvents="auto"
          style={[
            styles.inlineSheet,
            theme.shadows.modal,
            sheetStyle,
            {
              height: sheetHeight,
              backgroundColor: theme.colors.surfaceElevated,
              borderTopLeftRadius: theme.radius.large,
              borderTopRightRadius: theme.radius.large,
              paddingHorizontal: theme.spacing.base,
              width: '100%',
            },
          ]}>
          <GestureDetector gesture={pan}>
            <Animated.View style={styles.handleTouchTarget}>
              <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
            </Animated.View>
          </GestureDetector>
          {title ? (
            <Text variant="headline" style={{ marginBottom: theme.spacing.sm }}>
              {title}
            </Text>
          ) : null}
          <View style={styles.content}>{children}</View>
        </Animated.View>
      </View>
    );
  }

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={onClose}
        />
        <Animated.View
          accessibilityViewIsModal
          pointerEvents="auto"
          style={[
              styles.sheet,
              theme.shadows.modal,
              sheetStyle,
              {
                height: sheetHeight,
                backgroundColor: theme.colors.surfaceElevated,
                borderTopLeftRadius: theme.radius.large,
                borderTopRightRadius: theme.radius.large,
                paddingHorizontal: theme.spacing.base,
                maxWidth: theme.maxContentWidth,
              },
          ]}>
          <GestureDetector gesture={pan}>
            <Animated.View style={styles.handleTouchTarget}>
              <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
            </Animated.View>
          </GestureDetector>
          {title ? (
            <Text variant="headline" style={{ marginBottom: theme.spacing.sm }}>
              {title}
            </Text>
          ) : null}
          <View style={styles.content}>{children}</View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  inlineModalBackdrop: { backgroundColor: 'transparent' },
  sheet: { width: '100%', alignSelf: 'center', paddingTop: 12, paddingBottom: 24, zIndex: 2, elevation: 2 },
  inlineRoot: { ...absoluteFillObject, zIndex: 100, elevation: 100 },
  inlineBackdrop: { ...absoluteFillObject, zIndex: 100, elevation: 100, backgroundColor: 'transparent' },
  inlineSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 101, elevation: 101, paddingTop: 12, paddingBottom: 24 },
  content: { flex: 1, minHeight: 0 },
  handleTouchTarget: { height: 28, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2 },
});
