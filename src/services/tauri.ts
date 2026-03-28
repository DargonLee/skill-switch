import { invoke } from "@tauri-apps/api/core";

/**
 * Rust-style Result type for explicit error handling
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Wrapper around Tauri's invoke with unified error handling
 * All errors are converted to strings for consistency with backend
 */
export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<Result<T>> {
  try {
    const value = await invoke<T>(cmd, args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Unwrap a Result, throwing on error
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(result.error);
}

/**
 * Unwrap a Result with a default value on error
 */
export function unwrapOr<T>(result: Result<T>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}