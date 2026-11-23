'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ListFilters({
  query,
  onQuery,
  searchId,
  placeholder,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  searchId: string;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="flex flex-col gap-2 md:max-w-sm md:flex-1">
        <Label htmlFor={searchId}>Search</Label>
        <Input
          id={searchId}
          value={query}
          placeholder={placeholder}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {children}
    </div>
  );
}
