import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Detection } from '../types';
import { URGENCY_COLORS } from '../constants/labels';

interface Props {
  detections: Detection[];
}

const DetectionPanel: React.FC<Props> = ({ detections }) => {
  if (detections.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>👁 Scanning environment...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Detected Objects ({detections.length})</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
      >
        {detections.map(det => (
          <View key={det.id} style={styles.card}>
            {/* Urgency indicator bar */}
            <View
              style={[
                styles.cardBar,
                { backgroundColor: URGENCY_COLORS[det.urgency] },
              ]}
            />

            {/* Label */}
            <Text style={styles.cardLabel} numberOfLines={1}>
              {det.label}
            </Text>

            {/* Confidence */}
            <Text style={styles.cardConfidence}>
              {Math.round(det.confidence * 100)}%
            </Text>

            {/* Direction */}
            <View style={styles.cardRow}>
              <Text style={styles.cardIcon}>
                {det.direction === 'left'
                  ? '◀'
                  : det.direction === 'right'
                  ? '▶'
                  : '▲'}
              </Text>
              <Text style={styles.cardMeta}>{det.direction}</Text>
            </View>

            {/* Distance */}
            <View style={styles.cardRow}>
              <Text style={styles.cardIcon}>
                {det.distance === 'near'
                  ? '🔴'
                  : det.distance === 'medium'
                  ? '🟡'
                  : '🟢'}
              </Text>
              <Text style={styles.cardMeta}>{det.distance}</Text>
            </View>

            {/* Urgency badge */}
            <View
              style={[
                styles.urgencyBadge,
                { backgroundColor: URGENCY_COLORS[det.urgency] + '33' },
              ]}
            >
              <Text
                style={[
                  styles.urgencyText,
                  { color: URGENCY_COLORS[det.urgency] },
                ]}
              >
                {det.urgency.toUpperCase()}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 145,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 10,
  },
  title: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  scroll: {
    flexDirection: 'row',
  },
  card: {
    backgroundColor: 'rgba(28,28,30,0.90)',
    borderRadius: 14,
    padding: 12,
    marginRight: 10,
    minWidth: 110,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  cardBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  cardLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'capitalize',
  },
  cardConfidence: {
    color: '#00FF88',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 4,
  },
  cardIcon: {
    fontSize: 10,
  },
  cardMeta: {
    color: '#AAAAAA',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  urgencyBadge: {
    marginTop: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  urgencyText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

export default DetectionPanel;
