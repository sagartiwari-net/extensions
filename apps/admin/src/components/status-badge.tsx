import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const s = status.toLowerCase();
  const tone =
    s === 'active' || s === 'ok' || s === 'yes'
      ? 'bg-foreground text-background'
      : s === 'disabled' || s === 'block' || s === 'no'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground';
  return (
    <Badge variant="secondary" className={cn('rounded-full px-2 font-normal capitalize', tone, className)}>
      {status}
    </Badge>
  );
}
