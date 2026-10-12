"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BookOpen, Crop, FileText, RotateCcw, UploadCloud, X, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "@/lib/zod";
import { appendWaiverTemplateParameter, waiverTemplateSrcDoc, type WaiverParameterMapping } from "@/lib/waiver-template";
import { CategoryForm } from "./category-form";
import { WaiverParameterPicker } from "./waiver-parameter-picker";
import { WaiverParameterMappingEditor } from "./waiver-parameter-mapping-editor";
import { eventTicketDefinitionSchema, type EventTicketDefinition } from '@/lib/event-ticket-definition';
import { defaultEventWaiverPolicy, eventWaiverPolicySchema } from '@/lib/event-waiver-policy';

const optionalUrl = z.string().refine((value) => !value || z.string().url().safeParse(value).success, "Enter a complete URL including https://");

const schema = z.object({
  name: z.string().min(3, "Enter an event name"),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens"),
  sport: z.string().min(1),
  date: z.string().min(1, "Choose an event date"),
  startTime: z.string().min(1, "Choose a start time"),
  city: z.string().min(2, "Enter a city"),
  venue: z.string().min(2, "Enter a venue"),
  venueAddress: z.string().max(500, "Venue address is too long"),
  organizerAddress: z.string().max(500, "Organizer address is too long"),
  jurisdiction: z.string().max(200, "Jurisdiction is too long"),
  organizer: z.string().min(2, "Enter the organizer"),
  companyDescription: z.string().max(1_000, "Company description is too long"),
  contactEmail: z.string().email("Enter a valid contact email"),
  contactPhone: z.string().min(7, "Enter a contact phone number"),
  websiteUrl: optionalUrl,
  registrationUrl: optionalUrl,
  knowMoreUrl: optionalUrl,
  broadcastUrl: optionalUrl,
  rulesUrl: optionalUrl,
  rulesHtml: z.string().max(100_000, "Rules content is too large"),
  waiverHtml: z.string().max(150_000, "Waiver content is too large"),
  waiverVersion: z.string().max(100, "Waiver version is too long"),
  waiverPolicy: eventWaiverPolicySchema,
  waiverParameterMappings: z.array(z.object({ token: z.string(), source: z.string(), customValue: z.string().optional() })).max(100),
  athleteGuidebookUrl: optionalUrl,
  athleteGuidebookData: z.string().optional(),
  latitude: z.string(),
  longitude: z.string(),
  description: z.string().min(20, "Add at least 20 characters"),
  logoName: z.string().optional(),
  logoData: z.string().optional(),
  bannerName: z.string().optional(),
  bannerData: z.string().optional(),
  categories: z.array(z.string()),
  ticketDefinitions: z.array(eventTicketDefinitionSchema),
});
export type EventFormData = z.infer<typeof schema>;

interface ImageAsset {
  name: string;
  data: string;
  sourceData?: string;
  cropHorizontal?: number;
  cropVertical?: number;
  cropZoom?: number;
}

interface PdfAsset {
  name: string;
  data: string;
  size: number;
}

