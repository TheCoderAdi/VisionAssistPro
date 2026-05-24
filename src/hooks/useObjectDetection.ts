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
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DETECTION_EXPIRY_MS = 1000;
  const isLoadingRef = useRef(false);

  // ─── Load / Reload model when settings change ─────────────────────────────

  // Ensure only one concurrent load happens and callers can await the same promise
  const loadPromiseRef = useRef<Promise<boolean> | null>(null);

  const initModel = useCallback(async (): Promise<boolean> => {
    // If a load is already in progress, return its promise
    if (loadPromiseRef.current) return loadPromiseRef.current;

    setIsLoading(true);
    isLoadingRef.current = true;
    setError(null);
    setIsModelLoaded(false);

    const p = (async () => {
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

        return !!result.success;
      } catch (e: any) {
        if (mountedRef.current) {
          setError(e?.message ?? 'Failed to load model');
          setIsModelLoaded(false);
        }
        return false;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          isLoadingRef.current = false;
          loadPromiseRef.current = null;
        }
      }
    })();

    loadPromiseRef.current = p;
    return p;
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
      if (!mountedRef.current) return;

      // Ensure the model is loaded before attempting detection. If not loaded,
      // trigger a load and wait for it to finish (avoid concurrent loads).
      if (!isModelLoaded) {
        const ok = await initModel();
        if (!ok) return; // still not loaded
      }

      // FPS calculation
      const now = Date.now();
      const elapsed = now - lastFrameTimeRef.current;
      const currentFps = elapsed > 0 ? Math.round(1000 / elapsed) : 0;
      lastFrameTimeRef.current = now;

      try {
        let response;
        try {
          response = await detectObjects(imagePath);
        } catch (innerErr: any) {
          // If native reports model not loaded, attempt one reload and retry once
          const msg = innerErr?.message ?? String(innerErr);
          if (
            msg.includes('MODEL_NOT_LOADED') ||
            msg.includes('Model is not loaded')
          ) {
            debug(
              '[TFLite] detectObjects reported model not loaded, reloading...',
            );
            const ok = await initModel();
            if (!ok) throw innerErr; // give up if reload failed
            response = await detectObjects(imagePath);
          } else {
            throw innerErr;
          }
        }

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

        // Attach timestamp to detections so consumers can expire stale items
        const timestamp = Date.now();
        const withTs = enriched.map(d => ({ ...d, lastSeen: timestamp }));
        setDetections(withTs);
        // Reset expiry timer: clear previous and set a new one to clear detections
        if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setDetections([]);
            setMetrics(INITIAL_METRICS);
          }
        }, DETECTION_EXPIRY_MS);
        setMetrics({
          inferenceTime: response.inferenceTime,
          totalTime: response.totalTime,
          fps: currentFps,
          detectionCount: enriched.length,
        });
      } catch (e: any) {
        // If detection fails (native error, model not loaded, etc.)
        // clear previous detections so UI does not show stale results.
        warn('[Detection Error]', e?.message);
        if (mountedRef.current) {
          setDetections([]);
          setMetrics(INITIAL_METRICS);
          if (expiryTimerRef.current) {
            clearTimeout(expiryTimerRef.current);
            expiryTimerRef.current = null;
          }
        }
      }
    },
    [isModelLoaded, settings.selectedModel, initModel],
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
