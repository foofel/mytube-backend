import { notifyVideoProcessed, notifyNewVideo } from './notifications';
import { Job, Queue } from 'bullmq';
import { Worker } from 'bullmq';
import * as node_path from "node:path";
import { $ } from "bun";
import { db } from './orm';
import { transcodeInfo, transcodeJobs, uploads, videos } from './drizzle/schema';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import fs from 'node:fs/promises';

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || "6379";

interface TranscodeJob {
    tus_upload: Upload;
    upload_entry: typeof uploads.$inferSelect;
    video_entry: typeof videos.$inferSelect;
}

export const transcodeQueue = new Queue<TranscodeJob>('transcode', {
    connection: {
        host: REDIS_HOST,
        port: parseInt(REDIS_PORT),
    },
});

//////////

type Payload = {
    input: string;        // absolute or relative path to input file
    outputDir: string;    // absolute or relative output directory
};

function hhmmssToSec(hms: string): number {
    // "00:05:15.375000" -> seconds (float)
    const m = hms.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const [, hh, mm, ss] = m;
    return +hh * 3600 + +mm * 60 + parseFloat(ss);
}

async function* streamLines(readable: ReadableStream<Uint8Array>) {
    const reader = readable.getReader();
    const td = new TextDecoder();
    let buf = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += td.decode(value, { stream: true });

            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
                let line = buf.slice(0, idx);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                yield line;
                buf = buf.slice(idx + 1);
            }
        }
        if (buf.length) yield buf;
    } finally {
        reader.releaseLock();
    }
}

async function runScript(job: Job<TranscodeJob>, transcode_output_path: string, all_logs:Array<string>) {

    const { tus_upload, upload_entry } = job.data

    // Ensure relative paths are fine from your worker’s cwd:
    const inPath = node_path.resolve(tus_upload.storage.path);
    const outDir = node_path.resolve(transcode_output_path);

    // Ensure script is executable: chmod +x ./scripts/transcode.sh
    const child = Bun.spawn(["./scripts/transcode.sh", inPath, outDir], {
        stdio: ["ignore", "pipe", "pipe"], // we parse stdout; stderr to logs
    });

    // Parse stdout as FFmpeg -progress key=value blocks
    let block: Record<string, string> = {};
    let finalBlock: any = null;

    const flushBlock = async () => {
        if (!Object.keys(block).length) return;

        const out_time = block["out_time"];          // "00:05:15.375000"
        const out_time_ms = block["out_time_ms"];    // "315375000"
        const frame = block["frame"];
        const fps = block["fps"];
        const speed = block["speed"];                // "3.32x"
        const total_size = block["total_size"];      // bytes
        const bitrate = block["bitrate"];            // "8374.4kbits/s"
        const progress = block["progress"];          // "continue" | "end"

        let secondsDone = 0;
        if (out_time) secondsDone = hhmmssToSec(out_time);
        else if (out_time_ms) secondsDone = Number(out_time_ms) / 1000;


        // const percent =
        //   durationSec != null
        // ? Math.max(0, Math.min(100, Math.round((secondsDone / durationSec) * 100)))
        // : null;
        const percent = 0;

        const new_progress = {
            percent,
            secondsDone,
            frame: frame ? Number(frame) : null,
            fps: fps ? Number(fps) : null,
            speed,
            totalSize: total_size ? Number(total_size) : null,
            bitrate,
            raw: { ...block },
        }
        console.log(new_progress)

        await job.updateProgress(new_progress);

        if (progress === "end") {
            finalBlock = { ...block, secondsDone, percent };
        }
    };

    // stdout: progress blocks
    (async () => {
        for await (const line of streamLines(child.stdout)) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const eq = trimmed.indexOf("=");
            if (eq !== -1) {
                const key = trimmed.slice(0, eq);
                const val = trimmed.slice(eq + 1);
                block[key] = val;

                if (key === "progress") {
                    await flushBlock();
                    block = {};
                }
            } else {
                console.log(trimmed);
                all_logs.push(trimmed);
                await job.log(trimmed);
            }
        }
    })().catch((e) => {
        console.log(`[stdout read error] ${(e as Error).message}`)
        all_logs.push(`[stdout read error] ${(e as Error).message}`)
        job.log(`[stdout read error] ${(e as Error).message}`)
    });

    // stderr: forward to logs for debugging
    (async () => {
        for await (const line of streamLines(child.stderr)) {
            console.log(`[stderr] ${line}`);
            all_logs.push(`[stderr] ${line}`);
            await job.log(`[stderr] ${line}`);
        }
    })().catch((e) => {
        console.log(`[stderr read error] ${(e as Error).message}`)
        all_logs.push(`[stderr read error] ${(e as Error).message}`);
        job.log(`[stderr read error] ${(e as Error).message}`)
    });

    //   // cooperative cancellation
    //   const killChild = () => {
    //     try {
    //       child.kill(); // sends SIGTERM by default
    //     } catch {}
    //   };
    //   job.on("removed", killChild);
    //   job.on("stalled", killChild); // optional

    // wait for process to exit
    const exitCode = await child.exited; // Promise<number>
    if (exitCode !== 0) {
        throw new Error(`transcode.sh failed with exit code ${exitCode}`);
    }

    return { outputDir: outDir, final: finalBlock, all_logs };
}

