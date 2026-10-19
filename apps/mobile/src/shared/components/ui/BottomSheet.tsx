/*
 * Reanimated mutates shared values (`.value`) inside worklets and effects, which
 * the React Compiler's immutability lint rule flags as a false positive. Disable
 * it for this gesture-driven component.
 */
/* eslint-disable react-hooks/immutability, react-hooks/refs */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
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

import { motion, useTheme } from '@/core/theme';

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
  handleColor?: string;
  onHandlePress?: () => void;
  handleAccessibilityLabel?: string;
  children?: ReactNode;
};

/** Gesture-driven bottom sheet with drag-to-dismiss (reduce-motion aware). */
export function BottomSheet({
  visible,
  onClose,
  title,
  height = 340,
  inline = false,
  handleColor,
  onHandlePress,
  handleAccessibilityLabel = 'Collapse panel',
  children,
}: BottomSheetProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = Math.min(height, screenHeight * 0.9);
  const translateY = useSharedValue(sheetHeight);
  const gestureSheetHeight = useSharedValue(sheetHeight);
  const gestureReducedMotion = useSharedValue(reduced ? 1 : 0);
  const onCloseRef = useRef(onClose);
  const closeFromGesture = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    gestureSheetHeight.value = sheetHeight;
    gestureReducedMotion.value = reduced ? 1 : 0;
  }, [gestureReducedMotion, gestureSheetHeight, reduced, sheetHeight]);

  useEffect(() => {
    translateY.value = visible
      ? reduced
        ? 0
        : withSpring(0, theme.motion.spring)
      : reduced
        ? sheetHeight
        : withTiming(sheetHeight, { duration: theme.motion.duration.base });
  }, [visible, reduced, sheetHeight, translateY, theme.motion.spring, theme.motion.duration.base]);

  // Keep one native gesture instance while controlled inputs inside the sheet
  // update. Recreating the gesture on every search keystroke detaches and
  // reattaches the Android gesture subtree, which can blur the TextInput and
  // make the software keyboard repeatedly close and reopen.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onChange((e) => {
          translateY.value = Math.max(
            0,
            Math.min(gestureSheetHeight.value, translateY.value + e.changeY),
          );
        })
        .onEnd((e) => {
          const currentHeight = gestureSheetHeight.value;
          if (translateY.value > currentHeight * 0.4 || e.velocityY > 800) {
            if (gestureReducedMotion.value === 1) {
              translateY.value = currentHeight;
              runOnJS(closeFromGesture)();
              return;
            }
            translateY.value = withTiming(
              currentHeight,
              { duration: motion.duration.base },
              (finished) => {
                if (finished) runOnJS(closeFromGesture)();
              },
            );
          } else {
            translateY.value = withSpring(0, motion.spring);
          }
        }),
    [
      closeFromGesture,
      gestureReducedMotion,
      gestureSheetHeight,
      translateY,
    ],
  );

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
                  <Pressable
                    accessibilityRole={onHandlePress ? 'button' : undefined}
                    accessibilityLabel={onHandlePress ? handleAccessibilityLabel : undefined}
                    onPress={onHandlePress}
                    hitSlop={8}
                    style={styles.handleButton}
                  >
                    <View style={[styles.handle, { backgroundColor: handleColor ?? theme.colors.border }]} />
                  </Pressable>
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
              <Pressable
                accessibilityRole={onHandlePress ? 'button' : undefined}
                accessibilityLabel={onHandlePress ? handleAccessibilityLabel : undefined}
                onPress={onHandlePress}
                hitSlop={8}
                style={styles.handleButton}
              >
                <View style={[styles.handle, { backgroundColor: handleColor ?? theme.colors.border }]} />
              </Pressable>
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
              <Pressable
                accessibilityRole={onHandlePress ? 'button' : undefined}
                accessibilityLabel={onHandlePress ? handleAccessibilityLabel : undefined}
                onPress={onHandlePress}
                hitSlop={8}
                style={styles.handleButton}
              >
                <View style={[styles.handle, { backgroundColor: handleColor ?? theme.colors.border }]} />
              </Pressable>
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
  handleButton: { minWidth: 64, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2 },
});
