"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type WordCue = { word: string; start: number; end: number };
type Position = "top" | "middle" | "bottom";
type StylePreset = "impact" | "minimal" | "boxed";

const SAMPLE_TEXT =
  "Tre secondi per catturare l’attenzione. Il segreto è dire subito qualcosa che vale la pena ascoltare.";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function createCues(text: string, duration: number) {
  const clean = text.trim().split(/\s+/).filter(Boolean);
  if (!clean.length) return [];
  const usableDuration = Math.max(duration || clean.length * 0.42, clean.length * 0.18);
  const weights = clean.map((word) => Math.max(2.4, word.replace(/[^\p{L}\p{N}]/gu, "").length * 0.72));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return clean.map((word, index) => {
    const wordDuration = (weights[index] / totalWeight) * usableDuration;
    const cue = { word, start: cursor, end: cursor + wordDuration };
    cursor += wordDuration;
    return cue;
  });
}

function chunkForIndex(cues: WordCue[], activeIndex: number) {
  if (!cues.length) return { words: [] as WordCue[], offset: 0 };
  const safeIndex = Math.max(0, activeIndex);
  const chunkSize = 5;
  const offset = Math.floor(safeIndex / chunkSize) * chunkSize;
  return { words: cues.slice(offset, offset + chunkSize), offset };
}