/**
 * Convert poster PNG to AVIF variants using Sharp
 * Expects poster_lossless.png to already exist (created by transcode.sh)
 */
async function generatePosterImages(outputDir: string): Promise<void> {
    const posterSrc = node_path.join(outputDir, 'poster_lossless.png');

    // Verify the PNG was created by transcode.sh
    try {
        const stats = await fs.stat(posterSrc);
        if (stats.size === 0) {
            throw new Error('poster_lossless.png exists but is empty');
        }
    } catch (error) {
        throw new Error(`poster_lossless.png not found at ${posterSrc}. Transcode script should have created it.`);
    }

    // AVIF conversion configurations (matching transcode.sh quality expectations)
    const configs = [
        { width: 854, name: 'poster_480p', quality: 80, effort: 6 },
        { width: 1280, name: 'poster_720p', quality: 80, effort: 6 },
        { width: 1920, name: 'poster_1080p', quality: 80, effort: 6 },
        { width: 2560, name: 'poster_1440p', quality: 82, effort: 7 },
        { width: 3840, name: 'poster_2160p', quality: 82, effort: 7 },
    ];

    // Convert all variants in parallel using Sharp
    await Promise.all(
        configs.map(async (config) => {
            const outputPath = node_path.join(outputDir, `${config.name}.avif`);
            await sharp(posterSrc)
                .resize(config.width, null, {
                    fit: 'inside',
                    withoutEnlargement: true,
                    kernel: 'lanczos3',
                })
                .avif({
                    quality: config.quality,
                    effort: config.effort,
                })
                .toFile(outputPath);
        })
    );
}

///////////

