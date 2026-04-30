import { avatarColor, initials } from '@/lib/avatar';

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const { bg, text } = avatarColor(name);
  const fontSize = size <= 28 ? 10 : size <= 36 ? 12 : 14;
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold border-2 border-bg2 shadow-xs shrink-0"
      style={{ width: size, height: size, background: bg, color: text, fontSize }}
    >
      {initials(name)}
    </div>
  );
}
