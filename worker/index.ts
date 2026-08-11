/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const whisperModelPrefix = "/hf-models/onnx-community/whisper-tiny_timestamped/";
    if (url.pathname.startsWith(whisperModelPrefix)) {
      const modelPath = url.pathname.slice(whisperModelPrefix.length);
      if (!modelPath || modelPath.includes("..")) {
        return new Response("Invalid model path", { status: 400 });
      }

      const upstreamUrl = new URL(
        `https://huggingface.co/onnx-community/whisper-tiny_timestamped/${modelPath}`,
      );
      upstreamUrl.search = url.search;
      const upstreamHeaders = new Headers();
      for (const header of ["accept", "if-none-match", "range"]) {
        const value = request.headers.get(header);
        if (value) upstreamHeaders.set(header, value);
      }

      const upstream = await fetch(upstreamUrl, {
        headers: upstreamHeaders,
        redirect: "follow",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("set-cookie");
      responseHeaders.set("Access-Control-Allow-Origin", url.origin);
      responseHeaders.set("Vary", "Origin");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
