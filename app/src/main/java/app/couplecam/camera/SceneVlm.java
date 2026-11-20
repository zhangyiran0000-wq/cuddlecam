package app.couplecam.camera;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import java.nio.FloatBuffer;
import java.util.Collections;

/** Shared by Android and the desktop parity check. Runs the actual quantized VLM. */
final class SceneVlm implements AutoCloseable {
    static final int SIDE = 512;
    private final OrtEnvironment environment;
    private final OrtSession vision;
    private final OrtSession decoder;

    SceneVlm(String visionPath, String decoderPath) throws OrtException {
        environment = OrtEnvironment.getEnvironment();
        try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
            options.setIntraOpNumThreads(2);
            options.setInterOpNumThreads(1);
            options.setCPUArenaAllocator(false);
            options.setMemoryPatternOptimization(false);
            vision = environment.createSession(visionPath, options);
            try {
                decoder = environment.createSession(decoderPath, options);
            } catch (OrtException | RuntimeException | Error e) {
                vision.close();
                throw e;
            }
        }
    }

    float[] evaluate(int[] pixels) throws OrtException {
        int plane = SIDE * SIDE;
        if (pixels.length != plane) throw new IllegalArgumentException("image size");
        float[] rgb = new float[plane * 3];
        for (int i = 0; i < plane; i++) {
            int value = pixels[i];
            rgb[i] = ((value >>> 16) & 255) / 127.5f - 1f;
            rgb[i + plane] = ((value >>> 8) & 255) / 127.5f - 1f;
            rgb[i + 2 * plane] = (value & 255) / 127.5f - 1f;
        }
        try (OnnxTensor input = OnnxTensor.createTensor(environment, FloatBuffer.wrap(rgb), new long[]{1,1,3,SIDE,SIDE});
             OrtSession.Result encoded = vision.run(Collections.singletonMap("pixel_values", input));
             OrtSession.Result result = decoder.run(Collections.singletonMap("image_features", (OnnxTensor) encoded.get(0)))) {
            FloatBuffer logits = ((OnnxTensor) result.get(0)).getFloatBuffer();
            float[] values = new float[logits.remaining()];
            logits.get(values);
            return values;
        }
    }

    @Override public void close() throws OrtException {
        try { decoder.close(); } finally { vision.close(); }
    }
}
