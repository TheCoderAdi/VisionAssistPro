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
        private const val YOLO_INPUT_SIZE = 640
    }

    private var interpreter: Interpreter? = null
    private var labels: List<String> = emptyList()
    private var lastInferenceTime: Long = 0L
    private var inputSize: Int = YOLO_INPUT_SIZE

    // Detected once at init — avoids re-checking every frame
    private enum class ModelFormat { YOLO_STANDARD, YOLO_TRANSPOSED, SSD }
    private var modelFormat: ModelFormat = ModelFormat.YOLO_STANDARD

    // ─── Initialize ───────────────────────────────────────────────────────────

    fun initialize(): Boolean {
        return try {
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
                    Log.w(TAG, "No label file found")
                    emptyList()
                }
            }

            inputSize = YOLO_INPUT_SIZE
            val modelBuffer = loadModelFile("models/$modelName")
            interpreter = Interpreter(modelBuffer)

            // ✅ Detect format once here — not on every frame
            modelFormat = detectModelFormat()
            Log.d(TAG, "Model format detected: $modelFormat")

            logTensorInfo()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Initialization failed: ${e.message}", e)
            false
        }
    }

    // ─── Detect model format from output tensor shape ─────────────────────────
    //
    //  YOLO standard:   [1, 84, 8400]  — dim2 is large (anchors), dim1 is small (fields)
    //  YOLO transposed: [1, 8400, 84]  — dim1 is large (anchors), dim2 is small (fields)
    //  SSD:             [1, 300, 6]    — dim2 is tiny (≤6: ymin,xmin,ymax,xmax,class,score)
    //
    //  Your YOLOv26 log showed [1, 300, 6] → that is SSD, not YOLO at all.

    private fun detectModelFormat(): ModelFormat {
        val interp = interpreter ?: return ModelFormat.YOLO_STANDARD
        val shape  = interp.getOutputTensor(0).shape()
        val dim1   = shape[1]
        val dim2   = shape[2]

        // SSD: last dim is 6 or fewer (fixed fields), middle dim is candidate count
        if (dim2 <= 6 && dim1 >= 100) return ModelFormat.SSD

        // YOLO: whichever dim is larger holds the anchors
        return if (dim1 > dim2) ModelFormat.YOLO_TRANSPOSED else ModelFormat.YOLO_STANDARD
    }

    // ─── Log Tensor Info ──────────────────────────────────────────────────────

    private fun logTensorInfo() {
        val interp = interpreter ?: return
        Log.d(TAG, "=== INPUT TENSORS ===")
        for (i in 0 until interp.inputTensorCount) {
            val t = interp.getInputTensor(i)
            Log.d(TAG, "  Input[$i] shape=${t.shape().contentToString()} dtype=${t.dataType()}")
        }
        Log.d(TAG, "=== OUTPUT TENSORS ===")
        for (i in 0 until interp.outputTensorCount) {
            val t = interp.getOutputTensor(i)
            Log.d(TAG, "  Output[$i] shape=${t.shape().contentToString()} dtype=${t.dataType()}")
        }
    }

    // ─── Main Detect ──────────────────────────────────────────────────────────

    fun detect(imagePath: String): List<DetectionResult> {
        val interp = interpreter ?: return emptyList()

        return try {
            val bitmap    = decodeBitmap(imagePath) ?: return emptyList()
            val processed = preprocessBitmap(bitmap, inputSize)

            val startTime = SystemClock.uptimeMillis()

            val results = when (modelFormat) {
                ModelFormat.SSD             -> runSsdInference(interp, processed)
                ModelFormat.YOLO_STANDARD   -> runYoloInference(interp, processed, transposed = false)
                ModelFormat.YOLO_TRANSPOSED -> runYoloInference(interp, processed, transposed = true)
            }

            lastInferenceTime = SystemClock.uptimeMillis() - startTime
            Log.d(TAG, "Inference: ${lastInferenceTime}ms | Format: $modelFormat | Detections: ${results.size}")

            bitmap.recycle()
            processed.recycle()

            results
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}", e)
            emptyList()
        }
    }

    // ─── SSD Inference ────────────────────────────────────────────────────────
    //
    //  Output: [1, numCandidates, 6]
    //  Each row: [ymin, xmin, ymax, xmax, class_id, score]
    //
    //  ⚠️  Your "YOLOv26" tflite has this exact shape — [1, 300, 6].
    //      It is an SSD-style model, not YOLO. Parsing it as YOLO produces
    //      garbage boxes and wrong labels (class=1 → "bicycle" from COCO list).
    //
    //  ⚠️  SSD class IDs are typically 1-based (0 = background), so we subtract 1
    //      to align with our 0-based COCO label list.

