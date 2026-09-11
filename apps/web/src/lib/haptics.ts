type Pattern = 'tap' | 'success' | 'error';

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,
  success: [12, 40, 24],
  error: [30, 60, 30],
};

/** Small physical confirmations; silently absent where unsupported. */
export function haptic(pattern: Pattern = 'tap'): void {
  try {
    navigator.vibrate?.(PATTERNS[pattern]);
  } catch {
    // Vibration is a nicety, never a requirement.
  }
}
