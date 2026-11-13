import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Auth } from "googleapis";
import { getRedisClient } from "@/server/redis/client";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new AppError(503, errorCodes.serviceUnavailable, "尚未設定有效的憑證加密金鑰。");
  return key;
}

export async function saveGoogleTokens(teacherId: string, tokens: Auth.Credentials): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  const value = [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
  const redis = await getRedisClient();
  await redis.set(`google:credentials:${teacherId}`, value);
}

export async function getGoogleTokens(teacherId: string): Promise<Auth.Credentials> {
  const redis = await getRedisClient();
  const value = await redis.get(`google:credentials:${teacherId}`);
  if (!value) throw new AppError(401, errorCodes.unauthorized, "請先連結 Google 帳戶。");
  try {
    const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as Auth.Credentials;
  } catch {
    throw new AppError(503, errorCodes.serviceUnavailable, "無法讀取 Google 授權，請重新連結帳戶。");
  }
}