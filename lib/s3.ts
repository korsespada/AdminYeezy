import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT || '';

export const s3Client = new S3Client({
  endpoint: endpoint,
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true, 
  // У Beget часто лучше указывать forcePathStyle, но если бакет через сабдомен, то false. Оставим true для API.
});

export const bucketName = process.env.S3_BUCKET || '';

/**
 * Upload a buffer to S3
 */
export async function uploadToS3(key: string, buffer: Buffer, contentType: string = 'image/jpeg') {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await s3Client.send(command);
  return getS3PublicUrl(key);
}

/**
 * Get Public URL for a specific S3 key
 */
export function getS3PublicUrl(key: string) {
  // Если задан кастомный домен в .env (например, static.yeezyunique.ru)
  const publicDomain = process.env.S3_PUBLIC_DOMAIN;
  if (publicDomain) {
    const domain = publicDomain.endsWith('/') ? publicDomain.slice(0, -1) : publicDomain;
    return `${domain}/${key}`;
  }

  // Beget обычно предоставляет доступ как https://{bucket_name}.beget.app/{key} 
  // или если напрямую к s3 - https://{bucket}.s3.ru-1.storage.selcloud.ru/{key}
  if (endpoint.includes('selcloud.ru') || endpoint.includes('beget.cloud')) {
    const url = new URL(endpoint);
    return `https://${bucketName}.${url.hostname}/${key}`;
  }
  
  // Если Beget App
  if (endpoint.includes('beget.app')) {
    return `${endpoint}/${key}`;
  }

  // Общий фолбэк для path-style
  return `${endpoint}/${bucketName}/${key}`;
}

/**
 * Delete all files inside a specific "folder" prefix
 */
export async function deleteS3Folder(prefix: string) {
  let isTruncated = true;
  let cursor: string | undefined;

  while (isTruncated) {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: cursor,
    });
    const listResult = await s3Client.send(listCommand);

    if (listResult.Contents && listResult.Contents.length > 0) {
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: listResult.Contents.map((c) => ({ Key: c.Key })),
          Quiet: true,
        },
      });
      await s3Client.send(deleteCommand);
    }

    isTruncated = listResult.IsTruncated || false;
    cursor = listResult.NextContinuationToken;
  }
}
