export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-3 animate-pulse rounded bg-slate-200 ${className}`} />;
}

export function SkeletonCircle({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-slate-200 ${className}`} />;
}

export function PlayerListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading players">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonCircle className="h-10 w-10" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-1/3" />
            <SkeletonLine className="w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LineupSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Generating lineups">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <SkeletonLine className="h-4 w-1/4" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-5/6" />
        </div>
      ))}
    </div>
  );
}
