export default function Logo({ size = 32 }: { size?: number }) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="80" height="80" rx="16" fill="var(--fill-accent)" />
      {/* Bars */}
      <rect x="10" y="52" width="10" height="20" rx="2" fill="rgba(255,255,255,0.45)" />
      <rect x="24" y="42" width="10" height="30" rx="2" fill="rgba(255,255,255,0.62)" />
      <rect x="38" y="30" width="10" height="42" rx="2" fill="rgba(255,255,255,0.80)" />
      <rect x="52" y="16" width="10" height="56" rx="2" fill="rgba(255,255,255,1)" />
      {/* Trend line */}
      <polyline
        points="15,50 29,40 43,28 57,14"
        fill="none"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="15" cy="50" r="2.5" fill="white" />
      <circle cx="29" cy="40" r="2.5" fill="white" />
      <circle cx="43" cy="28" r="2.5" fill="white" />
      <circle cx="57" cy="14" r="3.5" fill="white" />
    </svg>
  );
}