const transcodeWorker = new Worker('transcode',
    async (job: Job<TranscodeJob>) => {
        const { tus_upload, upload_entry, video_entry } = job.data
        console.log(`new job (${tus_upload.metadata?.filename})`, job.data)

        const transcode_output_path = `./data/videos/${video_entry.publicId}`

        if(!tus_upload.storage?.path) {
            console.error("upload object had no storage path");
            return;
        }

        const [ transcode_job_entry ] = await db.insert(transcodeJobs).values(
            { uploadId: upload_entry.id, inputPath: tus_upload.storage.path, outputPath: transcode_output_path, state: 'transcoding' }
        ).returning();
        if(!transcode_job_entry) {
            console.error("no transcode job entry created");
            return;
        }
        let all_logs:Array<string> = []
        try {
            const job_result = await runScript(job, transcode_output_path, all_logs);

            // Generate poster AVIF variants using Sharp (PNG already created by transcode.sh)
            console.log(`Generating AVIF poster variants for ${video_entry.publicId}`);
            await generatePosterImages(transcode_output_path);
            console.log(`Poster AVIF variants generated successfully`);
        } catch(e) {
            console.error(`error running transcode job: ${e}`)
        }
        await db.update(transcodeJobs).set({ state: 'completed', transcodeResult: all_logs.join("\n") }).where(eq(transcodeJobs.id, transcode_job_entry.id));

        const meta = await buildHlsMetadata(transcode_output_path);
        await db.insert(transcodeInfo).values({
            path: meta.progressive.path,
            videoId: video_entry.id,
            duration: meta.progressive.durationSeconds,
            sizeBytes: meta.progressive.sizeBytes,
            bitrateKbps: meta.progressive.measuredKbps,
            videoCodec: meta.progressive.videoCodec?.codecName,
            audioCodec: meta.progressive.audioCodec?.codecName,
            fps: meta.progressive.fps,
            pixelFormat: meta.progressive.videoCodec?.pixelFormat,
            width: meta.progressive.width,
            height: meta.progressive.height,
            metadata: JSON.stringify(meta.progressive)
        })
        for(const variant of meta.hls.variants) {
            await db.insert(transcodeInfo).values({
                path: variant.path,
                videoId: video_entry.id,
                duration: variant.durationSeconds,
                sizeBytes: variant.sizeBytes,
                bitrateKbps: variant.bandwidthKbps,
                videoCodec: variant.videoCodec?.codecName,
                audioCodec: variant.audioCodec?.codecName,
                fps: variant.fps,
                pixelFormat: variant.videoCodec?.pixelFormat,
                width: variant.width,
                height: variant.height,
                metadata: JSON.stringify(variant)
            })
        }

        await db.update(videos).set({ ready: true }).where(
            and(
                eq(videos.id, video_entry.id)
            )
        )

        // Send push notifications
        // Always notify the uploader that their video is ready
        await notifyVideoProcessed(video_entry.id, video_entry.userId);

        // If video is public or users, also notify all other users
        if (video_entry.visibilityState === 'public' || video_entry.visibilityState === 'users') {
          notifyNewVideo(video_entry.id, video_entry.userId).catch(err =>
            console.error('Error sending new video notifications:', err)
          );
        }

        console.log(`job done (${tus_upload.metadata?.filename})`);
    }, {
    connection: {
        host: REDIS_HOST,
        port: parseInt(REDIS_PORT),
    },
});

transcodeWorker.on("failed", (e) => {
    console.error(e?.data, e?.failedReason);
})



////////////////////////////////////////////////////////////////////////////////////

// hlsMetadata.ts
// Bun + TypeScript: derive HLS metadata from master.m3u8 (no duplicated config)
import { promises as fs } from "node:fs";
import { Upload } from '@tus/server';

type CodecInfo = {
    codecName: string | null;
    codecLongName: string | null;
    profile: string | null;
    pixelFormat?: string | null;   // for video
    level?: number | null;         // for video
    sampleRate?: number | null;    // for audio
    channels?: number | null;      // for audio
    bitRateKbps?: number | null;
};

type VariantInfo = {
    id: string | null;            // e.g. "0" from "0/index.m3u8"
    path: string;
    bandwidthKbps: number | null; // advertised BANDWIDTH from master
    avgMeasuredKbps: number | null; // computed from segment sizes / EXTINF
    sizeBytes: number | null;     // sum(segments) + playlist file
    durationSeconds: number | null; // sum(EXTINF)
    resolution: string | null;    // e.g. "1920x1080"
    width: number | null;         // parsed from RESOLUTION or ffprobe fallback
    height: number | null;
    fps: number | null;           // master FRAME-RATE or ffprobe avg_frame_rate
    codecs: string | null;        // CODECS attr from master
    videoCodec: CodecInfo | null; // from ffprobe
    audioCodec: CodecInfo | null; // from ffprobe (if present)
};

type HlsMetadata = {
    name: string;
    outputDir: string;
    hls: {
        master: string;
        variants: VariantInfo[];
    };
    progressive: {
        path: string;
        sizeBytes: number | null;
        measuredKbps: number | null; // via ffprobe
        durationSeconds: number | null;
        width: number | null;
        height: number | null;
        fps: number | null;
        videoCodec: CodecInfo | null;
        audioCodec: CodecInfo | null;
    };
};

const readLines = async (file: string): Promise<string[]> =>
    (await fs.readFile(file, "utf8")).split(/\r?\n/);

const statSize = async (file: string): Promise<number> => {
    try {
        const s = await fs.stat(file);
        return s.isFile() ? s.size : 0;
    } catch {
        return 0;
    }
};

const parseAttrs = (line: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const re = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^",\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
        const key = m[1];
        let val = m[2];
        if (val.startsWith('"') && val.endsWith('"')) {
            try { val = JSON.parse(val); } catch { val = val.slice(1, -1); }
        }
        attrs[key] = val;
    }
    return attrs;
};

