interface BrandMarkProps {
  className?: string;
  size?: number;
}

/** Decorative mark; the adjacent Preshot wordmark supplies the accessible name. */
export function BrandMark({ className = "", size = 32 }: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      draggable={false}
      height={size}
      src={`${import.meta.env.BASE_URL}preshot-mark.svg`}
      width={size}
    />
  );
}
