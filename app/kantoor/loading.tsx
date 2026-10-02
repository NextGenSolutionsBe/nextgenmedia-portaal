/** Zie app/admin/loading.tsx: dit remt ook de prefetch-storm. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1100px] mx-auto px-4 py-8 animate-pulse space-y-6" aria-busy="true">
        <div className="h-7 w-48 rounded-lg bg-gray-200" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl border border-gray-100 bg-white" />)}
        </div>
        <div className="h-40 rounded-xl border border-gray-100 bg-white" />
      </div>
    </div>
  )
}
