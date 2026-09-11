import { avatarFor } from '@solder/shared';

interface Props {
  handle: string;
  displayName?: string;
  size?: number;
  ring?: boolean;
}

/** Deterministic, generated from the handle — no uploads, no image hosting. */
export function Avatar({ handle, displayName, size = 44, ring = false }: Props) {
  const avatar = avatarFor(handle, displayName);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: avatar.bg,
        color: avatar.fg,
        fontSize: Math.round(size * 0.38),
        boxShadow: ring ? '0 0 0 3px var(--bg)' : undefined,
      }}
    >
      {avatar.initials}
    </span>
  );
}
