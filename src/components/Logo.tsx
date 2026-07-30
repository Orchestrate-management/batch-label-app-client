
type LogoProps = {
  variant?: 'primary' | 'reversed';
  showWordmark?: boolean;
  size?: number;
  className?: string;
};

export function Logo({
  variant = 'primary',
  showWordmark = true,
  size = 32,
  className = ''
}: LogoProps) {
  const reversed = variant === 'reversed';
  const plate = reversed ? '#F3EEE6' : '#14514F';
  const rule = reversed ? '#14514F' : '#F3EEE6';
  const accent = reversed ? '#B4674A' : '#E5A183';

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role="img"
        aria-label="Batchlabel"
        focusable="false">
        
        <rect x="0" y="0" width="32" height="32" rx="8" fill={plate} />
        <circle cx="9.5" cy="10" r="2.6" fill={rule} />
        <rect x="6.5" y="15.2" width="19" height="2.4" rx="1.2" fill={rule} />
        <rect x="6.5" y="20.6" width="9.5" height="2.4" rx="1.2" fill={accent} />
      </svg>
      {showWordmark &&
      <span
        className="font-display text-[1.05rem] font-semibold tracking-tight"
        style={{ color: reversed ? '#F3EEE6' : '#14514F' }}>
        
          Batchlabel
        </span>
      }
    </span>);

}