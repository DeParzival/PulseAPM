import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import 'dotenv/config';


const bucketName = process.env.MINIO_BUCKET_NAME;

if (!process.env.MINIO_ROOT_USER || !process.env.MINIO_ROOT_PASSWORD) {
  throw new Error("[StorageService] Critical Error: MINIO_ROOT_USER or MINIO_ROOT_PASSWORD is not defined in the environment config.");
}

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER || "minioadmin",
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD || "minioadmin",
  },
  forcePathStyle: true, // for MinIO mapping compatibility
});

/**
 * Ensures that the log storage bucket exists before attempting uploads
 */
export async function ensureBucketExists(): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (error: any) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`[StorageService] Created cold-storage bucket: ${bucketName}`);
    } else {
      throw error;
    }
  }
}

/**
 * Uploads a local archived file straight to the MinIO container
 */
export async function uploadArchiveToMinIO(key: string, filePath: string): Promise<void> {
  await ensureBucketExists();
  const fileStream = fs.createReadStream(filePath);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileStream,
      ContentType: "application/gzip",
    })
  );
}