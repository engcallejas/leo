import type { SVGProps } from "react";

/**
 * Small stroke icons (Lucide-style) so the UI uses a consistent icon system
 * instead of emoji. 1.6px stroke, currentColor, 18px default.
 */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const IconTerminal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m7 9 3 3-3 3" />
    <path d="M13 15h4" />
    <rect x="3" y="4" width="18" height="16" rx="2" />
  </svg>
);

export const IconChat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1.1-4.3A8 8 0 1 1 21 12Z" />
  </svg>
);

export const IconIterate = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M21 8a8 8 0 0 0-14.3-3.3L3 8" />
    <path d="M3 4v4h4" />
    <path d="M3 16a8 8 0 0 0 14.3 3.3L21 16" />
    <path d="M21 20v-4h-4" />
  </svg>
);

export const IconDoc = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M9 13h6M9 17h4" />
  </svg>
);

export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </svg>
);

export const IconQuestion = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconArrowLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const IconPaperclip = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7L10 18" />
  </svg>
);

/* ---- nav icons ---- */
export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconBox = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

export const IconClipboard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4a3 3 0 0 1 6 0" />
    <path d="M9 11h6M9 15h4" />
  </svg>
);

export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 3v5M15 3v5" />
    <path d="M7 8h10v3a5 5 0 0 1-10 0V8Z" />
    <path d="M12 16v5" />
  </svg>
);

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 5.5v13l11-6.5-11-6.5Z" />
  </svg>
);

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.2A1.6 1.6 0 0 0 6.8 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1-2.7H3a2 2 0 0 1 0-4h.2A1.6 1.6 0 0 0 5 6.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
  </svg>
);

/**
 * Leo wordmark mark — the Leo constellation (the "sickle" + tail triangle)
 * rendered as connected stars. Distinctive, ties to the name, not a generic
 * geometric monogram. Stars use currentColor; pass a color via style/props.
 */
export const LeoMark = (p: SVGProps<SVGSVGElement>) => (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    {...p}
  >
    {/* connecting lines */}
    <path
      d="M5 15.5 6 10l2.3-3.6L12 5.2l2.8 2.1-1 4.3 4.2 2.2-5.1 3.4-3.9-2Z"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      strokeLinecap="round"
      opacity={0.4}
    />
    {/* stars */}
    <circle cx="5" cy="15.5" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="6" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="8.3" cy="6.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="5.2" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="7.3" r="1" fill="currentColor" stroke="none" />
    <circle cx="13.8" cy="11.6" r="1" fill="currentColor" stroke="none" />
    <circle cx="18" cy="13.8" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12.9" cy="17.2" r="1" fill="currentColor" stroke="none" />
  </svg>
);