function readPdf(file: File): Promise<PdfAsset> {
  return new Promise((resolve, reject) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      reject(new Error("Use a PDF file."));
      return;
    }
    if (file.size > 5_000_000) {
      reject(new Error("Athlete guidebook must be smaller than 5 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: String(reader.result), size: file.size });
    reader.onerror = () => reject(new Error("The PDF could not be read."));
    reader.readAsDataURL(file);
  });
}

function readImage(file: File, maximumBytes: number): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      reject(new Error("Use a PNG, JPG or WebP image."));
      return;
    }
    if (file.size > maximumBytes) {
      reject(new Error(`Image must be smaller than ${(maximumBytes / 1024 / 1024).toFixed(1)} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: String(reader.result) });
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

export function cropEventImage({
  source,
  width,
  height,
  horizontal,
  vertical,
  zoom,
  format,
}: {
  source: string;
  width: number;
  height: number;
  horizontal: number;
  vertical: number;
  zoom: number;
  format: "image/png" | "image/jpeg";
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("The image crop could not be prepared."));
        return;
      }
      // At 100%, fit the complete source inside the requested output. Cropping
      // begins only when the administrator deliberately increases the zoom.
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight) * zoom;
      const scaledWidth = image.naturalWidth * scale;
      const scaledHeight = image.naturalHeight * scale;
      const offsetX = scaledWidth > width
        ? -((scaledWidth - width) * (horizontal / 100))
        : (width - scaledWidth) / 2;
      const offsetY = scaledHeight > height
        ? -((scaledHeight - height) * (vertical / 100))
        : (height - scaledHeight) / 2;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
      resolve(canvas.toDataURL(format, format === "image/jpeg" ? 0.9 : undefined));
    };
    image.onerror = () => reject(new Error("The image crop could not be prepared."));
    image.src = source;
  });
}

function ImageUpload({
  label,
  hint,
  asset,
  ratio,
  maximumBytes,
  onChange,
}: {
  label: string;
  hint: string;
  asset: ImageAsset | null;
  ratio: "logo" | "banner";
  maximumBytes: number;
  onChange: (asset: ImageAsset | null) => void;
}) {
  const [error, setError] = useState("");
  const horizontal = asset?.cropHorizontal ?? 50;
  const vertical = asset?.cropVertical ?? 50;
  const zoom = asset?.cropZoom ?? 1;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const selected = await readImage(file, maximumBytes);
      const size = ratio === "logo" ? { width: 800, height: 800, format: "image/png" as const } : { width: 1600, height: 600, format: "image/jpeg" as const };
      onChange({
        ...selected,
        sourceData: selected.data,
        data: await cropEventImage({ source: selected.data, ...size, horizontal: 50, vertical: 50, zoom: 1 }),
        cropHorizontal: 50,
        cropVertical: 50,
        cropZoom: 1,
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid image.");
    }
  }

  return (
    <div className={`event-image-upload ${ratio}`}>
      <div className="event-image-upload-head"><label>{label}</label>{asset && <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${label}`}><X /></button>}</div>
      <label className="event-image-drop">
        {asset ? <Image
          src={asset.sourceData ?? asset.data}
          alt={`${label} preview`}
          fill
          sizes={ratio === "logo" ? "180px" : "700px"}
          style={{
            objectFit: "contain",
            objectPosition: `${horizontal}% ${vertical}%`,
            transform: `scale(${zoom})`,
            transformOrigin: `${horizontal}% ${vertical}%`,
          }}
        /> : <><UploadCloud /><b>Upload {label.toLowerCase()}</b><span>{hint}</span></>}
        <input className="event-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} />
      </label>
      {asset && (
        <div className="banner-crop-controls">
          <div className="banner-crop-title"><span><Crop /> Crop, position and zoom</span><small>{ratio === "logo" ? "Recommended 800 × 800 px · square" : "Recommended 1600 × 600 px · 8:3"}</small></div>
          <label><span>Horizontal</span><input type="range" min="0" max="100" value={horizontal} onChange={(event) => onChange({ ...asset, cropHorizontal: Number(event.target.value) })} /></label>
          <label><span>Vertical</span><input type="range" min="0" max="100" value={vertical} onChange={(event) => onChange({ ...asset, cropVertical: Number(event.target.value) })} /></label>
          <label className="crop-zoom-row">
            <span>Zoom</span>
            <button type="button" aria-label="Zoom out" onClick={() => onChange({ ...asset, cropZoom: Math.max(1, zoom - 0.1) })}><ZoomOut /></button>
            <input type="range" min="100" max="250" value={Math.round(zoom * 100)} onChange={(event) => onChange({ ...asset, cropZoom: Number(event.target.value) / 100 })} />
            <button type="button" aria-label="Zoom in" onClick={() => onChange({ ...asset, cropZoom: Math.min(2.5, zoom + 0.1) })}><ZoomIn /></button>
          </label>
          <button type="button" className="crop-reset-button" onClick={() => onChange({ ...asset, cropHorizontal: 50, cropVertical: 50, cropZoom: 1 })}><RotateCcw /> Fit full image · {Math.round(zoom * 100)}%</button>
        </div>
      )}
      {asset && <small>{asset.name}</small>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function EventForm({
  onCreated,
  disabled = false,
  slugSuggestion = "",
}: {
  onCreated?: (event: EventFormData) => void | Promise<void>;
  disabled?: boolean;
  slugSuggestion?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [logo, setLogo] = useState<ImageAsset | null>(null);
  const [banner, setBanner] = useState<ImageAsset | null>(null);
  const [guidebook, setGuidebook] = useState<PdfAsset | null>(null);
  const [guidebookError, setGuidebookError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [ticketDefinitions, setTicketDefinitions] = useState<EventTicketDefinition[]>([]);
  const { register, handleSubmit, reset, setValue, control, formState: { errors } } = useForm<EventFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      slug: "",
      sport: "Running",
      date: "",
      startTime: "",
      city: "",
      venue: "",
      venueAddress: "",
      organizerAddress: "",
      jurisdiction: "",
      organizer: "",
      companyDescription: "",
      contactEmail: "",
      contactPhone: "",
      websiteUrl: "",
      registrationUrl: "",
      knowMoreUrl: "",
      broadcastUrl: "",
      rulesUrl: "",
      rulesHtml: "",
      waiverHtml: "",
      waiverVersion: "",
      waiverPolicy: defaultEventWaiverPolicy,
      waiverParameterMappings: [],
      athleteGuidebookUrl: "",
      athleteGuidebookData: "",
      latitude: "",
      longitude: "",
      description: "",
      categories: [],
      ticketDefinitions: [],
    },
  });
  const rulesValue = useWatch({ control, name: "rulesHtml" });
  const waiverValue = useWatch({ control, name: "waiverHtml" });
  const waiverMappingsValue = useWatch({ control, name: "waiverParameterMappings" });
  const [previewEventName, previewEventDate, previewOrganizer, previewCompanyDescription, previewEmail, previewPhone, previewWaiverVersion, previewJurisdiction, previewOrganizerAddress] = useWatch({
    control,
    name: ["name", "date", "organizer", "companyDescription", "contactEmail", "contactPhone", "waiverVersion", "jurisdiction", "organizerAddress"],
  });

  useEffect(() => {
    if (!slugSuggestion) return;
    setValue("slug", slugSuggestion, { shouldDirty: true, shouldValidate: true });
  }, [setValue, slugSuggestion]);

  async function createEvent(data: EventFormData) {
    try {
      const logoData = logo?.sourceData
        ? await cropEventImage({
          source: logo.sourceData,
          width: 800,
          height: 800,
          horizontal: logo.cropHorizontal ?? 50,
          vertical: logo.cropVertical ?? 50,
          zoom: logo.cropZoom ?? 1,
          format: "image/png",
        })
        : logo?.data;
      const bannerData = banner?.sourceData
        ? await cropEventImage({
          source: banner.sourceData,
          width: 1600,
          height: 600,
          horizontal: banner.cropHorizontal ?? 50,
          vertical: banner.cropVertical ?? 50,
          zoom: banner.cropZoom ?? 1,
          format: "image/jpeg",
        })
        : banner?.data;
      await onCreated?.({
        ...data,
        categories,
        ticketDefinitions,
        logoName: logo?.name,
        logoData,
        bannerName: banner?.name,
        bannerData,
        athleteGuidebookData: guidebook?.data,
      });
      reset();
      setLogo(null);
      setBanner(null);
      setGuidebook(null);
      setCategories([]);
      setTicketDefinitions([]);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  async function chooseGuidebook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setGuidebook(await readPdf(file));
      setValue("athleteGuidebookUrl", "");
      setGuidebookError("");
    } catch (reason) {
      setGuidebook(null);
      setGuidebookError(reason instanceof Error ? reason.message : "Invalid PDF.");
    }
  }

  const rulesPreview = rulesValue || "";

  return (
    <form id="create-event-form" onSubmit={handleSubmit(createEvent)}>
      {saved && <div className="success-banner">Draft event created. You can now add categories, timing points and event media.</div>}
      <div className="form-card">
        <div className="admin-card-head"><h2>Event details</h2><span className="status-pill">Draft</span></div>
        <div className="event-media-grid">
          <ImageUpload label="Event logo" hint="Recommended 800 × 800 square · PNG, JPG or WebP · max 0.8 MB" asset={logo} ratio="logo" maximumBytes={800_000} onChange={setLogo} />
          <ImageUpload label="Event banner" hint="Recommended 1600 × 600 · max 1.5 MB" asset={banner} ratio="banner" maximumBytes={1_500_000} onChange={setBanner} />
        </div>
        <section className="event-fields-section"><h3>Event details</h3><div className="form-grid">
          <div className="field"><label>Event name</label><input {...register("name")} />{errors.name && <span className="field-error">{errors.name.message}</span>}</div>
          <div className="field"><label>Event slug</label><input id="new-event-slug" {...register("slug")} />{errors.slug && <span className="field-error">{errors.slug.message}</span>}</div>
          <div className="field"><label>Sport</label><select {...register("sport")}><option>Running</option><option>Triathlon</option><option>Cycling</option><option>Swimming</option></select></div>
          <div className="field"><label>Event date</label><input type="date" {...register("date")} />{errors.date && <span className="field-error">{errors.date.message}</span>}</div>
          <div className="field"><label>Start time</label><input type="time" {...register("startTime")} />{errors.startTime && <span className="field-error">{errors.startTime.message}</span>}</div>
          <div className="field"><label>Jurisdiction</label><input placeholder="Country, state or governing jurisdiction" {...register("jurisdiction")} />{errors.jurisdiction && <span className="field-error">{errors.jurisdiction.message}</span>}</div>
          <div className="field full"><label>Description</label><textarea {...register("description")} />{errors.description && <span className="field-error">{errors.description.message}</span>}</div>
        </div></section>
        <section className="event-fields-section"><h3>Venue details</h3><div className="form-grid">
          <div className="field"><label>City</label><input {...register("city")} />{errors.city && <span className="field-error">{errors.city.message}</span>}</div>
          <div className="field"><label>Venue</label><input {...register("venue")} />{errors.venue && <span className="field-error">{errors.venue.message}</span>}</div>
          <div className="field full"><label>Event venue address</label><textarea rows={2} placeholder="Full address of the event venue" {...register("venueAddress")} />{errors.venueAddress && <span className="field-error">{errors.venueAddress.message}</span>}</div>
          <div className="field"><label>Latitude</label><input inputMode="decimal" {...register("latitude")} /></div>
          <div className="field"><label>Longitude</label><input inputMode="decimal" {...register("longitude")} /></div>
        </div></section>
        <section className="event-fields-section"><h3>Organizer details</h3><div className="form-grid">
          <div className="field"><label>Organizer</label><input {...register("organizer")} />{errors.organizer && <span className="field-error">{errors.organizer.message}</span>}</div>
          <div className="field full"><label>Company description</label><textarea rows={3} placeholder="Brief legal or business description of the organizing company" {...register("companyDescription")} />{errors.companyDescription && <span className="field-error">{errors.companyDescription.message}</span>}</div>
          <div className="field"><label>Contact email</label><input type="email" {...register("contactEmail")} />{errors.contactEmail && <span className="field-error">{errors.contactEmail.message}</span>}</div>
          <div className="field"><label>Contact phone</label><input type="tel" {...register("contactPhone")} />{errors.contactPhone && <span className="field-error">{errors.contactPhone.message}</span>}</div>
          <div className="field full"><label>Organizer address</label><textarea rows={2} placeholder="Registered or mailing address of the organizer" {...register("organizerAddress")} />{errors.organizerAddress && <span className="field-error">{errors.organizerAddress.message}</span>}</div>
        </div></section>
        <section className="event-fields-section"><h3>Event links</h3><div className="form-grid">
          <div className="field"><label>Event website</label><input type="url" {...register("websiteUrl")} />{errors.websiteUrl && <span className="field-error">{errors.websiteUrl.message}</span>}</div>
          <div className="field"><label>Registration URL</label><input type="url" {...register("registrationUrl")} />{errors.registrationUrl && <span className="field-error">{errors.registrationUrl.message}</span>}</div>
          <div className="field"><label>Know more URL</label><input type="url" {...register("knowMoreUrl")} />{errors.knowMoreUrl && <span className="field-error">{errors.knowMoreUrl.message}</span>}</div>
          <div className="field"><label>Live broadcast URL</label><input type="url" placeholder="https://…" {...register("broadcastUrl")} />{errors.broadcastUrl && <span className="field-error">{errors.broadcastUrl.message}</span>}</div>
        </div></section>
        <div className="event-document-section">
          <div className="event-document-heading"><BookOpen /><div><h3>Rules &amp; athlete resources</h3><p>Publish formatted event rules and an athlete guidebook to the website and mobile app.</p></div></div>
          <div className="event-document-grid">
            <div className="event-rules-editor">
              <div className="field">
                <label>Rules &amp; regulations · HTML/Text</label>
                <textarea
                  className="rules-html-input"
                  rows={12}
                  placeholder={"<h2>Race rules</h2>\n<p>Enter the official event rules here.</p>\n<ul><li>Rule one</li><li>Rule two</li></ul>"}
                  {...register("rulesHtml")}
                />
                <small>Supported HTML includes headings, paragraphs, lists, tables, links and emphasis. Unsafe scripts are removed.</small>
                {errors.rulesHtml && <span className="field-error">{errors.rulesHtml.message}</span>}
              </div>
              <div className="field">
                <label>External rules URL · optional fallback</label>
                <input type="url" placeholder="https://…" {...register("rulesUrl")} />
                {errors.rulesUrl && <span className="field-error">{errors.rulesUrl.message}</span>}
              </div>
            </div>
            <div className="event-rules-preview">
              <div className="event-document-subhead"><FileText /><span><b>Rules preview</b><small>Sanitized public rendering</small></span></div>
              {rulesPreview
                ? <iframe title="Rules preview" sandbox="" srcDoc={rulesPreview} />
                : <div className="admin-empty">The formatted rules preview will appear here.</div>}
            </div>
          </div>
          <div className="guidebook-upload-grid">
            <label className={`guidebook-upload ${guidebook ? "uploaded" : ""}`}>
              <UploadCloud />
              <span><b>{guidebook ? guidebook.name : "Upload athlete guidebook"}</b><small>{guidebook ? `${(guidebook.size / 1024 / 1024).toFixed(2)} MB · ready to save` : "PDF only · maximum 5 MB"}</small></span>
              <input type="file" accept="application/pdf,.pdf" onChange={chooseGuidebook} />
              {guidebook && <button type="button" aria-label="Remove athlete guidebook" onClick={(event) => { event.preventDefault(); setGuidebook(null); }}><X /></button>}
            </label>
            <div className="field">
              <label>Or athlete guidebook URL</label>
              <input type="url" placeholder="https://…/athlete-guidebook.pdf" disabled={Boolean(guidebook)} {...register("athleteGuidebookUrl")} />
              <small>Upload a PDF or provide a public PDF/web URL.</small>
              {errors.athleteGuidebookUrl && <span className="field-error">{errors.athleteGuidebookUrl.message}</span>}
              {guidebookError && <span className="field-error">{guidebookError}</span>}
            </div>
          </div>
          <div className="event-document-grid event-waiver-grid">
            <div className="event-rules-editor">
              <div className="field">
                <label>Waiver template · HTML/Text · optional</label>
                <textarea
                  className="rules-html-input"
                  rows={18}
                  placeholder={"<h2>Waiver & Indemnity Declaration</h2>\n<p>I, <strong>{{params.name}}</strong>, confirm that…</p>"}
                  {...register("waiverHtml")}
                />
                <small>Paste HTML, CSS or mixed formatted text. Both {"{{params.name}}"} and aliases such as {"{{name}}"} are accepted. Unsafe active content is removed before storage.</small>
                {errors.waiverHtml && <span className="field-error">{errors.waiverHtml.message}</span>}
              </div>
              <WaiverParameterPicker onInsert={(token) => setValue(
                "waiverHtml",
                appendWaiverTemplateParameter(waiverValue || "", token),
                { shouldDirty: true, shouldValidate: true },
              )} />
              <div className="field">
                <label>Map waiver parameters for this event</label>
                <WaiverParameterMappingEditor template={waiverValue || ""} mappings={waiverMappingsValue || []} onChange={(mappings) => setValue("waiverParameterMappings", mappings as WaiverParameterMapping[], { shouldDirty: true, shouldValidate: true })} />
                <small>These mappings apply only to this event’s waiver.</small>
              </div>
              <div className="field">
                <label>Waiver version · optional</label>
                <input placeholder="e.g. OZAR-2026-v1" {...register("waiverVersion")} />
                <small>Use a new version whenever the legal waiver text changes.</small>
                {errors.waiverVersion && <span className="field-error">{errors.waiverVersion.message}</span>}
              </div>
              <fieldset className="field full"><legend>Registration, waiver and check-in policy</legend>
                <label><input type="checkbox" {...register("waiverPolicy.consolidatedWaiverEnabled")} /> Enable consolidated waiver for eligible registrations</label>
                <label><input type="checkbox" {...register("waiverPolicy.allowMultipleRegistrationsPerParticipant")} /> Allow multiple registrations per participant</label>
                <label><input type="checkbox" checked readOnly /> Allow duplicate email addresses (always enabled)</label>
                <label>Waiver coverage<select {...register("waiverPolicy.waiverCoverage")}><option value="PER_REGISTRATION">Per registration</option><option value="PER_EVENT_EDITION">Per event edition</option><option value="MULTIPLE_SELECTED_REGISTRATIONS">Multiple selected registrations</option></select></label>
                <label><input type="checkbox" {...register("waiverPolicy.requireSeparateWaiverForDifferentEvents")} /> Require separate waiver for different events</label>
                <label><input type="checkbox" {...register("waiverPolicy.requireSeparateWaiverForDifferentDisciplines")} /> Require separate waiver for different disciplines</label>
                <label><input type="checkbox" {...register("waiverPolicy.allowCheckInBeforeScheduledSession")} /> Allow check-in before scheduled session</label>
                <label><input type="checkbox" {...register("waiverPolicy.allowCheckInAll")} /> Allow check-in all eligible registrations</label>
                <label><input type="checkbox" {...register("waiverPolicy.requireGuardianSignatureForMinors")} /> Require guardian signature for minors</label>
              </fieldset>
            </div>
            <div className="event-rules-preview waiver-preview">
              <div className="event-document-subhead"><FileText /><span><b>Waiver preview</b><small>Sanitized stored rendering</small></span></div>
              {waiverValue
                ? <iframe title="Waiver preview" sandbox="" srcDoc={waiverTemplateSrcDoc(waiverValue, {
                  name: "Participant Name", email: previewEmail || "participant@example.com", phone: previewPhone || "+91 90000 00000",
                  address: "Participant address", emergency_number: "+91 90000 00001", eventname: previewEventName || "Event Name",
                  category: categories[0] || "Race Category", eventdate: previewEventDate || "Event Date", day: previewEventDate ? String(new Date(`${previewEventDate}T00:00:00`).getDate()) : "DD",
                  date: previewEventDate || "Event Date", organizer_name: previewOrganizer || "Organiser Name", company_description: previewCompanyDescription || "Company description",
                  organizer_address: previewOrganizerAddress || "Organiser address", country: "India",
                  jurisdiction: previewJurisdiction || "Event jurisdiction",
                  waiver_version: previewWaiverVersion || "Current version", signature_name: "Participant Name",
                }, waiverMappingsValue || [])} />
                : <div className="admin-empty">The waiver preview will appear here.</div>}
            </div>
          </div>
        </div>
        <CategoryForm categories={categories} onChange={setCategories} ticketDefinitions={ticketDefinitions} onTicketDefinitionsChange={setTicketDefinitions} />
        <div className="form-actions">
          <button type="button" className="button" onClick={() => { reset(); setLogo(null); setBanner(null); setGuidebook(null); setGuidebookError(""); setCategories([]); setSaved(false); }}>Reset</button>
          <button className="button button-primary" disabled={disabled}>{disabled ? "Saving to Worker…" : "Create draft event"}</button>
        </div>
      </div>
    </form>
  );
}
