import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';

type Props = {
  onFinish: () => void;
};

const OnboardingScreen: React.FC<Props> = ({ onFinish }) => {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to Vision Assist</Text>
        <Text style={styles.body}>
          Vision Assist helps you detect nearby objects and gives audio and
          haptic alerts to keep you aware of obstacles and points of interest.
        </Text>

        <View style={styles.features}>
          <Text style={styles.feature}>
            • Detect people, vehicles, and everyday objects
          </Text>
          <Text style={styles.feature}>
            • Audio guidance with adjustable settings
          </Text>
          <Text style={styles.feature}>
            • Vibration alerts for urgent obstacles
          </Text>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={onFinish}
          accessibilityLabel="Get started"
        >
          <Text style={styles.buttonText}>Get started</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 12 },
  body: { color: '#c7c7cc', fontSize: 16, lineHeight: 22, marginBottom: 20 },
  features: { marginBottom: 28 },
  feature: { color: '#8e8e93', marginBottom: 8 },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

export default OnboardingScreen;
