import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Text as SvgText, Line, G } from 'react-native-svg';
import { Detection } from '../types';
import { URGENCY_COLORS } from '../constants/labels';

interface Props {
  detections: Detection[];
  visible: boolean;
}

const { width: SW, height: SH } = Dimensions.get('window');

const DetectionOverlay: React.FC<Props> = ({ detections, visible }) => {
  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={SW} height={SH}>
        {/* Spatial zone dividers */}
        {[0.33, 0.67].map(ratio => (
          <Line
            key={ratio}
            x1={SW * ratio}
            y1={0}
            x2={SW * ratio}
            y2={SH}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1}
            strokeDasharray="8,8"
          />
        ))}

        {/* Zone labels */}
        {(['LEFT', 'CENTER', 'RIGHT'] as const).map((label, i) => (
          <SvgText
            key={label}
            x={SW * [0.165, 0.5, 0.835][i]}
            y={52}
            fill="rgba(255,255,255,0.55)"
            fontSize={11}
            fontWeight="700"
            textAnchor="middle"
          >
            {label}
          </SvgText>
        ))}

        {/* Detection boxes */}
        {detections.map(d => {
          const x = d.boundingBox.left * SW;
          const y = d.boundingBox.top * SH;
          const w = d.boundingBox.width * SW;
          const h = d.boundingBox.height * SH;
          const color = URGENCY_COLORS[d.urgency];
          const pct = Math.round(d.confidence * 100);
          const tag = `${d.label} ${pct}%`;

          return (
            <G key={d.id}>
              <Rect
                x={x}
                y={y}
                width={w}
                height={h}
                stroke={color}
                strokeWidth={2.5}
                fill="transparent"
              />
              {/* Label pill */}
              <Rect
                x={x}
                y={y - 24}
                width={tag.length * 7.8 + 8}
                height={22}
                fill={color}
                rx={5}
              />
              <SvgText
                x={x + 5}
                y={y - 7}
                fill="#FFFFFF"
                fontSize={12}
                fontWeight="bold"
              >
                {tag}
              </SvgText>
              {/* Bottom badge */}
              <SvgText
                x={x + 4}
                y={y + h - 5}
                fill="rgba(255,255,255,0.9)"
                fontSize={10}
              >
                {`${d.direction.toUpperCase()} · ${d.distance.toUpperCase()}`}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
};

export default DetectionOverlay;
