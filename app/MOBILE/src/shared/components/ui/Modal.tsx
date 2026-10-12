import { type ReactNode } from 'react';
import { Modal as RNModal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { useTheme } from '@/core/theme';

import { Text } from './Text';

export type ModalProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
};

/** Centered themed modal with backdrop and scale/fade animation. */
export function Modal({ visible, onClose, title, children }: ModalProps) {
  const theme = useTheme();

  return (
    <RNModal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View entering={FadeIn} exiting={FadeOut} style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          entering={ZoomIn.duration(theme.motion.duration.base)}
          exiting={ZoomOut.duration(theme.motion.duration.fast)}
          accessibilityViewIsModal
          style={[
            styles.card,
            theme.shadows.modal,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderRadius: theme.radius.large,
              maxWidth: theme.breakpoints.md,
            },
          ]}>
          {title ? (
            <Text variant="headline" style={{ marginBottom: theme.spacing.sm }}>
              {title}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { width: '100%', padding: 20 },
});
