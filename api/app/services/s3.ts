import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream, statSync } from 'node:fs'
import env from '#start/env'

const client = new S3Client({
  endpoint: env.get('S3_ENDPOINT'),
  region: env.get('S3_REGION', 'us-east-1'),
  credentials: {
    accessKeyId: env.get('S3_ACCESS_KEY'),
    secretAccessKey: env.get('S3_SECRET_KEY'),
  },
  forcePathStyle: true, // Required for Minio
})

const bucket = env.get('S3_BUCKET')

/** Upload a local file to S3 */
export async function uploadFile(key: string, filePath: string, contentType?: string): Promise<void> {
  const body = createReadStream(filePath)
  const size = statSync(filePath).size

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: size,
      ContentType: contentType,
    })
  )
}

/** Generate a presigned GET URL */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  )
}

/** Generate a presigned GET URL with Content-Disposition for downloads */
export async function getPresignedDownloadUrl(
  key: string,
  downloadName: string,
  expiresIn = 3600
): Promise<string> {
  const safeName = downloadName.replace(/["\r\n]/g, '_')
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    }),
    { expiresIn }
  )
}

/** Delete an object from S3 */
export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

/** List object keys under a prefix */
export async function listObjects(prefix: string): Promise<string[]> {
  const result = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
  )
  return (result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean)
}

/** Check if an object exists and get its size */
export async function headObject(key: string): Promise<{ contentLength: number } | null> {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    )
    return { contentLength: result.ContentLength ?? 0 }
  } catch {
    return null
  }
}
