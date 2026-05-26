import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Vibration,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = {
  onFinish: () => void;
};

const OnboardingScreen: React.FC<Props> = ({ onFinish }) => {
  // Animated values for fade/slide
  const titleAnim = useRef(new Animated.Value(0)).current;
  const bodyAnim = useRef(new Animated.Value(0)).current;
  const featuresAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered entrance
    Animated.stagger(120, [
      Animated.timing(titleAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bodyAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(featuresAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(buttonAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [titleAnim, bodyAnim, featuresAnim, buttonAnim]);

  const doFinish = () => {
    // subtle haptic feedback
    try {
      if (Platform.OS === 'android') {
        // short vibration for Android
        Vibration.vibrate(10);
      } else {
        // iOS: short vibration pattern
        Vibration.vibrate(10);
      }
    } catch {}
    onFinish();
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.headerRow}>
        <View />
        <TouchableOpacity
          onPress={doFinish}
          accessibilityLabel="Skip onboarding"
          style={styles.skipButton}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.container}>
        <Animated.View
          style={[
            styles.titleWrap,
            {
              opacity: titleAnim,
              transform: [
                {
                  translateY: titleAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>Welcome to Vision Assist</Text>
        </Animated.View>

        <Animated.View
          style={{
            opacity: bodyAnim,
            transform: [
              {
                translateY: bodyAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          }}
        >
          <Text style={styles.body}>
            Vision Assist helps you detect nearby objects and gives clear audio
            and haptic alerts to keep you aware of obstacles and points of
            interest.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.features, { opacity: featuresAnim }]}>
          <Text style={styles.feature}>
            • Detect people, vehicles, and objects
          </Text>
          <Text style={styles.feature}>
            • Audio guidance with adjustable settings
          </Text>
          <Text style={styles.feature}>
            • Strong vibration for urgent obstacles
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            {
              opacity: buttonAnim,
              transform: [
                {
                  translateY: buttonAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
            styles.buttonContainer,
          ]}
        >
          <TouchableOpacity
            style={styles.button}
            onPress={doFinish}
            accessibilityLabel="Get started"
          >
            <Text style={styles.buttonText}>Get started</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  skipButton: { paddingHorizontal: 12, paddingVertical: 6 },
  skipText: { color: '#8e8e93', fontSize: 16 },
  titleWrap: { marginBottom: 6 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 12 },
  body: { color: '#c7c7cc', fontSize: 16, lineHeight: 22, marginBottom: 20 },
  features: { marginTop: 8, marginBottom: 28 },
  feature: { color: '#8e8e93', marginBottom: 8 },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  buttonContainer: {
    marginTop: 28,
  },
});

export default OnboardingScreen;
