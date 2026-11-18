import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  width?: number;
}

function Svg({ size = 22, color = 'currentColor', width = 2, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg width={2.2} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0" />
  </Svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const WalletIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M16 12.5h2M3 10h18" />
  </Svg>
);

export const FamilyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.6 5.2" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg width={2.4} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const TimerIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9 2h6" />
  </Svg>
);

export const CameraIcon = (p: IconProps) => (
  <Svg width={1.8} {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12l16-8-6 16-3-7z" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1.5" />
    <rect x="14" y="4" width="6" height="6" rx="1.5" />
    <rect x="4" y="14" width="6" height="6" rx="1.5" />
    <rect x="14" y="14" width="6" height="6" rx="1.5" />
  </Svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5h16v10.5H9l-5 4z" />
    <path d="M8.5 9.5h7M8.5 12.5h4.5" />
  </Svg>
);

/** "People I check": a person with a tick. */
export const VerifyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.4M15 17.5l2.2 2.2 4.3-4.7" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </Svg>
);

/** The iPhone share button (box with an arrow). */
export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
  </Svg>
);

export const AddSquareIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Svg>
);

/** The Verify tab: a clipboard with a tick. */
export const ProveIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2.5" />
    <path d="M9 3.5h6v3H9zM9 13.5l2.2 2.2 4.3-4.7" />
  </Svg>
);
