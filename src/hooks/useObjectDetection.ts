import { useState, useEffect, useRef, useCallback } from 'react';
import { loadModel, detectObjects, closeModel } from '../native/TFLiteBridge';
import {
  Detection,
  RawDetection,
  PerformanceMetrics,
  AppSettings,
} from '../types';
import { getDirection } from '../utils/spatialAnalyzer';
import { debug, warn } from '../utils/logger';
import { estimateDistance } from '../utils/distanceEstimator';
import { classifyUrgency } from '../utils/urgencyClassifier';

const INITIAL_METRICS: PerformanceMetrics = {
  inferenceTime: 0,
  totalTime: 0,
  fps: 0,
  detectionCount: 0,
};

export function useObjectDetection(settings: AppSettings) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PerformanceMetrics>(INITIAL_METRICS);

  const lastFrameTimeRef = useRef(Date.now());
  const mountedRef = useRef(true);
  const isLoadingRef = useRef(false);

  // ─── Load / Reload model when settings change ─────────────────────────────

  const initModel = useCallback(async () => {
    if (isLoadingRef.current) return;
    setIsLoading(true);
    isLoadingRef.current = true;
    setError(null);
    setIsModelLoaded(false);

    try {
      const result = await loadModel({
        modelName: settings.selectedModel,
        threshold: settings.detectionThreshold,
        maxDetections: settings.maxDetections,
        numThreads: settings.numThreads,
      });

      if (mountedRef.current) {
        setIsModelLoaded(result.success);
        debug('[TFLite]', result.message);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message ?? 'Failed to load model');
        setIsModelLoaded(false);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
    }
  }, [
    settings.selectedModel,
    settings.detectionThreshold,
    settings.maxDetections,
    settings.numThreads,
  ]);
  // Reload model when settings change
  useEffect(() => {
    mountedRef.current = true;
    initModel();

    return () => {
      mountedRef.current = false;
      closeModel().catch(warn);
    };
  }, [initModel]);

  // ─── Process a single camera frame ────────────────────────────────────────

  const processFrame = useCallback(
    async (imagePath: string): Promise<void> => {
      if (!isModelLoaded || !mountedRef.current) return;

      // FPS calculation
      const now = Date.now();
      const elapsed = now - lastFrameTimeRef.current;
      const currentFps = elapsed > 0 ? Math.round(1000 / elapsed) : 0;
      lastFrameTimeRef.current = now;

      try {
        const response = await detectObjects(imagePath);

        if (!mountedRef.current) return;

        // Map raw detections → enriched detections
        const enriched: Detection[] = response.detections.map(
          (raw: RawDetection, index: number) => {
            const boundingBox = {
              left: raw.left,
              top: raw.top,
              right: raw.right,
              bottom: raw.bottom,
              width: raw.width,
              height: raw.height,
            };

            const direction = getDirection(boundingBox);
            const distance = estimateDistance(
              boundingBox,
              settings.selectedModel,
            );
            const urgency = classifyUrgency(raw.label, distance);

            return {
              id: `${index}-${now}`,
              label: raw.label,
              confidence: raw.confidence,
              boundingBox,
              direction,
              distance,
              urgency,
              modelName: settings.selectedModel,
            };
          },
        );

        setDetections(enriched);
        setMetrics({
          inferenceTime: response.inferenceTime,
          totalTime: response.totalTime,
          fps: currentFps,
          detectionCount: enriched.length,
        });
      } catch (e: any) {
        warn('[Detection Error]', e?.message);
      }
    },
    [isModelLoaded, settings.selectedModel],
  );

  return {
    detections,
    isModelLoaded,
    isLoading,
    error,
    metrics,
    processFrame,
    reloadModel: initModel,
  };
}
