"use client";

import { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

type WordCue = { word: string; start: number; end: number };
type Position = "top" | "middle" | "bottom" | "custom";
type StylePreset = "impact" | "minimal" | "boxed";
type ActiveStyle = "color" | "background" | "underline" | "outline" | "scale";
type FontChoice = "impact" | "arial-black" | "arial" | "arial-narrow" | "verdana" | "trebuchet" | "georgia" | "times" | "courier" | "comic";
type EntryAnimation = "none" | "fade" | "pop" | "slide-up";
type ExitAnimation = "none" | "fade" | "shrink" | "slide-down";
type TranscriptionStatus = "idle" | "processing" | "ready" | "error";
type VideoProject = {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  cues: WordCue[];
  transcript: string;
  status: TranscriptionStatus;
  progress: number;
  message: string;
  error: string;
};

const SAMPLE_TEXT = "Make every word impossible to miss.";
// React paints shortly after requestVideoFrameCallback fires. Looking ahead by
// roughly three frames keeps the highlighted word aligned with what is heard.
const PREVIEW_RENDER_LEAD_SECONDS = 0.055;
const FONT_OPTIONS: Array<{ value: FontChoice; label: string; family: string }> = [
  { value: "impact", label: "Impact", family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
  { value: "arial-black", label: "Arial Black", family: "'Arial Black', Arial, sans-serif" },
  { value: "arial", label: "Clean Sans", family: "Arial, Helvetica, sans-serif" },
  { value: "arial-narrow", label: "Condensed", family: "'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif" },
  { value: "verdana", label: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { value: "trebuchet", label: "Trebuchet", family: "'Trebuchet MS', Arial, sans-serif" },
  { value: "georgia", label: "Elegant Serif", family: "Georgia, 'Times New Roman', serif" },
  { value: "times", label: "Classic Serif", family: "'Times New Roman', Times, serif" },
  { value: "courier", label: "Typewriter", family: "'Courier New', Courier, monospace" },
  { value: "comic", label: "Playful", family: "'Comic Sans MS', 'Comic Sans', cursive" },
];
const ACTIVE_STYLE_OPTIONS: Array<{ value: ActiveStyle; label: string; previewClass: string }> = [
  { value: "color", label: "Text color", previewClass: "highlight-color-preview" },
  { value: "background", label: "Rounded box", previewClass: "highlight-box-preview" },
  { value: "underline", label: "Underline", previewClass: "highlight-underline-preview" },
  { value: "outline", label: "Outline", previewClass: "highlight-outline-preview" },
  { value: "scale", label: "Pop", previewClass: "highlight-scale-preview" },
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function createCues(text: string, duration: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordDuration = duration / Math.max(words.length, 1);
  return words.map((word, index) => ({ word, start: index * wordDuration, end: (index + 1) * wordDuration }));
}

function chunkForIndex(cues: WordCue[], activeIndex: number, wordsPerFrame: number) {
  if (!cues.length) return { words: [] as WordCue[], offset: 0 };
  const count = clamp(Math.round(wordsPerFrame), 1, 10);
  const offset = Math.floor(Math.max(0, activeIndex) / count) * count;
  return { words: cues.slice(offset, offset + count), offset };
}

function formatCaptionWord(word: string, uppercase: boolean, showPunctuation: boolean) {
  const formatted = showPunctuation ? word : word.replace(/[.,!?;:…،؛؟。！？]+/gu, "");
  return uppercase ? formatted.toUpperCase() : formatted;
}

function cueIndexAtTime(cues: WordCue[], time: number) {
  if (!cues.length || time < cues[0].start) return -1;
  let index = cues.length - 1;
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    if (cues[cueIndex].start > time) {
      index = cueIndex - 1;
      break;
    }
  }
  const cue = cues[index];
  const nextStart = cues[index + 1]?.start ?? Number.POSITIVE_INFINITY;
  const detectedEnd = cue.end > cue.start ? cue.end : cue.start + 0.4;
  const visibleEnd = Math.min(nextStart, detectedEnd + 0.06);
  return time <= visibleEnd ? index : -1;
}

function displayCueIndexAtTime(cues: WordCue[], time: number, activeIndex: number) {
  if (!cues.length) return -1;
  if (activeIndex >= 0) return activeIndex;
  const nextIndex = cues.findIndex((cue) => cue.start > time);
  return nextIndex === -1 ? cues.length - 1 : nextIndex;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function Home() {
  const [videos, setVideos] = useState<VideoProject[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<Position>("bottom");
  const [captionX, setCaptionX] = useState(50);
  const [captionY, setCaptionY] = useState(78);
  const [captionWidth, setCaptionWidth] = useState(86);
  const [preset, setPreset] = useState<StylePreset>("impact");
  const [fontSize, setFontSize] = useState(34);
  const [fontChoice, setFontChoice] = useState<FontChoice>("impact");
  const [timingOffset, setTimingOffset] = useState(0);
  const [wordsPerFrame, setWordsPerFrame] = useState(5);
  const [showPunctuation, setShowPunctuation] = useState(true);
  const [entryAnimation, setEntryAnimation] = useState<EntryAnimation>("pop");
  const [exitAnimation, setExitAnimation] = useState<ExitAnimation>("fade");
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [activeColor, setActiveColor] = useState("#D9FF43");
  const [activeStyle, setActiveStyle] = useState<ActiveStyle>("color");
  const [uppercase, setUppercase] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const phoneScreenRef = useRef<HTMLDivElement>(null);
  const whisperWorkerRef = useRef<Worker | null>(null);
  const videosRef = useRef<VideoProject[]>([]);
  const dragStateRef = useRef<null | {
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startFontSize: number;
    frameWidth: number;
    frameHeight: number;
  }>(null);

  const activeVideo = useMemo(
    () => videos.find((video) => video.id === activeVideoId) ?? null,
    [videos, activeVideoId],
  );
  const videoUrl = activeVideo?.url ?? null;
  const duration = activeVideo?.duration || 18;
  const cues = activeVideo ? activeVideo.cues : createCues(SAMPLE_TEXT, 18);
  const transcript = activeVideo?.transcript ?? "";
  const transcriptionStatus = activeVideo?.status ?? "idle";
  const transcriptionProgress = activeVideo?.progress ?? 0;
  const transcriptionMessage = activeVideo?.message ?? "";
  const transcriptionError = activeVideo?.error ?? "";
  const captionTime = Math.max(0, currentTime + PREVIEW_RENDER_LEAD_SECONDS - timingOffset);
  const activeIndex = useMemo(() => cueIndexAtTime(cues, captionTime), [cues, captionTime]);
  const displayIndex = useMemo(() => displayCueIndexAtTime(cues, captionTime, activeIndex), [cues, captionTime, activeIndex]);
  const visibleChunk = useMemo(() => chunkForIndex(cues, displayIndex, wordsPerFrame), [cues, displayIndex, wordsPerFrame]);
  const lastVisibleCue = visibleChunk.words[visibleChunk.words.length - 1];
  const visibleCueEnd = lastVisibleCue
    ? (lastVisibleCue.end > lastVisibleCue.start ? lastVisibleCue.end : lastVisibleCue.start + 0.4)
    : 0;
  const isChunkExiting = activeIndex >= 0 && captionTime >= visibleCueEnd - 0.18;
  const anyVideoProcessing = videos.some((video) => video.status === "processing");
  const selectedFont = FONT_OPTIONS.find((font) => font.value === fontChoice) ?? FONT_OPTIONS[0];

  useEffect(() => { videosRef.current = videos; }, [videos]);

  useEffect(() => {
    setTranscriptDraft(transcript);
    setIsEditingTranscript(false);
  }, [activeVideoId, transcript]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;
    let cancelled = false;
    let animationFrame = 0;
    let videoFrame = 0;

    const syncWithAnimationFrame = () => {
      if (cancelled) return;
      setCurrentTime(video.currentTime);
      animationFrame = window.requestAnimationFrame(syncWithAnimationFrame);
    };

    if ("requestVideoFrameCallback" in video) {
      const syncWithVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (cancelled) return;
        setCurrentTime(metadata.mediaTime);
        videoFrame = video.requestVideoFrameCallback(syncWithVideoFrame);
      };
      videoFrame = video.requestVideoFrameCallback(syncWithVideoFrame);
    } else {
      animationFrame = window.requestAnimationFrame(syncWithAnimationFrame);
    }

    return () => {
      cancelled = true;
      if (videoFrame) video.cancelVideoFrameCallback(videoFrame);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [isPlaying, activeVideoId]);

  useEffect(() => {
    const worker = new Worker("/whisper.worker.js", { type: "module" });
    whisperWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{
      type: "status" | "result" | "error";
      videoId: string;
      message?: string;
      progress?: number;
      text?: string;
      words?: WordCue[];
    }>) => {
      const data = event.data;
      if (data.type === "status") {
        updateVideo(data.videoId, { message: data.message || "Whisper is working…", progress: data.progress || 0 });
      } else if (data.type === "result" && data.words?.length) {
        updateVideo(data.videoId, {
          transcript: data.text || data.words.map((item) => item.word).join(" "),
          cues: data.words,
          progress: 100,
          status: "ready",
          message: "Transcription complete",
        });
        notify(`${data.words.length} words transcribed automatically`);
      } else if (data.type === "error") {
        updateVideo(data.videoId, { error: data.message || "Transcription failed", status: "error" });
      }
    };

    return () => worker.terminate();
  }, []);

  useEffect(() => () => videosRef.current.forEach((video) => URL.revokeObjectURL(video.url)), []);

  function updateVideo(id: string, patch: Partial<VideoProject>) {
    setVideos((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function applyTranscriptEdits() {
    if (!activeVideo) return;
    const editedWords = transcriptDraft.trim().split(/\s+/).filter(Boolean);
    if (!editedWords.length) {
      notify("The transcript cannot be empty");
      return;
    }

    const originalCues = activeVideo.cues;
    let editedCues: WordCue[];
    if (editedWords.length === originalCues.length) {
      editedCues = editedWords.map((word, index) => ({ ...originalCues[index], word }));
    } else {
      const start = originalCues[0]?.start ?? 0;
      const detectedEnd = originalCues[originalCues.length - 1]?.end;
      const end = detectedEnd && detectedEnd > start ? detectedEnd : Math.max(start + 0.4, activeVideo.duration);
      const wordDuration = (end - start) / editedWords.length;
      editedCues = editedWords.map((word, index) => ({
        word,
        start: start + index * wordDuration,
        end: start + (index + 1) * wordDuration,
      }));
    }

    updateVideo(activeVideo.id, { transcript: editedWords.join(" "), cues: editedCues });
    setIsEditingTranscript(false);
    notify(editedWords.length === originalCues.length
      ? "Transcript updated with the original timing"
      : "Transcript updated and timing redistributed");
  }

  async function transcribeVideo(project: VideoProject) {
    updateVideo(project.id, {
      status: "processing",
      error: "",
      message: "Extracting audio from the video…",
      progress: 2,
      transcript: "",
      cues: [],
    });
    try {
      const arrayBuffer = await project.file.arrayBuffer();
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("This browser cannot decode the audio track");
      const audioContext = new AudioContextClass();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const targetRate = 16_000;
      const offlineContext = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
      const source = offlineContext.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineContext.destination);
      source.start(0);
      const rendered = await offlineContext.startRendering();
      const samples = rendered.getChannelData(0).slice();
      await audioContext.close();
      if (!whisperWorkerRef.current) throw new Error("Whisper is not ready yet");
      updateVideo(project.id, { message: "Preparing Whisper in your browser…" });
      whisperWorkerRef.current.postMessage({ type: "transcribe", videoId: project.id, audio: samples }, [samples.buffer]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      updateVideo(project.id, { error: message, status: "error" });
      notify("I could not read the audio track");
    }
  }

  function loadFiles(fileList?: FileList | File[]) {
    const validFiles = Array.from(fileList || []).filter((file) => file.type.startsWith("video/"));
    if (!validFiles.length) {
      notify("Choose one or more valid video files");
      return;
    }
    const additions: VideoProject[] = validFiles.map((file) => ({
      id: `${Date.now()}-${crypto.randomUUID()}`,
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      duration: 18,
      cues: [],
      transcript: "",
      status: "idle",
      progress: 0,
      message: "Ready to transcribe",
      error: "",
    }));
    setVideos((items) => [...items, ...additions]);
    setActiveVideoId(additions[0].id);
    setCurrentTime(0);
    setIsPlaying(false);
    if (anyVideoProcessing) notify("Videos added. Select them after the current transcription finishes.");
    else void transcribeVideo(additions[0]);
    notify(`${additions.length} video${additions.length > 1 ? "s" : ""} added`);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    loadFiles(event.dataTransfer.files);
  }

  function selectVideo(project: VideoProject) {
    if (project.id === activeVideoId) {
      if (project.status === "idle" && !anyVideoProcessing) void transcribeVideo(project);
      return;
    }
    videoRef.current?.pause();
    setActiveVideoId(project.id);
    setCurrentTime(0);
    setIsPlaying(false);
    if (project.status === "idle") {
      if (anyVideoProcessing) notify("Finish the current transcription before starting another video");
      else void transcribeVideo(project);
    }
  }

  function removeVideo(id: string) {
    const target = videos.find((video) => video.id === id);
    if (!target) return;
    URL.revokeObjectURL(target.url);
    const remaining = videos.filter((video) => video.id !== id);
    setVideos(remaining);
    if (id === activeVideoId) {
      const next = remaining[0] ?? null;
      setActiveVideoId(next?.id ?? null);
      setCurrentTime(0);
      if (next?.status === "idle" && !remaining.some((video) => video.status === "processing")) void transcribeVideo(next);
    }
  }

  function togglePlayback() {
    if (!videoRef.current || !videoUrl) return;
    if (videoRef.current.paused) void videoRef.current.play();
    else videoRef.current.pause();
  }

  function seek(value: number) {
    setCurrentTime(value);
    if (videoRef.current) videoRef.current.currentTime = value;
  }

  function beginCaptionInteraction(event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize") {
    const frame = phoneScreenRef.current?.getBoundingClientRect();
    if (!frame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: captionX,
      startY: captionY,
      startWidth: captionWidth,
      startFontSize: fontSize,
      frameWidth: frame.width,
      frameHeight: frame.height,
    };
  }

  function moveCaption(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragStateRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (drag.mode === "move") {
      setCaptionX(clamp(drag.startX + (deltaX / drag.frameWidth) * 100, 10, 90));
      setCaptionY(clamp(drag.startY + (deltaY / drag.frameHeight) * 100, 14, 90));
      setPosition("custom");
    } else {
      setCaptionWidth(clamp(drag.startWidth + (deltaX / drag.frameWidth) * 160, 42, 94));
      setFontSize(clamp(Math.round(drag.startFontSize + deltaY * 0.18), 22, 52));
    }
  }

  function endCaptionInteraction() {
    dragStateRef.current = null;
  }

  function moveCaptionWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 3 : 1;
    if (event.key === "ArrowLeft") setCaptionX((value) => clamp(value - step, 10, 90));
    else if (event.key === "ArrowRight") setCaptionX((value) => clamp(value + step, 10, 90));
    else if (event.key === "ArrowUp") setCaptionY((value) => clamp(value - step, 14, 90));
    else if (event.key === "ArrowDown") setCaptionY((value) => clamp(value + step, 14, 90));
    else return;
    event.preventDefault();
    setPosition("custom");
  }

  function setCaptionPosition(next: Exclude<Position, "custom">) {
    setPosition(next);
    setCaptionX(50);
    setCaptionY(next === "top" ? 22 : next === "middle" ? 50 : 78);
  }

  async function exportVideo() {
    const video = videoRef.current;
    if (!video || !activeVideo) {
      notify("Upload a video before exporting");
      return;
    }
    if (!("MediaRecorder" in window)) {
      notify("This browser does not support video export");
      return;
    }
    setExporting(true);
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const maybeContext = canvas.getContext("2d");
    if (!maybeContext) return setExporting(false);
    const context: CanvasRenderingContext2D = maybeContext;
    const stream = canvas.captureStream(30);
    const sourceStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    sourceStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && parts.push(event.data);
    recorder.onstop = () => {
      const url = URL.createObjectURL(new Blob(parts, { type: mimeType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeVideo.name.replace(/\.[^.]+$/, "") || "reel"}-captions.webm`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExporting(false);
      notify("Export complete");
    };

    function drawCaption(time: number) {
      const adjustedTime = Math.max(0, time - timingOffset);
      const index = cueIndexAtTime(cues, adjustedTime);
      const displayIndex = displayCueIndexAtTime(cues, adjustedTime, index);
      const chunk = chunkForIndex(cues, displayIndex, wordsPerFrame);
      if (!chunk.words.length) return;
      const size = fontSize * 1.62;
      const rendered = chunk.words.map((cue) => formatCaptionWord(cue.word, uppercase, showPunctuation));
      context.font = `900 ${size}px ${selectedFont.family}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const gap = 17;
      const widths = rendered.map((word, wordIndex) => {
        const width = context.measureText(word).width;
        return chunk.offset + wordIndex === index && activeStyle === "scale" ? width * 1.15 : width;
      });
      const maxLineWidth = Math.max(180, canvas.width * captionWidth / 100 - 44);
      const lines: Array<Array<{ word: string; wordIndex: number; width: number }>> = [];
      rendered.forEach((word, wordIndex) => {
        const item = { word, wordIndex, width: widths[wordIndex] };
        const line = lines[lines.length - 1];
        const occupied = line?.reduce((sum, entry) => sum + entry.width, 0) ?? 0;
        const proposed = occupied + (line?.length ? gap : 0) + item.width;
        if (!line || (line.length > 0 && proposed > maxLineWidth)) lines.push([item]);
        else line.push(item);
      });
      const centerX = canvas.width * captionX / 100;
      const centerY = canvas.height * captionY / 100;
      const lineHeight = size * 1.18;
      const lineTotals = lines.map((line) => line.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, line.length - 1));
      const firstCue = chunk.words[0];
      const lastCue = chunk.words[chunk.words.length - 1];
      const entryProgress = clamp((adjustedTime - firstCue.start) / 0.18, 0, 1);
      const lastCueEnd = lastCue.end > lastCue.start ? lastCue.end : lastCue.start + 0.4;
      const exitProgress = clamp((adjustedTime - (lastCueEnd - 0.18)) / 0.18, 0, 1);
      let groupScale = 1;
      let groupY = 0;
      let groupOpacity = 1;
      if (entryAnimation === "fade") groupOpacity *= entryProgress;
      if (entryAnimation === "pop") groupScale *= 0.82 + entryProgress * 0.18;
      if (entryAnimation === "slide-up") groupY += (1 - entryProgress) * 42;
      if (exitAnimation === "fade") groupOpacity *= 1 - exitProgress;
      if (exitAnimation === "shrink") groupScale *= 1 - exitProgress * 0.22;
      if (exitAnimation === "slide-down") groupY += exitProgress * 42;

      context.save();
      context.globalAlpha *= groupOpacity;
      context.translate(centerX, centerY + groupY);
      context.scale(groupScale, groupScale);
      context.translate(-centerX, -centerY);
      if (preset === "boxed") {
        context.fillStyle = "rgba(5,6,8,.82)";
        context.beginPath();
        const boxWidth = Math.min(maxLineWidth, Math.max(...lineTotals)) + 44;
        const boxHeight = Math.max(size * 1.5, (lines.length - 1) * lineHeight + size * 1.5);
        context.roundRect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, 18);
        context.fill();
      }
      lines.forEach((line, lineIndex) => {
        const lineY = centerY + (lineIndex - (lines.length - 1) / 2) * lineHeight;
        let cursor = centerX - lineTotals[lineIndex] / 2;
        line.forEach(({ word, wordIndex, width }) => {
          const globalIndex = chunk.offset + wordIndex;
          const isActive = globalIndex === index;
          const wordCenter = cursor + width / 2;
          if (isActive && activeStyle === "background") {
            context.fillStyle = activeColor;
            context.beginPath();
            context.roundRect(wordCenter - width / 2 - 10, lineY - size * .67, width + 20, size * 1.25, 12);
            context.fill();
          }
          if (isActive && activeStyle === "underline") {
            context.fillStyle = activeColor;
            context.beginPath();
            context.roundRect(wordCenter - width / 2, lineY + size * .52, width, Math.max(5, size * .09), 4);
            context.fill();
          }

          context.save();
          context.translate(wordCenter, lineY);
          if (isActive && activeStyle === "scale") context.scale(1.15, 1.15);
          if (preset === "impact") {
            context.lineWidth = 11;
            context.strokeStyle = "rgba(0,0,0,.88)";
            context.strokeText(word, 0, 0);
          }
          if (isActive && activeStyle === "outline") {
            context.lineWidth = 7;
            context.strokeStyle = activeColor;
            context.strokeText(word, 0, 0);
          }
          context.fillStyle = isActive && activeStyle === "color"
            ? activeColor
            : isActive && activeStyle === "background"
              ? "#111315"
              : textColor;
          context.fillText(word, 0, 0);
          context.restore();
          cursor += width + gap;
        });
      });
      context.restore();
    }

    const draw = () => {
      if (video.paused || video.ended) return;
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;
      let width = canvas.width;
      let height = canvas.height;
      let x = 0;
      let y = 0;
      if (videoRatio > canvasRatio) { width = canvas.height * videoRatio; x = (canvas.width - width) / 2; }
      else { height = canvas.width / videoRatio; y = (canvas.height - height) / 2; }
      context.fillStyle = "#07080a";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, x, y, width, height);
      drawCaption(video.currentTime);
      requestAnimationFrame(draw);
    };
    video.pause();
    video.currentTime = 0;
    recorder.start(1000);
    video.onended = () => recorder.state !== "inactive" && recorder.stop();
    await video.play();
    draw();
  }

  const captionClass = `caption caption-${preset} active-${activeStyle}`;
  const captionWordsClass = `caption-words entry-${entryAnimation} ${isChunkExiting ? `exit-${exitAnimation}` : ""}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="ReelType home">
          <span className="brand-mark">R</span><span>ReelType</span><span className="beta">BETA</span>
        </a>
        <button className="export-button" onClick={exportVideo} disabled={exporting || !activeVideo}>
          {exporting ? <span className="spinner" /> : <span aria-hidden>↗</span>}
          {exporting ? "Exporting…" : "Export video"}
        </button>
      </header>

      <section className="workspace">
        <aside className="left-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">STEP 1</span><h1>Your videos</h1></div>
            {videos.length > 0 && <button className="icon-button" onClick={() => fileInputRef.current?.click()} aria-label="Add more videos">＋</button>}
          </div>
          <input ref={fileInputRef} className="sr-only" type="file" accept="video/*" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => loadFiles(event.target.files || undefined)} />
          <div
            className={`dropzone ${isDragging ? "is-dragging" : ""} ${videos.length ? "compact" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === "Enter" && fileInputRef.current?.click()}
          >
            <span className="upload-icon">↑</span>
            <strong>Drop one or more videos here</strong>
            <span>or click to browse</span>
            {!videos.length && <small>MP4, MOV or WebM · no fixed duration limit</small>}
          </div>

          {videos.length > 0 && (
            <div className="video-list" aria-label="Uploaded videos">
              {videos.map((project, index) => (
                <div key={project.id} className={`video-item ${project.id === activeVideoId ? "selected" : ""}`}>
                  <button className="video-select" onClick={() => selectVideo(project)}>
                    <span className="video-number">{index + 1}</span>
                    <span className="video-info"><strong>{project.name}</strong><small>{project.status === "processing" ? `${project.progress}% · Transcribing` : project.status === "ready" ? `${project.cues.length} words ready` : project.status === "error" ? "Needs attention" : "Ready to start"}</small></span>
                  </button>
                  <button className="video-remove" onClick={() => removeVideo(project.id)} aria-label={`Remove ${project.name}`}>×</button>
                </div>
              ))}
            </div>
          )}

          <div className="section-title">
            <div><span className="eyebrow">STEP 2</span><h2>AI transcription</h2></div>
            <span className="language-pill">AUTO</span>
          </div>
          <div className={`transcription-card status-${transcriptionStatus}`}>
            {transcriptionStatus === "idle" && <><span className="transcription-icon">⌁</span><strong>Upload or select a video</strong><p>Whisper will extract the words and their timing automatically.</p></>}
            {transcriptionStatus === "processing" && <><span className="ai-loader"><i /><i /><i /></span><strong>{transcriptionMessage || "Whisper is transcribing…"}</strong><div className="model-progress"><i style={{ width: `${transcriptionProgress}%` }} /></div><p>{transcriptionProgress}% · You can style the captions while you wait</p></>}
            {transcriptionStatus === "ready" && !isEditingTranscript && <><span className="transcription-done">✓</span><strong>Transcription complete</strong><p className="transcript-preview">{transcript}</p><small>{cues.length} words · word-level timestamps</small><button className="edit-transcript-button" onClick={() => setIsEditingTranscript(true)}>Edit transcript</button></>}
            {transcriptionStatus === "ready" && isEditingTranscript && <div className="transcript-editor"><label htmlFor="transcript-editor">Edit transcription</label><textarea id="transcript-editor" value={transcriptDraft} onChange={(event) => setTranscriptDraft(event.target.value)} /><p>Replacing words keeps their timing. Adding or removing words redistributes timing automatically.</p><div><button onClick={() => { setTranscriptDraft(transcript); setIsEditingTranscript(false); }}>Cancel</button><button className="save-transcript-button" onClick={applyTranscriptEdits}>Apply changes</button></div></div>}
            {transcriptionStatus === "error" && <><span className="transcription-error">!</span><strong>Transcription failed</strong><p>{transcriptionError}</p><button onClick={() => activeVideo && transcribeVideo(activeVideo)} disabled={anyVideoProcessing}>Try again</button></>}
          </div>
          <p className="demo-note">Your videos stay on this device. Whisper runs inside the browser.</p>
        </aside>

        <section className="stage">
          <div className="stage-topline"><span>PREVIEW</span><span className="ratio-pill">9:16 · REEL</span></div>
          <div className="phone-frame">
            <div className="phone-screen" ref={phoneScreenRef}>
              {videoUrl ? (
                <video
                  key={activeVideoId}
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  onLoadedMetadata={(event) => updateVideo(activeVideoId || "", { duration: event.currentTarget.duration || 18 })}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : (
                <div className="demo-visual"><div className="orb orb-one" /><div className="orb orb-two" /><div className="demo-person">R</div><span className="demo-label">UPLOAD A REEL</span></div>
              )}
              <div
                className={captionClass}
                style={{ left: `${captionX}%`, top: `${captionY}%`, width: `${captionWidth}%`, fontSize, fontFamily: selectedFont.family, color: textColor, "--active-color": activeColor } as React.CSSProperties}
                onPointerDown={(event) => beginCaptionInteraction(event, "move")}
                onPointerMove={moveCaption}
                onPointerUp={endCaptionInteraction}
                onPointerCancel={endCaptionInteraction}
                onKeyDown={moveCaptionWithKeyboard}
                role="group"
                tabIndex={0}
                aria-label="Caption box. Drag to move or use the arrow keys."
              >
                <span key={visibleChunk.offset} className={captionWordsClass}>
                  {visibleChunk.words.map((cue, index) => {
                    const globalIndex = visibleChunk.offset + index;
                    return <span key={`${cue.start}-${cue.word}`} className={globalIndex === activeIndex ? "active-word" : ""}>{formatCaptionWord(cue.word, uppercase, showPunctuation)}</span>;
                  })}
                </span>
                <button className="caption-resize" onPointerDown={(event) => { event.stopPropagation(); beginCaptionInteraction(event, "resize"); }} aria-label="Drag to resize caption box">↘</button>
              </div>
              <span className="safe-zone top-safe">SAFE ZONE</span><span className="safe-zone bottom-safe" />
            </div>
          </div>
          <p className="direct-edit-hint">Drag the captions to move them · drag the corner to resize</p>
          <div className="player-controls">
            <button className="play-button" onClick={togglePlayback} disabled={!activeVideo} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? "Ⅱ" : "▶"}</button>
            <span className="timecode">{formatTime(currentTime)}</span>
            <input className="timeline" type="range" min="0" max={duration} step="0.01" value={Math.min(currentTime, duration)} onChange={(event) => seek(Number(event.target.value))} style={{ "--progress": `${(currentTime / duration) * 100}%` } as React.CSSProperties} aria-label="Video position" />
            <span className="timecode">{formatTime(duration)}</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">STEP 3</span><h2>Customize</h2></div><button className="reset-button" onClick={() => { setPreset("impact"); setCaptionPosition("bottom"); setCaptionWidth(86); setFontSize(34); setFontChoice("impact"); setTimingOffset(0); setWordsPerFrame(5); setShowPunctuation(true); setEntryAnimation("pop"); setExitAnimation("fade"); setTextColor("#FFFFFF"); setActiveColor("#D9FF43"); setActiveStyle("color"); setUppercase(false); }}>Reset</button></div>
          <div className="control-group"><label>Caption style</label><div className="preset-grid">{(["impact", "minimal", "boxed"] as StylePreset[]).map((item) => <button key={item} className={`preset-card ${preset === item ? "selected" : ""}`} onClick={() => setPreset(item)}><span className={`preset-preview preview-${item}`}>Aa</span><span>{item === "impact" ? "Impact" : item === "minimal" ? "Clean" : "Full box"}</span></button>)}</div></div>
          <div className="control-group"><label>Active word</label><div className="highlight-options">{ACTIVE_STYLE_OPTIONS.map((style) => <button key={style.value} className={activeStyle === style.value ? "selected" : ""} onClick={() => setActiveStyle(style.value)}><span className={style.previewClass}>WORD</span><small>{style.label}</small></button>)}</div></div>
          <div className="control-group animation-group"><label>Caption animation</label><div className="animation-selects"><label htmlFor="entry-animation"><span>Entrance</span><select id="entry-animation" value={entryAnimation} onChange={(event) => setEntryAnimation(event.target.value as EntryAnimation)}><option value="none">None</option><option value="fade">Fade in</option><option value="pop">Pop in</option><option value="slide-up">Slide up</option></select></label><label htmlFor="exit-animation"><span>Exit</span><select id="exit-animation" value={exitAnimation} onChange={(event) => setExitAnimation(event.target.value as ExitAnimation)}><option value="none">None</option><option value="fade">Fade out</option><option value="shrink">Shrink</option><option value="slide-down">Slide down</option></select></label></div></div>
          <div className="control-group"><label>Quick position</label><div className="segmented">{(["top", "middle", "bottom"] as const).map((item) => <button key={item} className={position === item ? "selected" : ""} onClick={() => setCaptionPosition(item)}><span className={`position-icon position-${item}`}><i /></span>{item === "top" ? "Top" : item === "middle" ? "Center" : "Bottom"}</button>)}</div></div>
          <div className="control-group words-group">
            <div className="range-label"><label htmlFor="words-per-frame">Words per frame</label><output>{wordsPerFrame}</output></div>
            <input id="words-per-frame" className="size-slider" type="range" min="1" max="10" step="1" value={wordsPerFrame} onChange={(event) => setWordsPerFrame(Number(event.target.value))} style={{ "--progress": `${((wordsPerFrame - 1) / 9) * 100}%` } as React.CSSProperties} />
            <div className="checkbox-row"><div><label htmlFor="show-punctuation">Show punctuation</label><span>Keep commas, periods and question marks</span></div><input id="show-punctuation" type="checkbox" checked={showPunctuation} onChange={(event) => setShowPunctuation(event.target.checked)} /></div>
          </div>
          <div className="control-group typography-group">
            <label htmlFor="font-family">Font</label>
            <select id="font-family" className="font-select" value={fontChoice} onChange={(event) => setFontChoice(event.target.value as FontChoice)}>
              {FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
            </select>
            <div className="range-label size-heading">
              <label htmlFor="font-size">Text size</label>
              <label className="size-number"><input aria-label="Text size in pixels" type="number" min="22" max="52" value={fontSize} onChange={(event) => setFontSize(clamp(Number(event.target.value), 22, 52))} /><span>px</span></label>
            </div>
            <input id="font-size" className="size-slider" type="range" min="22" max="52" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} style={{ "--progress": `${((fontSize - 22) / 30) * 100}%` } as React.CSSProperties} />
          </div>
          <div className="control-group timing-group">
            <div className="range-label"><label htmlFor="caption-timing">Caption timing</label><output>{timingOffset > 0 ? "+" : ""}{timingOffset.toFixed(2)}s</output></div>
            <input id="caption-timing" className="size-slider" type="range" min="-0.75" max="0.75" step="0.01" value={timingOffset} onChange={(event) => setTimingOffset(Number(event.target.value))} style={{ "--progress": `${((timingOffset + 0.75) / 1.5) * 100}%` } as React.CSSProperties} />
            <div className="timing-nudges">
              <button onClick={() => setTimingOffset((value) => clamp(Math.round((value - 0.01) * 100) / 100, -0.75, 0.75))}>Earlier −0.01s</button>
              <button onClick={() => setTimingOffset(0)}>Reset</button>
              <button onClick={() => setTimingOffset((value) => clamp(Math.round((value + 0.01) * 100) / 100, -0.75, 0.75))}>Later +0.01s</button>
            </div>
            <p>Negative shows captions earlier · positive shows them later</p>
          </div>
          <div className="control-group color-group"><label>Colors</label><div className="color-row"><span>Text</span><label className="color-control"><i style={{ background: textColor }} /><span>{textColor}</span><input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value.toUpperCase())} aria-label="Text color" /></label></div><div className="color-row"><span>Active word</span><label className="color-control"><i style={{ background: activeColor }} /><span>{activeColor}</span><input type="color" value={activeColor} onChange={(event) => setActiveColor(event.target.value.toUpperCase())} aria-label="Active word color" /></label></div></div>
          <div className="control-group toggle-row"><div><label>Uppercase</label><span>Add more impact in the feed</span></div><button className={`toggle ${uppercase ? "on" : ""}`} onClick={() => setUppercase((value) => !value)} aria-pressed={uppercase} aria-label="Toggle uppercase"><i /></button></div>
          <div className="tip-card"><span>✦</span><p><strong>Direct editing</strong>Drag the caption layer inside the preview to place it exactly where you want.</p></div>
        </aside>
      </section>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