const parseResolution = (res: string | null): { w: number | null; h: number | null } => {
    if (!res) return { w: null, h: null };
    const m = /^(\d+)x(\d+)$/.exec(res);
    if (!m) return { w: null, h: null };
    return { w: Number(m[1]), h: Number(m[2]) };
};

const parseFraction = (f?: string | null): number | null => {
    if (!f) return null;
    if (/^\d+(\.\d+)?$/.test(f)) return Number(f);
    const m = /^(\d+)\/(\d+)$/.exec(f);
    if (m) {
        const num = Number(m[1]), den = Number(m[2]);
        if (den !== 0) return num / den;
    }
    return null;
};

const sumVariantDurAndBytes = async (variantPlaylistAbs: string): Promise<{ totalMs: number; totalBytes: number }> => {
    const dir = node_path.dirname(variantPlaylistAbs);
    const lines = await readLines(variantPlaylistAbs);
    let totalMs = 0;
    let totalBytes = await statSize(variantPlaylistAbs); // include playlist file too

    const segs: string[] = [];
    for (const line of lines) {
        if (line.startsWith("#EXTINF:")) {
            const num = line.slice("#EXTINF:".length).split(",")[0]?.trim();
            const sec = Number(num);
            if (!Number.isNaN(sec)) totalMs += Math.round(sec * 1000);
        } else if (line && !line.startsWith("#")) {
            segs.push(line.trim());
        }
    }

    for (const rel of segs) {
        const segAbs = node_path.resolve(dir, rel);
        totalBytes += await statSize(segAbs);
    }
    return { totalMs, totalBytes };
};

const ffprobeJson = async (targetAbs: string): Promise<any | null> => {
    try {
        const j = await $`ffprobe -v error -print_format json -show_format -show_streams ${targetAbs}`.json();
        return j
    } catch {
        return null;
    }
};

const extractVideoCodec = (streams: any[]): CodecInfo | null => {
    const v = streams.find((s) => s.codec_type === "video");
    if (!v) return null;
    return {
        codecName: v.codec_name ?? null,
        codecLongName: v.codec_long_name ?? null,
        profile: v.profile != null ? String(v.profile) : null,
        pixelFormat: v.pix_fmt ?? null,
        level: typeof v.level === "number" ? v.level : null,
        bitRateKbps: v.bit_rate ? Math.round(Number(v.bit_rate) / 1000) : null,
    };
};

const extractAudioCodec = (streams: any[]): CodecInfo | null => {
    const a = streams.find((s) => s.codec_type === "audio");
    if (!a) return null;
    return {
        codecName: a.codec_name ?? null,
        codecLongName: a.codec_long_name ?? null,
        profile: a.profile != null ? String(a.profile) : null,
        sampleRate: a.sample_rate ? Number(a.sample_rate) : null,
        channels: a.channels ?? null,
        bitRateKbps: a.bit_rate ? Math.round(Number(a.bit_rate) / 1000) : null,
    };
};

const fpsFromProbe = (streams: any[]): number | null => {
    const v = streams.find((s) => s.codec_type === "video");
    if (!v) return null;
    return (
        parseFraction(v.avg_frame_rate) ??
        parseFraction(v.r_frame_rate) ??
        null
    );
};

const probeProgressive = async (progressiveAbs: string) => {
    const sizeBytes = await statSize(progressiveAbs);
    const j = await ffprobeJson(progressiveAbs);
    const streams = j?.streams ?? [];
    const format = j?.format ?? null;

    let measuredKbps: number | null = null;
    if (format?.bit_rate && /^\d+$/.test(String(format.bit_rate))) {
        measuredKbps = Math.round(Number(format.bit_rate) / 1000);
    } else {
        const v = streams.find((s: any) => s.codec_type === "video" && s.bit_rate);
        if (v) measuredKbps = Math.round(Number(v.bit_rate) / 1000);
    }

    const durSec =
        (format?.duration && !Number.isNaN(Number(format.duration)))
            ? Math.round(Number(format.duration))
            : null;

    const vstream = streams.find((s: any) => s.codec_type === "video");
    const width = vstream?.width ?? null;
    const height = vstream?.height ?? null;
    const fps = fpsFromProbe(streams);
    const pixelFormat = vstream?.pix_fmt ?? null;

    const videoCodec = extractVideoCodec(streams);
    const audioCodec = extractAudioCodec(streams);

    return {
        sizeBytes: sizeBytes || null,
        measuredKbps,
        durationSeconds: durSec,
        width,
        height,
        fps,
        pixelFormat,
        videoCodec,
        audioCodec,
    };
};

