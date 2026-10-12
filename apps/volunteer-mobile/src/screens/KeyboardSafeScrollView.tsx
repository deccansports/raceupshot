import { useEffect, useRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, type ScrollViewProps } from 'react-native';

/** Keeps the focused field visible, including fields in nested role screens. */
export function KeyboardSafeScrollView(props: ScrollViewProps) {
  const scroll = useRef<ScrollView>(null);
  const frame = useRef<number | null>(null);
  function revealInput() {
    if (Platform.OS === 'web') return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const input = TextInput.State.currentlyFocusedInput();
      if (input && Keyboard.isVisible()) {
        scroll.current?.scrollResponderScrollNativeHandleToKeyboard(input, 32, true);
      }
    });
  }
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const shown = Keyboard.addListener('keyboardDidShow', revealInput);
    return () => {
      shown.remove();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  if (Platform.OS === 'web') {
    return <ScrollView {...props} keyboardShouldPersistTaps="handled" />;
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView {...props} ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onLayout={(event) => { props.onLayout?.(event); revealInput(); }}
      onTouchEnd={(event) => { props.onTouchEnd?.(event); revealInput(); }}
      onContentSizeChange={(width, height) => { props.onContentSizeChange?.(width, height); revealInput(); }} />
  </KeyboardAvoidingView>;
}
