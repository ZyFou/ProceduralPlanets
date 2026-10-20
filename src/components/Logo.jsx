export function Logo({ size = 24, className = 'landing-logo' }) {
  return (
    <img
      className={className}
      src={`${import.meta.env.BASE_URL}branding/procedural-planets-logo.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ objectFit: 'contain' }}
    />
  );
}
