'use client'

import { useState } from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { ContractPrintButton } from './contract-print-button'

// PDF-voorvertoning met tabs: origineel ↔ getekend/ingevuld. Geen download nodig.
export function ContractPdfPreview({
  originalUrl, signedUrl,
}: { originalUrl: string | null; signedUrl: string | null }) {
  const tabs: { key: 'signed' | 'original'; label: string; url: string | null }[] = [
    { key: 'signed', label: 'Getekend / ingevuld', url: signedUrl },
    { key: 'original', label: 'Origineel', url: originalUrl },
  ].filter((t) => t.url) as { key: 'signed' | 'original'; label: string; url: string | null }[]

  const [active, setActive] = useState<'signed' | 'original'>(signedUrl ? 'signed' : 'original')
  const current = tabs.find((t) => t.key === active) ?? tabs[0]
  const url = current?.url ?? originalUrl

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-400" />
          {tabs.length > 1 ? (
            <div className="flex items-center gap-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium ${active === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-sm font-medium">{tabs[0]?.label ?? 'Contract PDF'}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {active === 'signed' && signedUrl && <ContractPrintButton pdfUrl={signedUrl} />}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              Nieuw tabblad
            </a>
          )}
        </div>
      </div>
      {url ? (
        <iframe src={url} title="Contract" className="w-full bg-gray-50" style={{ height: 'min(70vh, 600px)' }} />
      ) : (
        <div className="flex items-center justify-center h-[400px] text-gray-400">
          <div className="text-center">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Geen PDF beschikbaar</p>
          </div>
        </div>
      )}
    </div>
  )
}
