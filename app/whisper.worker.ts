import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type TranscriptionOutput = {
  text: string;
  chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
};
type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<TranscriptionOutput | TranscriptionOutput[]>;
let transcriber: Transcriber | null = null;

type WorkerRequest = {
  type: "transcribe";
  videoId: string;
  audio: Float32Array;
};

function send(type: string, videoId: string, payload: Record<string, unknown> = {}) {
  self.postMessage({ type, videoId, ...payload });
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "transcribe") return;
  const { videoId } = event.data;

  try {
    if (!transcriber) {
      const hasWebGpu = "gpu" in navigator;
      send("status", videoId, {
        message: hasWebGpu ? "Downloading Whisper and preparing the GPU…" : "Downloading Whisper and preparing the browser…",
        progress: 4,
      });
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny",
        {
          device: hasWebGpu ? "webgpu" : "wasm",
          dtype: "q8",
          progress_callback: (item: { status?: string; progress?: number }) => {
            if (item.status === "progress" && typeof item.progress === "number") {
              send("status", videoId, {
                message: "Downloading the Whisper model…",
                progress: Math.max(5, Math.min(72, Math.round(item.progress * 0.72))),
              });
            }
          },
        },
      ) as unknown as Transcriber;
    }

    send("status", videoId, { message: "Listening and syncing every word…", progress: 78 });
    const result = await transcriber(event.data.audio, {
      task: "transcribe",
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const output = Array.isArray(result) ? result[0] : result;
    const rawChunks = "chunks" in output && Array.isArray(output.chunks) ? output.chunks : [];
    const words = rawChunks
      .map((chunk: { text?: string; timestamp?: [number | null, number | null] }) => ({
        word: (chunk.text || "").trim(),
        start: Number(chunk.timestamp?.[0] ?? 0),
        end: Number(chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0),
      }))
      .filter((word: { word: string; start: number; end: number }) => word.word && Number.isFinite(word.start));

    if (!words.length) throw new Error("Whisper could not detect speech in this video");
    send("result", videoId, { text: output.text.trim(), words, progress: 100 });
  } catch (error) {
    send("error", videoId, {
      message: error instanceof Error ? error.message : "Transcription failed",
    });
  }
});
