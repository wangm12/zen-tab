export function FaviconStack({ icons }: { icons: string[] }) {
  if (!icons.length) return null;
  return (
    <span className="favicon-stack" aria-hidden="true">
      {icons.map((src) => <img key={src} src={src} alt="" className="favicon-stack-icon" draggable={false} />)}
    </span>
  );
}
