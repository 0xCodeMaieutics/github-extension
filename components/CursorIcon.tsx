/** A cube-style mark in the spirit of Cursor's logo; follows the text color. */
export function CursorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" opacity="0.55" d="M12 2 3.5 7v10L12 22l8.5-5V7L12 2Z" />
      <path fill="currentColor" d="M12 2 3.5 7 12 12l8.5-5L12 2Z" />
      <path fill="currentColor" opacity="0.8" d="M12 12v10l8.5-5V7L12 12Z" />
    </svg>
  );
}
