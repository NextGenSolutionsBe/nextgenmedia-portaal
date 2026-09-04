export function Kpi({ label, value, sub, color, Icon }: {
  label: string; value: string; sub?: string; color?: string; Icon?: React.ElementType
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
        {Icon && <Icon className={`h-4 w-4 ${color ?? 'text-gray-400'}`} />}
      </div>
      <div className={`text-2xl font-bold ${color ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{children}</div>
}
