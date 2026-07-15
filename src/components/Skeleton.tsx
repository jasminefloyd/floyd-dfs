export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-3 bg-gray-200 rounded animate-pulse ${className}`} />;
}

export function SkeletonCircle({ className = '' }: { className?: string }) {
  return <div className={`rounded-full bg-gray-200 animate-pulse ${className}`} />;
}

export function PlayerListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading players">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonCircle className="w-10 h-10" />
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
    <div className="space-y-6" role="status" aria-label="Generating lineups">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-6 space-y-3">
          <SkeletonLine className="w-1/4 h-4" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-5/6" />
        </div>
      ))}
    </div>
  );
}
