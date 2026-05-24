import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  StatusBar,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';

import MetricsBar from '../components/MetricsBar';
import DetectionOverlay from '../components/DetectionOverlay';
import DetectionPanel from '../components/DetectionPanel';
import SettingsScreen from './SettingsScreen';

import { useObjectDetection } from '../hooks/useObjectDetection';
import { useTTS } from '../hooks/useTTS';
import { useVibration } from '../hooks/useVibration';
import { useSpatialAwareness } from '../hooks/useSpatialAwareness';

import { AppSettings, FeedbackMode } from '../types';
import { DEFAULT_SETTINGS } from '../constants/labels';
import { warn } from '../utils/logger';
import { SafeAreaView } from 'react-native-safe-area-context';

const CAPTURE_INTERVAL_MS = 200;

const HomeScreen: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [isRunning, setIsRunning] = useState(true);

  const cameraRef = useRef<Camera>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCapturingRef = useRef(false);

  // Camera permission
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Hooks
  const {
    detections,
    isModelLoaded,
    isLoading,
    error,
    metrics,
    processFrame,
    reloadModel,
  } = useObjectDetection(settings);

  // ✅ TTS is active only when feedbackMode === 'tts'
  const ttsActive = settings.feedbackMode === 'tts';
  const vibActive = settings.feedbackMode === 'vibration';

  const {
    speak,
    announceDetections,
    stop: stopTTS,
  } = useTTS({
    ...settings,
    ttsEnabled: ttsActive,
  });
  const { processDetections: processVibrations, cancel: cancelVibration } =
    useVibration(vibActive);
  const { analyze, getGuidance } = useSpatialAwareness();

  // ─── Load Settings ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('@vision_assist_settings');
        if (raw) {
          const saved = JSON.parse(raw) as AppSettings;
          setSettings(prev => ({ ...prev, ...saved }));
        }
      } catch (e) {
        warn('Settings load error:', e);
      }
    })();
  }, []);

  // Update torch state helper (updates settings and persists). The Camera 'torch' prop
  // below will apply the actual flashlight state; we avoid direct runtime calls to
  // cameraRef.setTorch to be compatible across VisionCamera versions and devices.
  const setTorchEnabled = useCallback(
    (on: boolean) => {
      // update state and persist
      setSettings(prev => {
        const updated = { ...prev, torchEnabled: on } as AppSettings;
        AsyncStorage.setItem(
          '@vision_assist_settings',
          JSON.stringify(updated),
        ).catch(() => {});
        return updated;
      });

      // Ensure camera is active when turning torch on so the prop takes effect
      if (on && !isRunning) setIsRunning(true);
    },
    [isRunning],
  );

  // Torch is applied by passing the `torch` prop to the Camera component below.

  // ─── Camera Permission ────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission) {
      requestPermission().then(granted => {
        if (!granted) {
          Alert.alert(
            'Camera Permission Required',
            'Vision Assist needs camera access to detect objects.',
            [{ text: 'Grant Permission', onPress: () => requestPermission() }],
          );
        }
      });
    }
  }, [hasPermission, requestPermission]);

  // ─── Model Error ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      Alert.alert(
        'Model Error',
        `${error}\n\nMake sure model files are in:\nandroid/app/src/main/assets/models/`,
        [{ text: 'Retry', onPress: reloadModel }, { text: 'OK' }],
      );
    }
  }, [error, reloadModel]);

  // ─── Detection Feedback ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    if (detections.length === 0) return;

    const report = analyze(detections);

    if (ttsActive) {
      // TTS mode: speak guidance or announce detections
      if (report.criticalObjects.length > 0) {
        speak(getGuidance(report), true);
      } else {
        announceDetections(detections);
      }
    }

    if (vibActive) {
      // Vibration mode: always process, no TTS interference
      processVibrations(detections);
    }
  }, [
    detections,
    isRunning,
    ttsActive,
    vibActive,
    analyze,
    getGuidance,
    announceDetections,
    processVibrations,
    speak,
  ]);

  // ─── Capture Loop ─────────────────────────────────────────────────────────
  const startCaptureLoop = useCallback(() => {
    if (captureTimerRef.current) return;
    captureTimerRef.current = setInterval(() => {
      if (isCapturingRef.current) return;
      const cam = cameraRef.current;
      if (!cam) return;
      isCapturingRef.current = true;
      cam
        .takeSnapshot({ quality: 40 })
        .then(photo => processFrame(`file://${photo.path}`))
        .catch(e => warn('Frame capture error:', e))
        .finally(() => {
          isCapturingRef.current = false;
        });
    }, CAPTURE_INTERVAL_MS);
  }, [processFrame]);

  const stopCaptureLoop = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    isCapturingRef.current = false;
  }, []);

  useEffect(() => {
    if (isRunning && isModelLoaded && hasPermission) startCaptureLoop();
    else stopCaptureLoop();
    return () => stopCaptureLoop();
  }, [
    isRunning,
    isModelLoaded,
    hasPermission,
    startCaptureLoop,
    stopCaptureLoop,
  ]);

  // ─── Quick toggle feedback mode from main screen ──────────────────────────
  const toggleFeedbackMode = useCallback(() => {
    const next: FeedbackMode =
      settings.feedbackMode === 'tts' ? 'vibration' : 'tts';
    const updated = { ...settings, feedbackMode: next };
    setSettings(updated);
    AsyncStorage.setItem(
      '@vision_assist_settings',
      JSON.stringify(updated),
    ).catch(() => {});
    // Announce mode change via whichever mode is now active
    if (next === 'tts') {
      // Switching TO tts — speak it
      setTimeout(() => speak('Audio mode', true), 100);
    } else {
      // Switching TO vibration — stop TTS, give a triple buzz confirmation
      stopTTS();
      cancelVibration();
      // Triple buzz = feedback mode confirmation
      setTimeout(() => {
        const { Vibration } = require('react-native');
        Vibration.vibrate([1, 120, 80, 120, 80, 120]);
      }, 150);
    }
  }, [settings, speak, stopTTS, cancelVibration]);

  // ─── Controls ─────────────────────────────────────────────────────────────
  const toggleRunning = useCallback(() => {
    if (isRunning) {
      stopCaptureLoop();
      stopTTS();
      cancelVibration();
      setIsRunning(false);
      if (ttsActive) speak('Vision Assist paused', true);
    } else {
      setIsRunning(true);
      if (ttsActive) speak('Vision Assist resumed', true);
    }
  }, [isRunning, ttsActive, stopCaptureLoop, stopTTS, cancelVibration, speak]);

  const describeScene = useCallback(() => {
    if (!ttsActive) {
      // In vibration mode, describe scene temporarily switches to TTS for one utterance
      const report = analyze(detections);
      const guidance = getGuidance(report);
      const msg = guidance
        ? guidance
        : detections.length === 0
        ? 'No objects detected. Path appears clear.'
        : `Detected: ${detections.map(d => d.label).join(', ')}`;
      // Force-speak even in vibration mode for this one action
      const Tts = require('react-native-tts').default;
      Tts.speak(msg);
      return;
    }
    const report = analyze(detections);
    const guidance = getGuidance(report);
    if (guidance) speak(guidance, true);
    else if (detections.length === 0)
      speak('No objects detected. Path appears clear.', true);
    else speak(`Detected: ${detections.map(d => d.label).join(', ')}`, true);
  }, [detections, ttsActive, analyze, getGuidance, speak]);

  const handleSettingsSave = useCallback(
    (newSettings: AppSettings) => {
      setShowSettings(false);
      setTimeout(() => {
        setSettings(newSettings);
        if (newSettings.feedbackMode === 'tts') speak('Settings saved', true);
      }, 350);
    },
    [speak],
  );

  // ─── Permission Screens ───────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.centeredScreen}>
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Required</Text>
        <Text style={styles.permissionBody}>
          Vision Assist needs camera access to detect objects and help you
          navigate safely.
        </Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={requestPermission}
        >
          <Text style={styles.permissionBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centeredScreen}>
        <Text style={styles.permissionTitle}>No Camera Found</Text>
        <Text style={styles.permissionBody}>
          This device does not have a usable rear camera.
        </Text>
      </View>
    );
  }

  // ─── Main Render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* Camera */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isRunning && hasPermission}
        // use the official 'torch' prop supported by react-native-vision-camera
        // to toggle the flashlight instead of calling setTorch on the ref.
        torch={settings.torchEnabled ? 'on' : 'off'}
        photo={true}
        enableZoomGesture={false}
        photoQualityBalance="speed"
        onError={err => warn('[Camera Error]', err?.message ?? err)}
      />

      {/* Overlay */}
      <DetectionOverlay
        detections={detections}
        visible={settings.overlayEnabled}
      />

      {/* Top Metrics */}
      <MetricsBar
        metrics={metrics}
        isModelLoaded={isModelLoaded}
        isLoading={isLoading}
        modelName={settings.selectedModel}
      />

      {/* Paused Banner */}
      {!isRunning && (
        <View style={styles.pausedBanner}>
          <Text style={styles.pausedText}>⏸ PAUSED</Text>
          <Text style={styles.pausedSub}>Tap Resume to continue detection</Text>
        </View>
      )}

      {/* Feedback mode pill — visible at all times so user knows current mode */}
      <View style={styles.modePill}>
        <Text style={styles.modePillIcon}>{ttsActive ? '🔊' : '📳'}</Text>
        <Text style={styles.modePillText}>
          {ttsActive ? 'Audio' : 'Vibration'}
        </Text>
      </View>

      <DetectionPanel detections={detections} />

      {/* Bottom Controls — 4 buttons now */}
      <View style={styles.controls}>
        {/* Lighting Control - larger and more visible */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnSecondary]}
          onPress={() => setTorchEnabled(!settings.torchEnabled)}
          accessibilityLabel="Toggle flashlight"
          accessibilityHint="Turns the camera flash on or off"
        >
          <Text style={styles.ctrlIcon}>
            {settings.torchEnabled ? '🔦' : '💡'}
          </Text>
          <Text style={styles.ctrlLabel}>
            {settings.torchEnabled ? 'Torch ON' : 'Torch'}
          </Text>
        </TouchableOpacity>

        {/* Settings */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnSecondary]}
          onPress={() => setShowSettings(true)}
          accessibilityLabel="Open settings"
        >
          <Text style={styles.ctrlIcon}>⚙️</Text>
          <Text style={styles.ctrlLabel}>Settings</Text>
        </TouchableOpacity>

        {/* Play / Pause */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnMain]}
          onPress={toggleRunning}
          accessibilityLabel={
            isRunning ? 'Pause detection' : 'Resume detection'
          }
        >
          <Text style={[styles.ctrlIcon, styles.ctrlIconLarge]}>
            {isRunning ? '⏸' : '▶'}
          </Text>
          <Text style={styles.ctrlLabel}>{isRunning ? 'Pause' : 'Resume'}</Text>
        </TouchableOpacity>

        {/* Describe Scene */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnSecondary]}
          onPress={describeScene}
          accessibilityLabel="Describe current scene"
        >
          <Text style={styles.ctrlIcon}>🔍</Text>
          <Text style={styles.ctrlLabel}>Describe</Text>
        </TouchableOpacity>

        {/* ✅ NEW: Feedback Mode Toggle */}
        <TouchableOpacity
          style={[
            styles.ctrlBtn,
            styles.ctrlBtnSecondary,
            ttsActive ? styles.ctrlBtnTTS : styles.ctrlBtnVib,
          ]}
          onPress={toggleFeedbackMode}
          accessibilityLabel={
            ttsActive ? 'Switch to vibration mode' : 'Switch to audio mode'
          }
          accessibilityHint="Toggles between text-to-speech and vibration feedback"
        >
          <Text style={styles.ctrlIcon}>{ttsActive ? '🔊' : '📳'}</Text>
          <Text style={styles.ctrlLabel}>
            {ttsActive ? 'Audio' : 'Vibrate'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showSettings}
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <SettingsScreen
          settings={settings}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centeredScreen: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionBody: {
    color: '#8E8E93',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  permissionBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  permissionBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  modePill: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 6,
  },
  modePillIcon: { fontSize: 13 },
  modePillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  pausedBanner: {
    position: 'absolute',
    top: '40%',
    left: 32,
    right: 32,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 18,
    paddingVertical: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pausedText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
  },
  pausedSub: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 6,
  },
  controls: {
    position: 'absolute',
    bottom: 36,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  ctrlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  ctrlBtnMain: {
    width: 80,
    height: 80,
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  ctrlBtnSecondary: {
    width: 62,
    height: 62,
    backgroundColor: 'rgba(44,44,46,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ctrlBtnTTS: {
    borderColor: '#34C759',
    borderWidth: 2,
  },
  ctrlBtnVib: {
    borderColor: '#FF9500',
    borderWidth: 2,
  },
  ctrlIcon: { fontSize: 20 },
  ctrlIconLarge: { fontSize: 28 },
  ctrlLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
  },
});

export default HomeScreen;
