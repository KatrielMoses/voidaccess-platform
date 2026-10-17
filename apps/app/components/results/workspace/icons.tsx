/** Hairline icons for the workspace's small buttons (16px, 1.25 stroke, currentColor). Decorative: aria-hidden. */
const P = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconPlus = () => (
  <svg {...P}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);
export const IconMinus = () => (
  <svg {...P}>
    <path d="M3.5 8h9" />
  </svg>
);
export const IconFit = () => (
  <svg {...P}>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
  </svg>
);
export const IconReset = () => (
  <svg {...P}>
    <path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.8v2.4h2.4" />
  </svg>
);
export const IconImage = () => (
  <svg {...P}>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <path d="M2.5 11l3.2-3.2 2.6 2.6 1.8-1.8 3.4 3.4" />
  </svg>
);
export const IconVector = () => (
  <svg {...P}>
    <path d="M3.5 12.5L8 3.5l4.5 9" />
    <rect x="2" y="11" width="3" height="3" />
    <rect x="11" y="11" width="3" height="3" />
    <rect x="6.5" y="2" width="3" height="3" />
  </svg>
);
export const IconTable = () => (
  <svg {...P}>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <path d="M2.5 6.5h11M2.5 10h11M6.5 3v10" />
  </svg>
);
export const IconSearch = () => (
  <svg {...P}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2l3.3 3.3" />
  </svg>
);
export const IconCollapse = ({ open }: { open: boolean }) => (
  <svg {...P}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M6 2.5v11" />
    <path d={open ? "M10.5 6.2L8.7 8l1.8 1.8" : "M8.7 6.2L10.5 8l-1.8 1.8"} />
  </svg>
);
export const IconPin = ({ on }: { on: boolean }) => (
  <svg {...P}>
    <path d="M6 2.5h4l-.6 4 2.1 2H4.5l2.1-2z" fill={on ? "currentColor" : "none"} />
    <path d="M8 8.5v5" />
  </svg>
);
export const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    {...P}
    width={12}
    height={12}
    style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 200ms" }}
  >
    <path d="M6 4l4 4-4 4" />
  </svg>
);
export const IconFilter = () => (
  <svg {...P}>
    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
  </svg>
);
export const IconBack = () => (
  <svg {...P} width={12} height={12}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </svg>
);
