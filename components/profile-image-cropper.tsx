"use client";

import { ImagePlus, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, useEffect, useState } from "react";

type CropState = {
  source: string;
  fileName: string;
  zoom: number;
  horizontal: number;
  vertical: number;
};

async function cropImage(crop: CropState): Promise<Blob> {
  const sourceImage = document.createElement("img");
  sourceImage.src = crop.source;
  await sourceImage.decode();

  const cropSize = Math.min(sourceImage.naturalWidth, sourceImage.naturalHeight) / crop.zoom;
  const horizontalTravel = (sourceImage.naturalWidth - cropSize) / 2;
  const verticalTravel = (sourceImage.naturalHeight - cropSize) / 2;
  const sourceX = Math.max(0, Math.min(
    sourceImage.naturalWidth - cropSize,
    (sourceImage.naturalWidth - cropSize) / 2 + (crop.horizontal / 100) * horizontalTravel,
  ));
  const sourceY = Math.max(0, Math.min(
    sourceImage.naturalHeight - cropSize,
    (sourceImage.naturalHeight - cropSize) / 2 + (crop.vertical / 100) * verticalTravel,
  ));

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image cropping is unavailable in this browser.");
  context.drawImage(sourceImage, sourceX, sourceY, cropSize, cropSize, 0, 0, 256, 256);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("The cropped image could not be created.")),
      "image/jpeg",
      0.82,
    );
  });
}

export function ProfileImageCropper({
  currentUrl,
  initials,
  busy,
  onCropped,
}: {
  currentUrl: string;
  initials: string;
  busy: boolean;
  onCropped: (blob: Blob) => Promise<void>;
}) {
  const [crop, setCrop] = useState<CropState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (crop?.source.startsWith("blob:")) URL.revokeObjectURL(crop.source);
  }, [crop?.source]);

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a JPG, PNG, WebP or HEIC image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Choose an image smaller than 8 MB.");
      return;
    }
    setError("");
    setCrop({
      source: URL.createObjectURL(file),
      fileName: file.name,
      zoom: 1,
      horizontal: 0,
      vertical: 0,
    });
  }

  async function applyCrop() {
    if (!crop) return;
    setError("");
    try {
      await onCropped(await cropImage(crop));
      setCrop(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The profile image could not be uploaded.");
    }
  }

  return (
    <div className="profile-image-editor">
      <div className="profile-image-preview">
        {currentUrl ? <Image src={currentUrl} alt="Current profile" width={72} height={72} unoptimized /> : initials}
      </div>
      <div className="profile-image-copy">
        <b>Profile image</b>
        <small>Upload and crop a square image. It will be compressed for your private profile.</small>
        <label className="profile-image-picker"><ImagePlus size={15} /> Choose image<input type="file" accept="image/*" onChange={chooseImage} /></label>
        {error && <p className="profile-image-error">{error}</p>}
      </div>

      {crop && (
        <div className="crop-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Crop profile image">
          <div className="crop-dialog">
            <div className="crop-dialog-heading"><div><span className="eyebrow">PROFILE IMAGE</span><h3>Crop and fit</h3></div><button type="button" onClick={() => setCrop(null)} aria-label="Close crop dialog"><X /></button></div>
            <div className="crop-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={crop.source}
                alt="Crop preview"
                style={{
                  transform: `scale(${crop.zoom}) translate(${crop.horizontal * 0.28}px, ${crop.vertical * 0.28}px)`,
                }}
              />
            </div>
            <div className="crop-controls">
              <label>Zoom<input type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={(event) => setCrop({ ...crop, zoom: Number(event.target.value) })} /></label>
              <label>Left / right<input type="range" min="-100" max="100" value={crop.horizontal} onChange={(event) => setCrop({ ...crop, horizontal: Number(event.target.value) })} /></label>
              <label>Up / down<input type="range" min="-100" max="100" value={crop.vertical} onChange={(event) => setCrop({ ...crop, vertical: Number(event.target.value) })} /></label>
            </div>
            <div className="crop-dialog-actions">
              <button type="button" className="button button-secondary" onClick={() => setCrop({ ...crop, zoom: 1, horizontal: 0, vertical: 0 })}><RotateCcw size={15} /> Reset</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void applyCrop()}>{busy ? "Uploading…" : "Use image"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
