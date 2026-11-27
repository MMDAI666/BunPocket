import { useId } from "react";

/** 叶片耳印章兔：两片旋转椭圆 + 圆头，眼睛用负空间刻出；单色，随 currentColor。 */
export function BrandMark({ className }: { className?: string }) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `bp-rabbit-${rawId}`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="64"
          height="64"
        >
          <rect width="64" height="64" fill="#fff" />
          <circle cx="25.7" cy="42.8" r="2.8" fill="#000" />
          <circle cx="38.3" cy="42.8" r="2.8" fill="#000" />
        </mask>
      </defs>
      <g fill="currentColor" mask={`url(#${maskId})`}>
        <ellipse
          cx="23.4"
          cy="17.6"
          rx="7.4"
          ry="15"
          transform="rotate(-13 23.4 17.6)"
        />
        <ellipse
          cx="40.6"
          cy="17.6"
          rx="7.4"
          ry="15"
          transform="rotate(13 40.6 17.6)"
        />
        <ellipse cx="32" cy="43.4" rx="18.2" ry="17" />
      </g>
    </svg>
  );
}
