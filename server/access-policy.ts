import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 32;

export async function createPasswordVerification(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifiesPassword(password: string, verification: string): Promise<boolean> {
  const [algorithm, encodedSalt, encodedKey] = verification.split("$");
  if (algorithm !== "scrypt" || !encodedSalt || !encodedKey) return false;

  const expectedKey = Buffer.from(encodedKey, "base64url");
  const actualKey = await scrypt(password, Buffer.from(encodedSalt, "base64url"), KEY_LENGTH) as Buffer;
  return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
}