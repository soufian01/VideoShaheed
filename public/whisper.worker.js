import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
// Keep model downloads same-origin. The Cloudflare Worker forwards this fixed
// model path so browsers are not blocked by Hugging Face CORS responses.
env.remoteHost = `${self.location.origin}/hf-models/`;

let transcriber = null;
let activeDevice = null;
let webGpuDisabled = false;

if (env.backends?.onnx?.wasm) {
  // Browsers without cross-origin isolation cannot use threaded WASM. When it
  // is available, a small thread pool is faster without starving the UI.
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
}

function send(type, videoId, payload = {}) {
  self.postMessage({ type, videoId, ...payload });
}

async function disposeTranscriber() {
  const current = transcriber;
  transcriber = null;
  activeDevice = null;
  try {
    await current?.dispose?.();
  } catch {
    // A lost GPU device may also reject cleanup. The WASM retry can continue.
  }
}

async function createTranscriber(videoId, device) {
  send("status", videoId, {
    message: device === "webgpu"
      ? "Downloading Whisper and preparing the GPU…"
      : "Preparing the stable CPU transcription engine…",
    progress: device === "webgpu" ? 4 : 12,
  });

  const instance = await pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-tiny_timestamped",
    {
      device,
      dtype: "q8",
      progress_callback: (item) => {
        if (item.status === "progress" && typeof item.progress === "number") {
          send("status", videoId, {
            message: device === "webgpu"
              ? "Downloading the Whisper model…"
              : "Loading the stable transcription engine…",
            progress: Math.max(5, Math.min(72, Math.round(item.progress * 0.72))),
          });
        }
      },
    },
  );
  activeDevice = device;
  transcriber = instance;
  return instance;
}

async function getTranscriber(videoId) {
  if (transcriber) return transcriber;
  const canTryWebGpu = !webGpuDisabled && "gpu" in navigator;
  if (canTryWebGpu) {
    try {
      return await createTranscriber(videoId, "webgpu");
    } catch {
      webGpuDisabled = true;
      await disposeTranscriber();
      send("status", videoId, {
        message: "GPU unavailable. Switching automatically to the stable engine…",
        progress: 10,
      });
    }
  }
  return createTranscriber(videoId, "wasm");
}

async function runTranscription(instance, audio) {
  return instance(audio, {
    task: "transcribe",
    return_timestamps: "word",
    chunk_length_s: 29,
    stride_length_s: 5,
  });
}

self.addEventListener("message", async (event) => {
  if (event.data.type !== "transcribe") return;
  const { videoId } = event.data;

  try {
    let instance = await getTranscriber(videoId);

    send("status", videoId, {
      message: activeDevice === "webgpu"
        ? "Listening and syncing every word with GPU acceleration…"
        : "Listening and syncing every word with the stable engine…",
      progress: 78,
    });
    let result;
    try {
      result = await runTranscription(instance, event.data.audio);
    } catch (error) {
      if (activeDevice !== "webgpu") throw error;
      webGpuDisabled = true;
      send("status", videoId, {
        message: "The GPU stopped responding. Retrying automatically in stable mode…",
        progress: 12,
      });
      await disposeTranscriber();
      instance = await createTranscriber(videoId, "wasm");
      send("status", videoId, {
        message: "GPU fallback ready. Resuming transcription…",
        progress: 78,
      });
      result = await runTranscription(instance, event.data.audio);
    }

    const output = Array.isArray(result) ? result[0] : result;
    const rawChunks = Array.isArray(output.chunks) ? output.chunks : [];
    const words = rawChunks
      .map((chunk) => ({
        word: (chunk.text || "").trim(),
        start: Number(chunk.timestamp?.[0] ?? 0),
        end: Number(chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0),
      }))
      .filter((word) => word.word && Number.isFinite(word.start));

    if (!words.length) {
      throw new Error("Whisper could not detect speech in this video");
    }
    send("result", videoId, {
      text: output.text.trim(),
      words,
      progress: 100,
    });
  } catch (error) {
    send("error", videoId, {
      message: error instanceof Error ? error.message : "Transcription failed",
    });
  }
});
