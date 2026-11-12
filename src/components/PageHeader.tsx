/** Shared page header: mono eyebrow, serif H1, one-line subtitle, actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  aside,
  actions,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-4xl">{title}</h1>
          {aside}
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
