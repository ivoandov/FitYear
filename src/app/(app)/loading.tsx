// Shown instantly on every tab transition while the route segment loads, so
// navigation feels immediate instead of blocking on the RSC payload. Generic
// shape (header + stat strip + a few cards) that reads as "loading" across all
// tabs. B+ tokens: card surfaces lift on bg, input fills pulse as placeholders.
export default function AppLoading() {
  return (
    <div className="flex-1" aria-busy="true" aria-label="Loading">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-lg bg-input" />
          <div className="h-4 w-56 rounded bg-input/70" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border bg-card p-3 shadow-inner-hi space-y-2"
            >
              <div className="h-3 w-16 rounded bg-input/70" />
              <div className="h-6 w-20 rounded bg-input" />
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border bg-card p-5 shadow-inner-hi space-y-3"
            >
              <div className="h-5 w-1/3 rounded bg-input" />
              <div className="h-4 w-2/3 rounded bg-input/70" />
              <div className="h-4 w-1/2 rounded bg-input/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