export async function buildHlsMetadata(outDir: string): Promise<HlsMetadata> {
    const outputDir = node_path.resolve(outDir);
    const name = node_path.basename(outputDir);
    const masterAbs = node_path.join(outputDir, "master.m3u8");
    const progressiveAbs = node_path.join(outputDir, "progressive.mp4");

    await fs.access(masterAbs).catch(() => {
        throw new Error(`master.m3u8 not found at ${masterAbs}`);
    });

    const lines = await readLines(masterAbs);
    const variants: VariantInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line?.startsWith("#EXT-X-STREAM-INF:")) continue;

        const attrs = parseAttrs(line);
        const uriRel = (lines[i + 1] || "").trim();
        if (!uriRel || uriRel.startsWith("#")) continue;

        const uriAbs = node_path.resolve(outputDir, uriRel);
        const idGuess = uriRel.split("/")[0] || null;

        const bandwidthKbps =
            attrs.BANDWIDTH && /^\d+$/.test(attrs.BANDWIDTH)
                ? Math.round(Number(attrs.BANDWIDTH) / 1000)
                : null;

        const resolution = attrs.RESOLUTION || null;
        const { w: resW, h: resH } = parseResolution(resolution);
        const frameRateAttr = attrs["FRAME-RATE"] ?? null;
        const frameRate = frameRateAttr ? Number(frameRateAttr) : null;
        const codecs = attrs.CODECS ?? null;

        // Compute duration + size from segments
        let durationSeconds: number | null = null;
        let sizeBytes: number | null = null;
        let avgMeasuredKbps: number | null = null;

        try {
            await fs.access(uriAbs);
            const { totalMs, totalBytes } = await sumVariantDurAndBytes(uriAbs);
            if (totalMs > 0) {
                durationSeconds = Math.round(totalMs / 1000);
                avgMeasuredKbps = Math.round((totalBytes * 8) / (totalMs / 1000) / 1000);
            }
            sizeBytes = totalBytes;
        } catch {
            // keep nulls
        }

        // Enrich via ffprobe on the variant playlist (works for local fMP4 HLS)
        let width = resW, height = resH, fps = frameRate;
        let videoCodec: CodecInfo | null = null;
        let audioCodec: CodecInfo | null = null;

        const j = await ffprobeJson(uriAbs);
        if (j?.streams?.length) {
            const streams = j.streams;
            const v = streams.find((s: any) => s.codec_type === "video");
            if (v) {
                if (!width) width = v.width ?? null;
                if (!height) height = v.height ?? null;
            }
            if (!fps) {
                const f = fpsFromProbe(streams);
                if (f) fps = Math.round((f + Number.EPSILON) * 1000) / 1000; // keep a few decimals
            }
            videoCodec = extractVideoCodec(streams);
            audioCodec = extractAudioCodec(streams);
        }

        variants.push({
            id: idGuess,
            path:uriRel,
            bandwidthKbps,
            avgMeasuredKbps,
            sizeBytes,
            durationSeconds,
            resolution,
            width: width ?? null,
            height: height ?? null,
            fps: fps ?? null,
            codecs,
            videoCodec,
            audioCodec,
        });
    }

    // Progressive info
    const prog = await probeProgressive(progressiveAbs);

    return {
        name,
        outputDir,
        hls: {
            master: masterAbs,
            variants,
        },
        progressive: {
            path: "progressive.mp4",
            sizeBytes: prog.sizeBytes,
            measuredKbps: prog.measuredKbps,
            durationSeconds: prog.durationSeconds,
            width: prog.width,
            height: prog.height,
            fps: prog.fps,
            videoCodec: prog.videoCodec,
            audioCodec: prog.audioCodec,
        },
    };
}

// --- CLI (optional) ----------------------------------------------------------
if (import.meta.main) {
    const outDir = process.argv[2];
    if (!outDir) {
        console.error("Usage: bun hlsMetadata.ts <output-dir>");
        process.exit(2);
    }
    const meta = await buildHlsMetadata(outDir);
    console.log(JSON.stringify(meta));
}
