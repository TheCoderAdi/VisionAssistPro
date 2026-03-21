package com.visionassistpro.tflite

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.support.common.FileUtil
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

class ObjectDetector(
    private val context: Context,
    private val modelName: String,
    private val threshold: Float = 0.5f,
    private val maxDetections: Int = 10,
    private val numThreads: Int = 4
) {

    companion object {
        private const val TAG = "ObjectDetector"

    // Input sizes (we ship only YOLOv8 nano)
    private const val YOLO_INPUT_SIZE = 640
    }

    private var interpreter: Interpreter? = null
    private var labels: List<String>      = emptyList()
    private var lastInferenceTime: Long   = 0L

    // ─── Model Variant Enum ──────────────────────────────────────────────────────

    enum class ModelVariant {
        YOLOV8_FLOAT16, // float16/float32 | direct class index
    }

    // We only support YOLOv8 nano in this build
    private var isYolo: Boolean = true
    private var inputSize: Int = YOLO_INPUT_SIZE

    // ─── Initialize ──────────────────────────────────────────────────────────────

    fun initialize(): Boolean {
        return try {

            // ── Load Labels ────────────────────────────────────────────────────
            labels = try {
                FileUtil.loadLabels(context, "models/coco_labels.txt").also {
                    Log.d(TAG, "Loaded ${it.size} labels from coco_labels.txt")
                }
            } catch (e: Exception) {
                try {
                    FileUtil.loadLabels(context, "models/labelmap.txt").also {
                        Log.d(TAG, "Loaded ${it.size} labels from labelmap.txt")
                    }
                } catch (e2: Exception) {
                    Log.w(TAG, "No label file found, labels will show as 'unknown'")
                    emptyList()
                }
            }

            // ── Model setup (YOLO-only)
            isYolo = true
            inputSize = YOLO_INPUT_SIZE
            Log.d(TAG, "Model set to YOLOv8 (inputSize=$inputSize)")

            // ── Load Model ─────────────────────────────────────────────────────
            // ✅ YOUR WORKING APPROACH - simple Interpreter constructor
            // Avoids the Interpreter.Options class conflict completely
            val modelBuffer = loadModelFile("models/$modelName")
            interpreter     = Interpreter(modelBuffer)

            // Log tensor shapes - useful for debugging
            logTensorInfo()
            true

        } catch (e: Exception) {
            Log.e(TAG, "Initialization failed: ${e.message}", e)
            false
        }
    }

    // (Model variant detection removed — this build targets YOLOv8 only)

    // ─── Log Tensor Info (Debug) ──────────────────────────────────────────────

    private fun logTensorInfo() {
        val interp = interpreter ?: return
        Log.d(TAG, "=== INPUT TENSORS ===")
        for (i in 0 until interp.inputTensorCount) {
            val t = interp.getInputTensor(i)
            Log.d(TAG, "  Input[$i] shape=${t.shape().contentToString()} " +
                       "dtype=${t.dataType()}")
        }
        Log.d(TAG, "=== OUTPUT TENSORS ===")
        for (i in 0 until interp.outputTensorCount) {
            val t = interp.getOutputTensor(i)
            Log.d(TAG, "  Output[$i] shape=${t.shape().contentToString()} " +
                       "dtype=${t.dataType()}")
        }
    }

    // ─── Main Detect ──────────────────────────────────────────────────────────

    fun detect(imagePath: String): List<DetectionResult> {
        val interp = interpreter ?: return emptyList()

        return try {
            val bitmap    = decodeBitmap(imagePath) ?: return emptyList()
            val processed = preprocessBitmap(bitmap, inputSize)

            val startTime = SystemClock.uptimeMillis()

            // YOLO-only: always run YOLO inference
            val results = runYoloInference(interp, processed)

            lastInferenceTime = SystemClock.uptimeMillis() - startTime

            Log.d(TAG, "Inference: ${lastInferenceTime}ms | " +
                       "Detections: ${results.size}")

            bitmap.recycle()
            processed.recycle()

            results
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}", e)
            emptyList()
        }
    }


    // ─── YOLOv8 Inference ────────────────────────────────────────────────────

    private fun runYoloInference(
        interp: Interpreter,
        bitmap: Bitmap
    ): List<DetectionResult> {

        val inputBuffer = bitmapToByteBuffer(bitmap, inputSize, isQuantized = false)
        val numAnchors  = 8400
        val outputData  = Array(1) { Array(84) { FloatArray(numAnchors) } }

        interp.run(inputBuffer, outputData)

        val detections = mutableListOf<DetectionResult>()

        for (i in 0 until numAnchors) {
            var bestScore = 0f
            var bestClass = 0

            for (c in 4 until 84) {
                val score = outputData[0][c][i]
                if (score > bestScore) {
                    bestScore = score
                    bestClass = c - 4
                }
            }

            if (bestScore < threshold) continue

            // ✅ FIXED: Check if values are already normalized (0-1)
            // or in pixel coordinates (0-640)
            val rawCx = outputData[0][0][i]
            val rawCy = outputData[0][1][i]
            val rawW  = outputData[0][2][i]
            val rawH  = outputData[0][3][i]

            // ✅ Normalize only if values are in pixel space (> 1.0)
            val cx = if (rawCx > 1.0f) rawCx / inputSize else rawCx
            val cy = if (rawCy > 1.0f) rawCy / inputSize else rawCy
            val w  = if (rawW  > 1.0f) rawW  / inputSize else rawW
            val h  = if (rawH  > 1.0f) rawH  / inputSize else rawH

            val xmin = (cx - w / 2).coerceIn(0f, 1f)
            val ymin = (cy - h / 2).coerceIn(0f, 1f)
            val xmax = (cx + w / 2).coerceIn(0f, 1f)
            val ymax = (cy + h / 2).coerceIn(0f, 1f)

            val boxW = xmax - xmin
            val boxH = ymax - ymin

            if (boxW <= 0f || boxH <= 0f) continue

            // ✅ Log for debugging
            Log.d(TAG, "YOLO[$i]: cx=${"%.3f".format(cx)} " +
                    "cy=${"%.3f".format(cy)} " +
                    "w=${"%.3f".format(w)} " +
                    "h=${"%.3f".format(h)} " +
                    "area=${"%.4f".format(boxW * boxH)}")

            val label = if (bestClass < labels.size) labels[bestClass] else "unknown"

            detections.add(
                DetectionResult(
                    label      = label,
                    confidence = bestScore,
                    left       = xmin,
                    top        = ymin,
                    right      = xmax,
                    bottom     = ymax,
                    width      = boxW,
                    height     = boxH
                )
            )
        }

        return nonMaxSuppression(
            detections.sortedByDescending { it.confidence },
            iouThreshold  = 0.45f,
            maxDetections = maxDetections
        )
    }

    // ─── Non-Maximum Suppression ──────────────────────────────────────────────

    private fun nonMaxSuppression(
        detections: List<DetectionResult>,
        iouThreshold: Float,
        maxDetections: Int
    ): List<DetectionResult> {
        val selected   = mutableListOf<DetectionResult>()
        val suppressed = BooleanArray(detections.size)

        for (i in detections.indices) {
            if (suppressed[i]) continue
            selected.add(detections[i])
            if (selected.size >= maxDetections) break
            for (j in i + 1 until detections.size) {
                if (!suppressed[j] &&
                    iou(detections[i], detections[j]) > iouThreshold) {
                    suppressed[j] = true
                }
            }
        }
        return selected
    }

    private fun iou(a: DetectionResult, b: DetectionResult): Float {
        val iLeft   = maxOf(a.left,   b.left)
        val iTop    = maxOf(a.top,    b.top)
        val iRight  = minOf(a.right,  b.right)
        val iBottom = minOf(a.bottom, b.bottom)
        val iW      = maxOf(0f, iRight - iLeft)
        val iH      = maxOf(0f, iBottom - iTop)
        val iArea   = iW * iH
        val uArea   = a.width * a.height + b.width * b.height - iArea
        return if (uArea <= 0f) 0f else iArea / uArea
    }

    // ─── Image Helpers ────────────────────────────────────────────────────────

    private fun decodeBitmap(imagePath: String): Bitmap? {
        return try {
            val cleanPath = imagePath.removePrefix("file://")
            BitmapFactory.decodeFile(cleanPath)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode bitmap: ${e.message}")
            null
        }
    }

    private fun preprocessBitmap(bitmap: Bitmap, size: Int): Bitmap {
        // Scale keeping aspect ratio then crop to exact size
        val matrix = Matrix()
        val scale  = size.toFloat() / maxOf(bitmap.width, bitmap.height)
        matrix.postScale(scale, scale)
        val scaled = Bitmap.createBitmap(
            bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true
        )
        return Bitmap.createScaledBitmap(scaled, size, size, true)
    }

    private fun bitmapToByteBuffer(
        bitmap: Bitmap,
        inputSize: Int,
        isQuantized: Boolean
    ): ByteBuffer {
        val bytesPerChannel = if (isQuantized) 1 else 4
        val buffer = ByteBuffer.allocateDirect(
            1 * inputSize * inputSize * 3 * bytesPerChannel
        )
        buffer.order(ByteOrder.nativeOrder())
        buffer.rewind()

        val pixels = IntArray(inputSize * inputSize)
        bitmap.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize)

        for (pixel in pixels) {
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8)  and 0xFF
            val b =  pixel         and 0xFF

            if (isQuantized) {
                // Quantized: raw uint8 0-255
                buffer.put(r.toByte())
                buffer.put(g.toByte())
                buffer.put(b.toByte())
            } else {
                // Float: normalize to [-1, +1]
                buffer.putFloat((r - 127.5f) / 127.5f)
                buffer.putFloat((g - 127.5f) / 127.5f)
                buffer.putFloat((b - 127.5f) / 127.5f)
            }
        }

        buffer.rewind()
        return buffer
    }

    // ─── Load Model ───────────────────────────────────────────────────────────

    @Throws(IOException::class)
    private fun loadModelFile(assetPath: String): MappedByteBuffer {
        val afd    = context.assets.openFd(assetPath)
        val stream = FileInputStream(afd.fileDescriptor)
        return stream.channel.map(
            FileChannel.MapMode.READ_ONLY,
            afd.startOffset,
            afd.declaredLength
        )
    }

    // ─── Public Getters ───────────────────────────────────────────────────────

    fun getLastInferenceTime(): Long = lastInferenceTime
    fun isInitialized(): Boolean     = interpreter != null

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    fun close() {
        interpreter?.close()
        interpreter = null
        Log.d(TAG, "ObjectDetector closed")
    }
}