private fun runSsdInference(interp: Interpreter, bitmap: Bitmap): List<DetectionResult> {
    val inputBuffer   = bitmapToByteBuffer(bitmap, inputSize, isQuantized = false)
    val outputShape   = interp.getOutputTensor(0).shape()
    val numCandidates = outputShape[1]

    val outputData = Array(1) { Array(numCandidates) { FloatArray(6) } }
    interp.run(inputBuffer, outputData)

    val detections = mutableListOf<DetectionResult>()

for (i in 0 until numCandidates) {
    val row = outputData[0][i]

    // ✅ YOLO26 e2e layout: [xmin, ymin, xmax, ymax, score_logit, class_id]
    // Coordinates are normalized 0-1 (NOT pixel space — our previous assumption was wrong)
    // Scores are raw logits — must apply sigmoid before comparing to threshold
    // This is confirmed by logcat: scores like 2,8,13,56 are logits not probabilities

    val xmin    = row[0].coerceIn(0f, 1f)
    val ymin    = row[1].coerceIn(0f, 1f)
    val xmax    = row[2].coerceIn(0f, 1f)
    val ymax    = row[3].coerceIn(0f, 1f)
    val score   = sigmoid(row[4])          // ✅ sigmoid converts logit → probability
    val classId = row[5].toInt()           // ✅ 0-based, no adjustment needed

    if (score < threshold) continue        // now threshold=0.5 means sigmoid(x)>0.5 → x>0
                                           // effectively filters anything with logit ≤ 0

    val boxW = xmax - xmin
    val boxH = ymax - ymin
    if (boxW <= 0f || boxH <= 0f) continue

    val label = if (classId < labels.size) labels[classId] else "unknown"

    Log.d(TAG, "YOLO26[$i]: $label score=${"%.3f".format(score)} " +
               "logit=${"%.1f".format(row[4])} " +
               "box=[${xmin.fmt()},${ymin.fmt()},${xmax.fmt()},${ymax.fmt()}]")

    detections.add(DetectionResult(
        label      = label,
        confidence = score,
        left       = xmin,
        top        = ymin,
        right      = xmax,
        bottom     = ymax,
        width      = boxW,
        height     = boxH
    ))
}

// YOLO26 NMS is done internally — just sort and cap
return detections
    .sortedByDescending { it.confidence }
    .take(maxDetections)
}

    // ─── YOLO Inference ───────────────────────────────────────────────────────

    private fun runYoloInference(
        interp: Interpreter,
        bitmap: Bitmap,
        transposed: Boolean
    ): List<DetectionResult> {
        val inputBuffer = bitmapToByteBuffer(bitmap, inputSize, isQuantized = false)
        val outputShape = interp.getOutputTensor(0).shape()
        val numAnchors  = if (transposed) outputShape[1] else outputShape[2]
        val numFields   = if (transposed) outputShape[2] else outputShape[1]
        val detections  = mutableListOf<DetectionResult>()

        if (transposed) {
            val outputData = Array(1) { Array(numAnchors) { FloatArray(numFields) } }
            interp.run(inputBuffer, outputData)
            for (i in 0 until numAnchors) {
                var bestScore = 0f; var bestClass = 0
                for (c in 4 until numFields) {
                    val score = sigmoid(outputData[0][i][c])
                    if (score > bestScore) { bestScore = score; bestClass = c - 4 }
                }
                if (bestScore < threshold) continue
                buildDetection(outputData[0][i][0], outputData[0][i][1],
                               outputData[0][i][2], outputData[0][i][3],
                               bestScore, bestClass, i)?.let { detections.add(it) }
            }
        } else {
            val outputData = Array(1) { Array(numFields) { FloatArray(numAnchors) } }
            interp.run(inputBuffer, outputData)
            for (i in 0 until numAnchors) {
                var bestScore = 0f; var bestClass = 0
                for (c in 4 until numFields) {
                    val score = outputData[0][c][i]
                    if (score > bestScore) { bestScore = score; bestClass = c - 4 }
                }
                if (bestScore < threshold) continue
                buildDetection(outputData[0][0][i], outputData[0][1][i],
                               outputData[0][2][i], outputData[0][3][i],
                               bestScore, bestClass, i)?.let { detections.add(it) }
            }
        }

        return nonMaxSuppression(
            detections.sortedByDescending { it.confidence },
            iouThreshold  = 0.45f,
            maxDetections = maxDetections
        )
    }

    private fun buildDetection(
        cx: Float, cy: Float, w: Float, h: Float,
        bestScore: Float, bestClass: Int, anchor: Int
    ): DetectionResult? {
        val ncx  = if (cx > 1.0f) cx / inputSize else cx
        val ncy  = if (cy > 1.0f) cy / inputSize else cy
        val nw   = if (w  > 1.0f) w  / inputSize else w
        val nh   = if (h  > 1.0f) h  / inputSize else h
        val xmin = (ncx - nw / 2).coerceIn(0f, 1f)
        val ymin = (ncy - nh / 2).coerceIn(0f, 1f)
        val xmax = (ncx + nw / 2).coerceIn(0f, 1f)
        val ymax = (ncy + nh / 2).coerceIn(0f, 1f)
        val boxW = xmax - xmin
        val boxH = ymax - ymin
        if (boxW <= 0f || boxH <= 0f) return null
        val label = if (bestClass < labels.size) labels[bestClass] else "unknown"
        Log.d(TAG, "YOLO[$anchor]: $label score=${"%.3f".format(bestScore)} " +
                   "cx=${ncx.fmt()} cy=${ncy.fmt()} w=${nw.fmt()} h=${nh.fmt()}")
        return DetectionResult(label, bestScore, xmin, ymin, xmax, ymax, boxW, boxH)
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun sigmoid(x: Float): Float = 1f / (1f + Math.exp(-x.toDouble()).toFloat())
    private fun Float.fmt() = "%.3f".format(this)

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
                if (!suppressed[j] && iou(detections[i], detections[j]) > iouThreshold)
                    suppressed[j] = true
            }
        }
        return selected
    }

    private fun iou(a: DetectionResult, b: DetectionResult): Float {
        val iW = maxOf(0f, minOf(a.right, b.right)   - maxOf(a.left, b.left))
        val iH = maxOf(0f, minOf(a.bottom, b.bottom) - maxOf(a.top, b.top))
        val iArea = iW * iH
        val uArea = a.width * a.height + b.width * b.height - iArea
        return if (uArea <= 0f) 0f else iArea / uArea
    }

    private fun decodeBitmap(imagePath: String): Bitmap? {
        return try {
            BitmapFactory.decodeFile(imagePath.removePrefix("file://"))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode bitmap: ${e.message}")
            null
        }
    }

    private fun preprocessBitmap(bitmap: Bitmap, size: Int): Bitmap {
        val matrix = Matrix()
        val scale  = size.toFloat() / maxOf(bitmap.width, bitmap.height)
        matrix.postScale(scale, scale)
        val scaled = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        val result = Bitmap.createScaledBitmap(scaled, size, size, true)
        if (scaled != result) scaled.recycle()
        return result
    }

    private fun bitmapToByteBuffer(bitmap: Bitmap, inputSize: Int, isQuantized: Boolean): ByteBuffer {
        val bytesPerChannel = if (isQuantized) 1 else 4
        val buffer = ByteBuffer.allocateDirect(1 * inputSize * inputSize * 3 * bytesPerChannel)
        buffer.order(ByteOrder.nativeOrder())
        buffer.rewind()
        val pixels = IntArray(inputSize * inputSize)
        bitmap.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize)
        for (pixel in pixels) {
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8)  and 0xFF
            val b =  pixel         and 0xFF
            if (isQuantized) {
                buffer.put(r.toByte()); buffer.put(g.toByte()); buffer.put(b.toByte())
            } else {
                buffer.putFloat(r / 255.0f)
                buffer.putFloat(g / 255.0f)
                buffer.putFloat(b / 255.0f)
            }
        }
        buffer.rewind()
        return buffer
    }

    @Throws(IOException::class)
    private fun loadModelFile(assetPath: String): MappedByteBuffer {
        val afd    = context.assets.openFd(assetPath)
        val stream = FileInputStream(afd.fileDescriptor)
        return stream.channel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
    }

    fun getLastInferenceTime(): Long = lastInferenceTime
    fun isInitialized(): Boolean     = interpreter != null

    fun close() {
        interpreter?.close()
        interpreter = null
        Log.d(TAG, "ObjectDetector closed")
    }
}