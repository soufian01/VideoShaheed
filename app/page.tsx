"use client";

import { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

type WordCue = { word: string; start: number; end: number };
type Position = "top" | "middle" | "bottom" | "custom";
type StylePreset = "impact" | "minimal" | "boxed";
type ActiveStyle = "color" | "background";
type FontChoice = "impact" | "arial-black" | "arial" | "georgia" | "courier";
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
const FONT_OPTIONS: Array<{ value: FontChoice; label: string; family: string }> = [
  { value: "impact", label: "Impact", family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
  { value: "arial-black", label: "Arial Black", family: "'Arial Black', Arial, sans-serif" },
  { value: "arial", label: "Clean Sans", family: "Arial, Helvetica, sans-serif" },
  { value: "georgia", label: "Elegant Serif", family: "Georgia, 'Times New Roman', serif" },
  { value: "courier", label: "Typewriter", family: "'Courier New', Courier, monospace" },
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

function chunkForIndex(cues: WordCue[], activeIndex: number) {
  if (!cues.length) return { words: [] as WordCue[], offset: 0 };
  const offset = Math.floor(Math.max(0, activeIndex) / 5) * 5;
  return { words: cues.slice(offset, offset + 5), offset };
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
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [activeColor, setActiveColor] = useState("#D9FF43");
  const [activeStyle, setActiveStyle] = useState<ActiveStyle>("color");
  const [uppercase, setUppercase] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  const activeIndex = useMemo(
    () => Math.max(0, cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end)),
    [cues, currentTime],
  );
  const visibleChunk = useMemo(() => chunkForIndex(cues, activeIndex), [cues, activeIndex]);
  const anyVideoProcessing = videos.some((video) => video.status === "processing");
  const selectedFont = FONT_OPTIONS.find((font) => font.value === fontChoice) ?? FONT_OPTIONS[0];

  useEffect(() => { videosRef.current = videos; }, [videos]);

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
      const index = Math.max(0, cues.findIndex((cue) => time >= cue.start && time < cue.end));
      const chunk = chunkForIndex(cues, index);
      if (!chunk.words.length) return;
      const size = fontSize * 1.62;
      const rendered = chunk.words.map((cue) => (uppercase ? cue.word.toUpperCase() : cue.word));
      context.font = `900 ${size}px ${selectedFont.family}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const gap = 17;
      const widths = rendered.map((word) => context.measureText(word).width);
      const total = widths.reduce((sum, item) => sum + item, 0) + gap * (rendered.length - 1);
      const centerX = canvas.width * captionX / 100;
      const centerY = canvas.height * captionY / 100;
      if (preset === "boxed") {
        context.fillStyle = "rgba(5,6,8,.82)";
        context.beginPath();
        context.roundRect(centerX - total / 2 - 22, centerY - size * .78, total + 44, size * 1.5, 18);
        context.fill();
      }
      let cursor = centerX - total / 2;
      rendered.forEach((word, wordIndex) => {
        const globalIndex = chunk.offset + wordIndex;
        const wordCenter = cursor + widths[wordIndex] / 2;
        if (globalIndex === index && activeStyle === "background") {
          context.fillStyle = activeColor;
          context.beginPath();
          context.roundRect(wordCenter - widths[wordIndex] / 2 - 10, centerY - size * .67, widths[wordIndex] + 20, size * 1.25, 12);
          context.fill();
        }
        if (preset === "impact") {
          context.lineWidth = 11;
          context.strokeStyle = "rgba(0,0,0,.88)";
          context.strokeText(word, wordCenter, centerY);
        }
        context.fillStyle = globalIndex === index ? (activeStyle === "background" ? "#111315" : activeColor) : textColor;
        context.fillText(word, wordCenter, centerY);
        cursor += widths[wordIndex] + gap;
      });
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
            {transcriptionStatus === "ready" && <><span className="transcription-done">✓</span><strong>Transcription complete</strong><p className="transcript-preview">{transcript}</p><small>{cues.length} words · word-level timestamps</small></>}
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
                style={{ left: `${captionX}%`, top: `${captionY}%`, width: `${captionWidth}%`, fontSize, fontFamily: selectedFont.family, color: textColor }}
                onPointerDown={(event) => beginCaptionInteraction(event, "move")}
                onPointerMove={moveCaption}
                onPointerUp={endCaptionInteraction}
                onPointerCancel={endCaptionInteraction}
                onKeyDown={moveCaptionWithKeyboard}
                role="group"
                tabIndex={0}
                aria-label="Caption box. Drag to move or use the arrow keys."
              >
                {visibleChunk.words.map((cue, index) => {
                  const globalIndex = visibleChunk.offset + index;
                  return <span key={`${cue.start}-${cue.word}`} className={globalIndex === activeIndex ? "active-word" : ""} style={globalIndex === activeIndex ? (activeStyle === "background" ? { backgroundColor: activeColor, color: "#111315" } : { color: activeColor }) : undefined}>{uppercase ? cue.word.toUpperCase() : cue.word}</span>;
                })}
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
          <div className="panel-heading"><div><span className="eyebrow">STEP 3</span><h2>Customize</h2></div><button className="reset-button" onClick={() => { setPreset("impact"); setCaptionPosition("bottom"); setCaptionWidth(86); setFontSize(34); setFontChoice("impact"); setTextColor("#FFFFFF"); setActiveColor("#D9FF43"); setActiveStyle("color"); setUppercase(false); }}>Reset</button></div>
          <div className="control-group"><label>Caption style</label><div className="preset-grid">{(["impact", "minimal", "boxed"] as StylePreset[]).map((item) => <button key={item} className={`preset-card ${preset === item ? "selected" : ""}`} onClick={() => setPreset(item)}><span className={`preset-preview preview-${item}`}>Aa</span><span>{item === "impact" ? "Impact" : item === "minimal" ? "Clean" : "Full box"}</span></button>)}</div></div>
          <div className="control-group"><label>Active word</label><div className="highlight-options"><button className={activeStyle === "color" ? "selected" : ""} onClick={() => setActiveStyle("color")}><span className="highlight-color-preview">WORD</span><small>Text color</small></button><button className={activeStyle === "background" ? "selected" : ""} onClick={() => setActiveStyle("background")}><span className="highlight-box-preview">WORD</span><small>Rounded box</small></button></div></div>
          <div className="control-group"><label>Quick position</label><div className="segmented">{(["top", "middle", "bottom"] as const).map((item) => <button key={item} className={position === item ? "selected" : ""} onClick={() => setCaptionPosition(item)}><span className={`position-icon position-${item}`}><i /></span>{item === "top" ? "Top" : item === "middle" ? "Center" : "Bottom"}</button>)}</div></div>
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
          <div className="control-group color-group"><label>Colors</label><div className="color-row"><span>Text</span><label className="color-control"><i style={{ background: textColor }} /><span>{textColor}</span><input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value.toUpperCase())} aria-label="Text color" /></label></div><div className="color-row"><span>Active word</span><label className="color-control"><i style={{ background: activeColor }} /><span>{activeColor}</span><input type="color" value={activeColor} onChange={(event) => setActiveColor(event.target.value.toUpperCase())} aria-label="Active word color" /></label></div></div>
          <div className="control-group toggle-row"><div><label>Uppercase</label><span>Add more impact in the feed</span></div><button className={`toggle ${uppercase ? "on" : ""}`} onClick={() => setUppercase((value) => !value)} aria-pressed={uppercase} aria-label="Toggle uppercase"><i /></button></div>
          <div className="tip-card"><span>✦</span><p><strong>Direct editing</strong>Drag the caption layer inside the preview to place it exactly where you want.</p></div>
        </aside>
      </section>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
