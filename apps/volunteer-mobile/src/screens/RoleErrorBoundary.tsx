import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export class RoleErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'The role could not be displayed.' };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <View style={{ padding: 20, backgroundColor: '#fff0f1', borderRadius: 12 }}>
      <Text style={{ color: '#9b2730', fontWeight: '800' }}>Unable to display this role</Text>
      <Text selectable style={{ color: '#9b2730', marginTop: 8 }}>{this.state.error}</Text>
      <Pressable onPress={() => this.setState({ error: null })} style={{ padding: 14, marginTop: 12, backgroundColor: '#111518', borderRadius: 8 }}>
        <Text style={{ color: '#fff' }}>Try again</Text>
      </Pressable>
    </View>;
  }
}
