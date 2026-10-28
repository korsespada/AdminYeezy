// Подготовка видео поставщика для витрины: MP4 H.264/AAC не больше 1080 px по
// каждой стороне, faststart и JPEG-кадр для постера. Модуль на CommonJS, потому
// что его используют публикация выгрузок (scripts/batch-workflow.js) и загрузка
// файла в форме товара (lib/product-media-upload.ts).

const { spawn } = require('child_process');
const fs = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const VIDEO_MAX_SIDE = 1080;
// CRF 26 у 1080p даёт примерно 2–4 Мбит/с. Ролик с битрейтом выше дешевле один
// раз перекодировать, чем отдавать покупателям тяжёлую копию.
const REMUX_MAX_BITRATE = 6_000_000;

// Второй scale выравнивает стороны до чётных: у вертикальных роликов
// (например 1080x1770) первый scale даёт 659 пикселей ширины, а libx264
// с yuv420p отказывается работать с нечётными размерами.
const SCALE_FILTER = `scale=w='min(${VIDEO_MAX_SIDE},iw)':h='min(${VIDEO_MAX_SIDE},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;

function ffmpegPath() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function ffprobePath() {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    let stdout = '';
    let stderr = '';
    if (options.captureStdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} завершился с кодом ${code}: ${stderr.trim()}`));
    });
  });
}

/** Скачивает ролик потоком прямо на диск, не держа его целиком в памяти. */
async function downloadVideoToFile(url, destination, options = {}) {
  const maxBytes = options.maxBytes || 150 * 1024 * 1024;
  const limitLabel = `видео больше ${Math.round(maxBytes / 1024 / 1024)} МБ`;
  const parsed = new URL(String(url));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('для видео разрешены только HTTP(S) ссылки');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(options.timeoutMs || 60_000) });
  if (!response.ok) throw new Error(`источник видео вернул HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw new Error(limitLabel);
  if (!response.body) throw new Error('источник вернул пустое видео');

  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(limitLabel));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(destination));
  if (!received) throw new Error('источник вернул пустое видео');
  return received;
}

async function probeVideo(sourcePath) {
  const stdout = await runProcess(ffprobePath(), [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', sourcePath,
  ], { captureStdout: true });
  return JSON.parse(stdout);
}

function videoRotation(stream) {
  const sideData = (Array.isArray(stream?.side_data_list) ? stream.side_data_list : [])
    .find((entry) => entry && entry.rotation !== undefined);
  const rotation = Number(sideData ? sideData.rotation : stream?.tags?.rotate || 0) || 0;
  return ((rotation % 360) + 360) % 360;
}

/**
 * Ролик можно только переупаковать, если он уже совпадает с результатом
 * перекодирования: H.264 8 бит 4:2:0, чётные стороны не больше 1080 px, без
 * поворота в метаданных, звук только AAC и умеренный битрейт.
 */
function canRemuxVideo(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  // `-map 0:v:0` берёт первый видеопоток, даже если это обложка-картинка.
  const video = streams.find((stream) => stream?.codec_type === 'video');
  if (!video || video.disposition?.attached_pic) return false;
  if (video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p') return false;
  const width = Number(video.width);
  const height = Number(video.height);
  if (!(width > 0 && height > 0) || width > VIDEO_MAX_SIDE || height > VIDEO_MAX_SIDE) return false;
  if (width % 2 || height % 2) return false;
  if (videoRotation(video) !== 0) return false;
  if (streams.some((stream) => stream?.codec_type === 'audio' && stream.codec_name !== 'aac')) return false;
  const bitRate = Number(probe?.format?.bit_rate || 0);
  return bitRate > 0 && bitRate <= REMUX_MAX_BITRATE;
}

function videoOutputArgs(sourcePath, outputPath, remux) {
  const codecArgs = remux
    ? ['-c', 'copy']
    : [
      '-vf', SCALE_FILTER,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k',
    ];
  return ['-y', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a?', ...codecArgs, '-movflags', '+faststart', outputPath];
}

function posterArgs(videoPath, posterJpegPath) {
  return ['-y', '-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '3', posterJpegPath];
}

/**
 * Готовит MP4 и JPEG-кадр постера. Подходящий ролик переупаковывается без
 * перекодирования; если ffprobe недоступен или переупаковка не удалась, ролик
 * перекодируется.
 */
async function transcodeVideoForWeb(sourcePath, outputPath, posterJpegPath) {
  let remux = false;
  try {
    remux = canRemuxVideo(await probeVideo(sourcePath));
  } catch (error) {
    console.warn(`ffprobe не прочитал видео, оно будет перекодировано: ${String(error?.message || error).slice(0, 500)}`);
  }
  try {
    await runProcess(ffmpegPath(), videoOutputArgs(sourcePath, outputPath, remux));
  } catch (error) {
    if (!remux) throw error;
    remux = false;
    await runProcess(ffmpegPath(), videoOutputArgs(sourcePath, outputPath, false));
  }
  await runProcess(ffmpegPath(), posterArgs(outputPath, posterJpegPath));
  return { mode: remux ? 'remux' : 'transcode' };
}

module.exports = {
  REMUX_MAX_BITRATE,
  VIDEO_MAX_SIDE,
  canRemuxVideo,
  downloadVideoToFile,
  posterArgs,
  probeVideo,
  transcodeVideoForWeb,
  videoOutputArgs,
};
