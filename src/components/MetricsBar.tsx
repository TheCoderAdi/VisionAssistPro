import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PerformanceMetrics } from '../types';

interface Props {
  metrics: PerformanceMetrics;
  isModelLoaded: boolean;
  isLoading: boolean;
  modelName: string;
}

const MetricsBar: React.FC<Props> = ({
  metrics,
  isModelLoaded,
  isLoading,
  modelName,
}) => {
  const shortName = modelName.includes('yolo') ? 'YOLOv8' : 'SSD MobileNet';
  const statusColor = isModelLoaded
    ? '#34C759'
    : isLoading
    ? '#FF9500'
    : '#FF3B30';

  const statusText = isModelLoaded
    ? shortName
    : isLoading
    ? 'Loading Model...'
    : 'Model Error';

  return (
    <View style={styles.container}>
      {/* Model Status Row */}
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{statusText}</Text>
        <Text style={styles.offlineTag}>● OFFLINE</Text>
      </View>

      {/* Metrics Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{metrics.fps}</Text>
          <Text style={styles.metricLabel}>FPS</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.metric}>
          <Text style={styles.metricValue}>{metrics.inferenceTime}ms</Text>
          <Text style={styles.metricLabel}>Inference</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.metric}>
          <Text style={styles.metricValue}>{metrics.totalTime}ms</Text>
          <Text style={styles.metricLabel}>Total</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.metric}>
          <Text style={styles.metricValue}>{metrics.detectionCount}</Text>
          <Text style={styles.metricLabel}>Objects</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.80)',
    paddingTop: 44,
    paddingHorizontal: 16,
    paddingBottom: 10,
    zIndex: 100,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 7,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  offlineTag: {
    color: '#34C759',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricValue: {
    color: '#00FF88',
    fontSize: 15,
    fontWeight: '700',
  },
  metricLabel: {
    color: '#888888',
    fontSize: 10,
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});

export default MetricsBar;
