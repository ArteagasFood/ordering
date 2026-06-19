import argon2 from 'argon2';

/**
 * Password hashing (TDD §4.1). We use Argon2id — the memory-hard, side-channel-
 * resistant winner of the Password Hashing Competition — with a per-hash random salt
 * that argon2 embeds in the encoded output. Plaintext is never stored or logged.
 *
 * The cost parameters below are deliberately conservative defaults suitable for an
 * interactive login; they can be tuned upward as hardware allows without changing
 * stored hashes (the parameters are encoded in each hash, so `verify` stays correct).
 */
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Hash a plaintext password. Precondition: `plain` is a non-empty string. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a stored encoded hash. Returns false (never
 * throws) on a malformed hash, so a corrupt row cannot crash the login path.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