export default function Home() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(18);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [transcript, setTranscript] = useState(SAMPLE_TEXT);
  const [cues, setCues] = useState<WordCue[]>(() => createCues(SAMPLE_TEXT, 18));
  const [position, setPosition] = useState<Position>("bottom");
  const [preset, setPreset] = useState<StylePreset>("impact");
  const [fontSize, setFontSize] = useState(34);
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [activeColor, setActiveColor] = useState("#D9FF43");
  const [uppercase, setUppercase] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const demoTimerRef = useRef<number | null>(null);

  const activeIndex = useMemo(
    () => Math.max(0, cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end)),
    [cues, currentTime],
  );
  const visibleChunk = useMemo(() => chunkForIndex(cues, activeIndex), [cues, activeIndex]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (demoTimerRef.current) window.clearInterval(demoTimerRef.current);
    };
  }, [videoUrl]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function loadFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      notify("Scegli un file video valido");
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setFileName(file.name);
    setCurrentTime(0);
    setIsPlaying(false);
    notify("Video caricato — ora genera i sottotitoli");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    loadFile(event.dataTransfer.files[0]);
  }

  function generateSubtitles() {
    const next = createCues(transcript, duration);
    setCues(next);
    setCurrentTime(0);
    if (videoRef.current) videoRef.current.currentTime = 0;
    notify(`${next.length} parole sincronizzate`);
  }

  function togglePlayback() {
    if (videoRef.current && videoUrl) {
      if (videoRef.current.paused) void videoRef.current.play();
      else videoRef.current.pause();
      return;
    }
    if (isPlaying) {
      if (demoTimerRef.current) window.clearInterval(demoTimerRef.current);
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    demoTimerRef.current = window.setInterval(() => {
      setCurrentTime((time) => (time >= duration ? 0 : Math.min(duration, time + 0.05)));
    }, 50);
  }

  function seek(value: number) {
    setCurrentTime(value);
    if (videoRef.current) videoRef.current.currentTime = value;
  }

  async function exportVideo() {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      notify("Carica prima un video da esportare");
      return;
    }
    if (!("MediaRecorder" in window)) {
      notify("Il browser non supporta l’esportazione demo");
      return;
    }
    setExporting(true);
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setExporting(false);

    const canvasStream = canvas.captureStream(30);
    const sourceStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    sourceStream?.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && parts.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(parts, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${fileName.replace(/\.[^.]+$/, "") || "reel"}-sottotitoli.webm`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExporting(false);
      notify("Esportazione completata");
    };

    const draw = () => {
      if (video.paused || video.ended) return;
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;
      let width = canvas.width;
      let height = canvas.height;
      let x = 0;
      let y = 0;
      if (videoRatio > canvasRatio) {
        width = canvas.height * videoRatio;
        x = (canvas.width - width) / 2;
      } else {
        height = canvas.width / videoRatio;
        y = (canvas.height - height) / 2;
      }
      ctx.fillStyle = "#07080a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, x, y, width, height);
      drawCaption(ctx, video.currentTime, canvas.width, canvas.height);
      requestAnimationFrame(draw);
    };

    function drawCaption(context: CanvasRenderingContext2D, time: number, width: number, height: number) {
      const index = Math.max(0, cues.findIndex((cue) => time >= cue.start && time < cue.end));
      const chunk = chunkForIndex(cues, index);
      const words = chunk.words;
      if (!words.length) return;
      const size = fontSize * 1.62;
      const rendered = words.map((cue) => (uppercase ? cue.word.toUpperCase() : cue.word));
      context.font = `900 ${size}px Arial, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const gap = 17;
      const widths = rendered.map((word) => context.measureText(word).width);
      const total = widths.reduce((sum, item) => sum + item, 0) + gap * (words.length - 1);
      const centerY = position === "top" ? height * 0.2 : position === "middle" ? height * 0.5 : height * 0.78;
      if (preset === "boxed") {
        context.fillStyle = "rgba(5, 6, 8, .82)";
        context.beginPath();
        context.roundRect((width - total) / 2 - 22, centerY - size * 0.78, total + 44, size * 1.5, 18);
        context.fill();
      }
      let cursor = (width - total) / 2;
      rendered.forEach((word, wordIndex) => {
        const globalIndex = chunk.offset + wordIndex;
        context.lineWidth = preset === "impact" ? 11 : 0;
        context.strokeStyle = "rgba(0,0,0,.88)";
        const centerX = cursor + widths[wordIndex] / 2;
        if (preset === "impact") context.strokeText(word, centerX, centerY);
        context.fillStyle = globalIndex === index ? activeColor : textColor;
        context.fillText(word, centerX, centerY);
        cursor += widths[wordIndex] + gap;
      });
    }

    video.pause();
    video.currentTime = 0;
    recorder.start(1000);
    video.onended = () => recorder.state !== "inactive" && recorder.stop();
    await video.play();
    draw();
  }

  const captionClass = `caption caption-${position} caption-${preset}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="ReelType home">
          <span className="brand-mark">R</span>
          <span>ReelType</span>
          <span className="beta">BETA</span>
        </a>
        <div className="top-actions">
          <span className="autosave"><i /> Salvato</span>
          <button className="ghost-button" onClick={() => notify("Condivisione disponibile presto")}>Condividi</button>
          <button className="export-button" onClick={exportVideo} disabled={exporting}>
            {exporting ? <span className="spinner" /> : <span aria-hidden>↗</span>}
            {exporting ? "Esportazione…" : "Esporta video"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">STEP 1</span>
              <h1>Il tuo Reel</h1>
            </div>
            {videoUrl && <button className="icon-button" onClick={() => fileInputRef.current?.click()} aria-label="Sostituisci video">↻</button>}
          </div>

          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="video/*"
            onChange={(event: ChangeEvent<HTMLInputElement>) => loadFile(event.target.files?.[0])}
          />
          <div
            className={`dropzone ${isDragging ? "is-dragging" : ""} ${videoUrl ? "has-file" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === "Enter" && fileInputRef.current?.click()}
          >
            <span className="upload-icon">↑</span>
            <strong>{videoUrl ? fileName : "Trascina qui il tuo video"}</strong>
            <span>{videoUrl ? "Clicca per sostituirlo" : "oppure clicca per scegliere"}</span>
            {!videoUrl && <small>MP4, MOV o WebM · max 90 sec</small>}
          </div>

          <div className="section-title">
            <div>
              <span className="eyebrow">STEP 2</span>
              <h2>Testo parlato</h2>
            </div>
            <span className="language-pill">IT⌄</span>
          </div>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            aria-label="Testo dei sottotitoli"
          />
          <div className="text-meta">
            <span>{transcript.trim().split(/\s+/).filter(Boolean).length} parole</span>
            <span>Correggi il testo prima di generare</span>
          </div>
          <button className="generate-button" onClick={generateSubtitles}>
            <span>✦</span> Genera sottotitoli
          </button>
          <p className="demo-note">Demo rapida: le parole vengono distribuite sulla durata del video.</p>
        </aside>

        <section className="stage">
          <div className="stage-topline">
            <span>ANTEPRIMA</span>
            <span className="ratio-pill">9:16 · REEL</span>
          </div>
          <div className="phone-frame">
            <div className="phone-screen">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  onLoadedMetadata={(event) => {
                    const nextDuration = event.currentTarget.duration || 18;
                    setDuration(nextDuration);
                    setCues(createCues(transcript, nextDuration));
                  }}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : (
                <div className="demo-visual">
                  <div className="orb orb-one" />
                  <div className="orb orb-two" />
                  <div className="demo-person">R</div>
                  <span className="demo-label">CARICA UN REEL</span>
                </div>
              )}
              <div className={captionClass} style={{ fontSize, color: textColor }}>
                {visibleChunk.words.map((cue, index) => {
                  const globalIndex = visibleChunk.offset + index;
                  return (
                    <span
                      key={`${cue.start}-${cue.word}`}
                      className={globalIndex === activeIndex ? "active-word" : ""}
                      style={globalIndex === activeIndex ? { color: activeColor } : undefined}
                    >
                      {uppercase ? cue.word.toUpperCase() : cue.word}
                    </span>
                  );
                })}
              </div>
              <span className="safe-zone top-safe">SAFE ZONE</span>
              <span className="safe-zone bottom-safe" />
            </div>
          </div>
          <div className="player-controls">
            <button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? "Pausa" : "Riproduci"}>
              {isPlaying ? "Ⅱ" : "▶"}
            </button>
            <span className="timecode">{formatTime(currentTime)}</span>
            <input
              className="timeline"
              type="range"
              min="0"
              max={duration || 18}
              step="0.01"
              value={Math.min(currentTime, duration || 18)}
              onChange={(event) => seek(Number(event.target.value))}
              style={{ "--progress": `${(currentTime / (duration || 18)) * 100}%` } as React.CSSProperties}
              aria-label="Posizione video"
            />
            <span className="timecode">{formatTime(duration)}</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">STEP 3</span>
              <h2>Personalizza</h2>
            </div>
            <button className="reset-button" onClick={() => {
              setPreset("impact"); setPosition("bottom"); setFontSize(34);
              setTextColor("#FFFFFF"); setActiveColor("#D9FF43"); setUppercase(false);
            }}>Reset</button>
          </div>

          <div className="control-group">
            <label>Stile</label>
            <div className="preset-grid">
              {(["impact", "minimal", "boxed"] as StylePreset[]).map((item) => (
                <button key={item} className={`preset-card ${preset === item ? "selected" : ""}`} onClick={() => setPreset(item)}>
                  <span className={`preset-preview preview-${item}`}>Aa</span>
                  <span>{item === "impact" ? "Impact" : item === "minimal" ? "Pulito" : "Box"}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Posizione</label>
            <div className="segmented">
              {(["top", "middle", "bottom"] as Position[]).map((item) => (
                <button key={item} className={position === item ? "selected" : ""} onClick={() => setPosition(item)}>
                  <span className={`position-icon position-${item}`}><i /></span>
                  {item === "top" ? "Alto" : item === "middle" ? "Centro" : "Basso"}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <div className="range-label"><label htmlFor="font-size">Dimensione</label><output>{fontSize}px</output></div>
            <input id="font-size" className="size-slider" type="range" min="22" max="52" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} />
          </div>

          <div className="control-group color-group">
            <label>Colori</label>
            <div className="color-row">
              <span>Testo</span>
              <label className="color-control">
                <i style={{ background: textColor }} />
                <span>{textColor}</span>
                <input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value.toUpperCase())} aria-label="Colore testo" />
              </label>
            </div>
            <div className="color-row">
              <span>Parola attiva</span>
              <label className="color-control">
                <i style={{ background: activeColor }} />
                <span>{activeColor}</span>
                <input type="color" value={activeColor} onChange={(event) => setActiveColor(event.target.value.toUpperCase())} aria-label="Colore parola attiva" />
              </label>
            </div>
          </div>

          <div className="control-group toggle-row">
            <div>
              <label>Maiuscolo</label>
              <span>Più impatto nel feed</span>
            </div>
            <button className={`toggle ${uppercase ? "on" : ""}`} onClick={() => setUppercase((value) => !value)} aria-pressed={uppercase}><i /></button>
          </div>

          <div className="tip-card">
            <span>✦</span>
            <p><strong>Consiglio Reel</strong>Il giallo acceso aumenta la leggibilità mentre l’utente scorre il feed.</p>
          </div>
        </aside>
      </section>

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
