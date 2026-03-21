import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  SafeAreaView,
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

import { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../constants/labels';
import { debug, warn } from '../utils/logger';

const CAPTURE_INTERVAL_MS = 600;

const HomeScreen: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [isRunning, setIsRunning] = useState(true);
  const [_settingsReady, setSettingsReady] = useState(false);

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

  const { speak, announceDetections, stop: stopTTS } = useTTS(settings);
  const { processDetections: processVibrations, cancel: cancelVibration } =
    useVibration(settings.vibrationEnabled);
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
      } finally {
        setSettingsReady(true);
      }
    })();
  }, []);

  // ─── Camera Permission ────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) {
      requestPermission().then(granted => {
        if (!granted) {
          Alert.alert(
            'Camera Permission Required',
            'Vision Assist needs camera access to detect objects.',
            [
              {
                text: 'Grant Permission',
                onPress: () => requestPermission(),
              },
            ],
          );
        }
      });
    }
  }, [hasPermission]);

  // ─── Model Error Handler ──────────────────────────────────────────────────

  useEffect(() => {
    if (error) {
      Alert.alert(
        'Model Error',
        `${error}\n\nMake sure model files are in:\nandroid/app/src/main/assets/models/`,
        [{ text: 'Retry', onPress: reloadModel }, { text: 'OK' }],
      );
    }
  }, [error]);

  // ─── Feedback on Detections ───────────────────────────────────────────────

  useEffect(() => {
    if (!isRunning || detections.length === 0) return;

    const report = analyze(detections);

    if (report.criticalObjects.length > 0) {
      cancelVibration();
      const msg = getGuidance(report);
      speak(msg, true);
      processVibrations(detections);
      return;
    }

    announceDetections(detections);
    processVibrations(detections);
  }, [detections, isRunning]);

  // ─── Capture Loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (isRunning && isModelLoaded && hasPermission) {
      startCaptureLoop();
    } else {
      stopCaptureLoop();
    }
    return () => stopCaptureLoop();
  }, [isRunning, isModelLoaded, hasPermission]);

  const startCaptureLoop = useCallback(() => {
    if (captureTimerRef.current) return;

    captureTimerRef.current = setInterval(async () => {
      if (isCapturingRef.current) return;
      if (!cameraRef.current) return;

      try {
        isCapturingRef.current = true;
        const photo = await cameraRef.current.takePhoto({
          flash: 'off',
        });
        await processFrame(`file://${photo.path}`);
      } catch (e) {
        // Silently ignore frame capture errors
        console.warn('Frame capture error:', e);
      } finally {
        isCapturingRef.current = false;
      }
    }, CAPTURE_INTERVAL_MS);
  }, [processFrame]);

  const stopCaptureLoop = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    isCapturingRef.current = false;
  }, []);

  // ─── Controls ─────────────────────────────────────────────────────────────

  const toggleRunning = useCallback(() => {
    if (isRunning) {
      stopCaptureLoop();
      stopTTS();
      cancelVibration();
      setIsRunning(false);
      speak('Vision Assist paused', true);
    } else {
      setIsRunning(true);
      speak('Vision Assist resumed', true);
    }
  }, [isRunning, stopCaptureLoop, stopTTS, cancelVibration, speak]);

  const describeScene = useCallback(() => {
    const report = analyze(detections);
    const guidance = getGuidance(report);

    if (guidance) {
      speak(guidance, true);
    } else if (detections.length === 0) {
      speak('No objects detected. Path appears clear.', true);
    } else {
      const labels = detections.map(d => d.label).join(', ');
      speak(`Detected: ${labels}`, true);
    }
  }, [detections, analyze, getGuidance, speak]);

  // ─── Permission Screen ────────────────────────────────────────────────────

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

  debug({ detections, s: settings.overlayEnabled });
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
        photo={true}
        enableZoomGesture={false}
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

      {/* Detection Cards */}
      <DetectionPanel detections={detections} />

      {/* Bottom Controls */}
      <View style={styles.controls}>
        {/* Settings */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnSecondary]}
          onPress={() => setShowSettings(true)}
          accessibilityLabel="Open settings"
          accessibilityHint="Configure model, audio, and vibration options"
        >
          <Text style={styles.ctrlIcon}>⚙️</Text>
          <Text style={styles.ctrlLabel}>Settings</Text>
        </TouchableOpacity>

        {/* Play / Pause - center + larger */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnMain]}
          onPress={toggleRunning}
          accessibilityLabel={
            isRunning ? 'Pause detection' : 'Resume detection'
          }
        >
          <Text style={[styles.ctrlIcon, { fontSize: 28 }]}>
            {isRunning ? '⏸' : '▶'}
          </Text>
          <Text style={styles.ctrlLabel}>{isRunning ? 'Pause' : 'Resume'}</Text>
        </TouchableOpacity>

        {/* Describe Scene */}
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnSecondary]}
          onPress={describeScene}
          accessibilityLabel="Describe current scene"
          accessibilityHint="Speaks a summary of detected objects and navigation guidance"
        >
          <Text style={styles.ctrlIcon}>🔍</Text>
          <Text style={styles.ctrlLabel}>Describe</Text>
        </TouchableOpacity>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSettings(false)}
      >
        <SettingsScreen
          settings={settings}
          onSave={newSettings => {
            setSettings(newSettings);
            setShowSettings(false);
            speak('Settings saved', true);
          }}
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
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
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
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  ctrlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  ctrlBtnMain: {
    width: 88,
    height: 88,
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  ctrlBtnSecondary: {
    width: 68,
    height: 68,
    backgroundColor: 'rgba(44,44,46,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ctrlIcon: {
    fontSize: 22,
  },
  ctrlLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
  },
});

export default HomeScreen;
