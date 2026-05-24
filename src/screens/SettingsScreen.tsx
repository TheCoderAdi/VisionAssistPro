import React, { useState } from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
// Vibration test removed — haptics are managed elsewhere
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, ModelName, FeedbackMode } from '../types';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
  onClose: () => void;
}

// Simple +/- stepper component (moved out of render to avoid recreating functions)
const Stepper = ({
  label,
  value,
  min,
  max,
  step: _step,
  format,
  onInc,
  onDec,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onInc: () => void;
  onDec: () => void;
}) => (
  <View style={styles.stepperRow}>
    <Text style={styles.stepperLabel}>{label}</Text>
    <View style={styles.stepperControls}>
      <TouchableOpacity
        style={[styles.stepBtn, value <= min && styles.stepBtnDisabled]}
        onPress={onDec}
        disabled={value <= min}
      >
        <Text style={styles.stepBtnText}>－</Text>
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{format(value)}</Text>
      <TouchableOpacity
        style={[styles.stepBtn, value >= max && styles.stepBtnDisabled]}
        onPress={onInc}
        disabled={value >= max}
      >
        <Text style={styles.stepBtnText}>＋</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const ToggleRow = ({
  label,
  subtitle,
  value,
  onChange,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) => (
  <View style={styles.toggleRow}>
    <View style={styles.toggleText}>
      <Text style={styles.toggleLabel}>{label}</Text>
      {subtitle ? <Text style={styles.toggleSubtitle}>{subtitle}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: '#3A3A3C', true: '#007AFF' }}
      thumbColor="#FFFFFF"
      ios_backgroundColor="#3A3A3C"
    />
  </View>
);

// ✅ NEW: Two-option segment control for feedback mode
const FeedbackModeSelector = ({
  value,
  onChange,
}: {
  value: FeedbackMode;
  onChange: (v: FeedbackMode) => void;
}) => (
  <View style={styles.segmentContainer}>
    <TouchableOpacity
      style={[styles.segmentBtn, value === 'tts' && styles.segmentBtnActive]}
      onPress={() => onChange('tts')}
    >
      <Text style={styles.segmentIcon}>🔊</Text>
      <Text
        style={[
          styles.segmentLabel,
          value === 'tts' && styles.segmentLabelActive,
        ]}
      >
        Audio (TTS)
      </Text>
      <Text
        style={[
          styles.segmentDesc,
          value === 'tts' && styles.segmentDescActive,
        ]}
      >
        Speaks object names{'\n'}and directions aloud
      </Text>
      {value === 'tts' && (
        <View style={styles.segmentCheck}>
          <Text style={styles.segmentCheckText}>✓</Text>
        </View>
      )}
    </TouchableOpacity>

    <TouchableOpacity
      style={[
        styles.segmentBtn,
        value === 'vibration' && styles.segmentBtnActiveVib,
      ]}
      onPress={() => onChange('vibration')}
    >
      <Text style={styles.segmentIcon}>📳</Text>
      <Text
        style={[
          styles.segmentLabel,
          value === 'vibration' && styles.segmentLabelActive,
        ]}
      >
        Vibration
      </Text>
      <Text
        style={[
          styles.segmentDesc,
          value === 'vibration' && styles.segmentDescActive,
        ]}
      >
        Haptic patterns for{'\n'}urgency levels
      </Text>
      {value === 'vibration' && (
        <View style={[styles.segmentCheck, { backgroundColor: '#FF9500' }]}>
          <Text style={styles.segmentCheckText}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  </View>
);

const SettingsScreen: React.FC<Props> = ({ settings, onSave, onClose }) => {
  const [local, setLocal] = useState<AppSettings>({ ...settings });

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setLocal(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    try {
      // Keep ttsEnabled / vibrationEnabled in sync with feedbackMode
      const toSave: AppSettings = {
        ...local,
        ttsEnabled: local.feedbackMode === 'tts',
        vibrationEnabled: local.feedbackMode === 'vibration',
      };
      await AsyncStorage.setItem(
        '@vision_assist_settings',
        JSON.stringify(toSave),
      );
      onSave(toSave);
    } catch (e) {
      console.error('Save settings error:', e);
    }
  };

  const isTTS = local.feedbackMode === 'tts';

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={save} style={styles.headerBtn}>
          <Text style={[styles.headerBtnText, styles.saveText]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── MODEL SELECTION ── */}
        <Text style={styles.section}>🤖 AI Model</Text>
        <View style={styles.modelRow}>
          {(
            [
              {
                key: 'yolov8n_float16.tflite',
                name: 'YOLOv8 Nano',
                desc: 'Lightweight · Accurate\n~80ms inference',
              },
              {
                key: 'yolo26n_float16.tflite',
                name: 'YOLOv26 Nano',
                desc: 'Experimental · Float16\nRecommended for testing',
              },
            ] as { key: ModelName; name: string; desc: string }[]
          ).map(m => (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.modelCard,
                local.selectedModel === m.key && styles.modelCardActive,
              ]}
              onPress={() => set('selectedModel', m.key)}
            >
              <Text
                style={[
                  styles.modelCardName,
                  local.selectedModel === m.key && styles.modelCardNameActive,
                ]}
              >
                {m.name}
              </Text>
              <Text style={styles.modelCardDesc}>{m.desc}</Text>
              {local.selectedModel === m.key && (
                <View style={styles.modelCheck}>
                  <Text style={styles.modelCheckText}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── DETECTION SETTINGS ── */}
        <Text style={styles.section}>⚙️ Detection</Text>
        <View style={styles.card}>
          <Stepper
            label="Confidence Threshold"
            value={local.detectionThreshold}
            min={0.3}
            max={0.9}
            step={0.05}
            format={v => `${Math.round(v * 100)}%`}
            onDec={() =>
              set(
                'detectionThreshold',
                Math.max(0.3, +(local.detectionThreshold - 0.05).toFixed(2)),
              )
            }
            onInc={() =>
              set(
                'detectionThreshold',
                Math.min(0.9, +(local.detectionThreshold + 0.05).toFixed(2)),
              )
            }
          />
          <View style={styles.rowDivider} />
          <Stepper
            label="Max Detections"
            value={local.maxDetections}
            min={1}
            max={10}
            step={1}
            format={v => `${v}`}
            onDec={() =>
              set('maxDetections', Math.max(1, local.maxDetections - 1))
            }
            onInc={() =>
              set('maxDetections', Math.min(10, local.maxDetections + 1))
            }
          />
          <View style={styles.rowDivider} />
          <Stepper
            label="CPU Threads"
            value={local.numThreads}
            min={1}
            max={8}
            step={1}
            format={v => `${v}`}
            onDec={() => set('numThreads', Math.max(1, local.numThreads - 1))}
            onInc={() => set('numThreads', Math.min(8, local.numThreads + 1))}
          />
        </View>

        {/* ── FEEDBACK MODE ── */}
        <Text style={styles.section}>🎯 Feedback Mode</Text>
        <Text style={styles.sectionNote}>
          Choose how VisionAssist alerts you. Only one mode is active at a time.
        </Text>
        <FeedbackModeSelector
          value={local.feedbackMode}
          onChange={v => set('feedbackMode', v)}
        />

        {/* ── AUDIO SETTINGS — only shown in TTS mode ── */}
        {isTTS && (
          <>
            <Text style={styles.section}>🔊 Audio Settings</Text>
            <View style={styles.card}>
              <Stepper
                label="Speech Rate"
                value={local.ttsRate}
                min={0.2}
                max={1.5}
                step={0.05}
                format={v => `${v.toFixed(2)}x`}
                onDec={() =>
                  set(
                    'ttsRate',
                    Math.max(0.2, +(local.ttsRate - 0.05).toFixed(2)),
                  )
                }
                onInc={() =>
                  set(
                    'ttsRate',
                    Math.min(1.5, +(local.ttsRate + 0.05).toFixed(2)),
                  )
                }
              />
              <View style={styles.rowDivider} />
              <Stepper
                label="Speech Pitch"
                value={local.ttsPitch}
                min={0.5}
                max={2.0}
                step={0.1}
                format={v => `${v.toFixed(1)}`}
                onDec={() =>
                  set(
                    'ttsPitch',
                    Math.max(0.5, +(local.ttsPitch - 0.1).toFixed(1)),
                  )
                }
                onInc={() =>
                  set(
                    'ttsPitch',
                    Math.min(2.0, +(local.ttsPitch + 0.1).toFixed(1)),
                  )
                }
              />
              <View style={styles.rowDivider} />
              <Stepper
                label="Alert Interval"
                value={local.alertInterval}
                min={1000}
                max={8000}
                step={500}
                format={v => `${v / 1000}s`}
                onDec={() =>
                  set(
                    'alertInterval',
                    Math.max(1000, local.alertInterval - 500),
                  )
                }
                onInc={() =>
                  set(
                    'alertInterval',
                    Math.min(8000, local.alertInterval + 500),
                  )
                }
              />
            </View>
          </>
        )}

        {/* ── DISPLAY SETTINGS ── */}
        <Text style={styles.section}>📱 Display</Text>
        <View style={styles.card}>
          <ToggleRow
            label="Detection Overlay"
            subtitle="Show bounding boxes on screen"
            value={local.overlayEnabled}
            onChange={v => set('overlayEnabled', v)}
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveBtnText}>Save Settings</Text>
        </TouchableOpacity>

        {/* Test Vibration removed - use device settings or diagnostics screen instead */}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  headerBtn: {
    padding: 4,
    minWidth: 60,
  },
  headerBtnText: {
    color: '#007AFF',
    fontSize: 16,
  },
  saveText: {
    fontWeight: '700',
    textAlign: 'right',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  section: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 6,
    marginLeft: 4,
  },
  sectionNote: {
    color: '#636366',
    fontSize: 12,
    marginBottom: 12,
    marginLeft: 4,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 16,
  },
  // ── Feedback mode selector ─────────────────────────────────────────────
  segmentContainer: { flexDirection: 'row', gap: 12 },
  segmentBtn: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'flex-start',
  },
  segmentBtnActive: { borderColor: '#34C759', backgroundColor: '#0D2414' },
  segmentBtnActiveVib: { borderColor: '#FF9500', backgroundColor: '#2A1800' },
  segmentIcon: { fontSize: 26, marginBottom: 8 },
  segmentLabel: {
    color: '#8E8E93',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  segmentLabelActive: { color: '#FFFFFF' },
  segmentDesc: { color: '#636366', fontSize: 11, lineHeight: 16 },
  segmentDescActive: { color: '#AAAAAA' },
  segmentCheck: {
    marginTop: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentCheckText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  // ── rest ───────────────────────────────────────────────────────────────
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  toggleText: {
    flex: 1,
    paddingRight: 12,
  },
  toggleLabel: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  toggleSubtitle: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  stepperLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    flex: 1,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.35,
  },
  stepBtnText: {
    color: '#007AFF',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 20,
  },
  stepperValue: {
    color: '#00FF88',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'center',
  },
  modelRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modelCard: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modelCardActive: {
    borderColor: '#007AFF',
    backgroundColor: '#001F3D',
  },
  modelCardName: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  modelCardNameActive: {
    color: '#FFFFFF',
  },
  modelCardDesc: {
    color: '#636366',
    fontSize: 11,
    lineHeight: 16,
  },
  modelCheck: {
    marginTop: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelCheckText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 50,
  },
});

export default SettingsScreen;
