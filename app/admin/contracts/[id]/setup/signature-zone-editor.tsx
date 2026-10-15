'use client'

import { useState } from 'react'
import { Save, Loader2, Sparkles, Plus, Trash2, Blocks } from 'lucide-react'
import { toast } from 'sonner'
import { FieldOverlayEditor } from './field-overlay-editor'
import { CONTRACT_BLOCKS } from '@/lib/contract-blocks'

interface Zone {
  sig_page: number
  sig_x_pct: number
  sig_y_pct: number
  sig_width: number
  sig_height: number
}

type Field = { label: string; type: string; page_number: number; x: number; y: number; width: number; height: number; required: boolean; placeholder?: string; confidence?: number }
const FIELD_TYPES = ['text', 'email', 'phone', 'date', 'number', 'checkbox', 'signature']

export function SignatureZoneEditor({
  contractId,
  pdfUrl,
  initialZone,
  initialFields = [],
  apiBase,
}: {
  contractId: string
  pdfUrl: string | null
  initialZone: Zone
  initialFields?: Field[]
  /** Basis-API-pad; default contracten. Templates geven hier hun eigen pad mee. */
  apiBase?: string
}) {
  const base = apiBase ?? `/api/admin/contracts/${contractId}`
  const [zone, setZone] = useState<Zone>(initialZone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Field[]>(initialFields)
  const [analyzing, setAnalyzing] = useState(false)
  const [savingFields, setSavingFields] = useState(false)
  // Gedeeld met de PDF-editor: huidige zichtbare pagina + geselecteerd veld.
  // Nieuwe velden landen op de zichtbare pagina en worden meteen geselecteerd.
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)

  const analyze = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch(`${base}/analyze`, { method: 'POST' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setFields(j.fields ?? [])
      if (j.signature) setZone((z) => ({ ...z, sig_page: j.signature.page, sig_x_pct: j.signature.x, sig_y_pct: j.signature.y, sig_width: j.signature.width, sig_height: j.signature.height }))
      toast.success(`${(j.fields ?? []).length} veld(en) gedetecteerd. Controleer en pas aan.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Analyse mislukt') } finally { setAnalyzing(false) }
  }
  const setF = (i: number, patch: Partial<Field>) => setFields((fs) => fs.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  // Volgende vrije y op de gegeven pagina, zodat nieuwe velden niet overlappen.
  const nextY = (fs: Field[], p: number) => {
    const onPage = fs.filter((f) => (f.page_number || 1) === p)
    return Math.min(90, (onPage.length ? Math.max(...onPage.map((f) => f.y)) : 14) + 6)
  }
  // Nieuw veld verschijnt meteen op de ZICHTBARE pagina + wordt geselecteerd,
  // zodat je het direct op de PDF kunt verslepen (DocuSign-stijl).
  const addField = () => {
    setSelected(fields.length)
    setFields((fs) => [...fs, { label: 'Nieuw veld', type: 'text', page_number: page, x: 10, y: nextY(fs, page), width: 180, height: 22, required: false }])
  }
  const delField = (i: number) => {
    setFields((fs) => fs.filter((_, idx) => idx !== i))
    setSelected((s) => (s === i ? null : s !== null && s > i ? s - 1 : s))
  }
  const addBlock = (blockId: string) => {
    const block = CONTRACT_BLOCKS.find((b) => b.id === blockId)
    if (!block) return
    setSelected(fields.length)
    setFields((fs) => {
      const out = [...fs]
      let y = nextY(fs, page)
      for (const bf of block.fields) {
        out.push({ label: bf.label, type: bf.type, page_number: page, x: 10, y, width: 180, height: 22, required: !!bf.required, placeholder: bf.placeholder })
        y = Math.min(92, y + 6)
      }
      return out
    })
    toast.success(`Blok "${block.name}" toegevoegd (${block.fields.length} velden) op pagina ${page}.`)
  }
  const saveAll = async () => {
    await Promise.all([saveFields(), handleSave()])
  }
  const saveFields = async () => {
    setSavingFields(true)
    try {
      const res = await fetch(`${base}/field-values`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ detected_fields: fields }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Velden opgeslagen.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setSavingFields(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${base}/signature-zone`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zone),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij opslaan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar: AI-analyse + standaardblokken + opslaan */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 max-w-md">Sleep velden en de handtekeningzone rechtstreeks op de PDF. AI helpt detecteren — jij beslist.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={analyze} disabled={analyzing} className="btn-secondary text-sm">{analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Analyseer met AI</button>
          <button onClick={saveAll} disabled={saving || savingFields} className={`btn-primary text-sm ${saved ? '!bg-green-500' : ''}`}>
            {(saving || savingFields) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? 'Opgeslagen!' : 'Alles opslaan'}
          </button>
        </div>
      </div>

      {/* Standaardblokken */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 flex items-center gap-1"><Blocks className="h-3.5 w-3.5" />Standaardblok:</span>
        {CONTRACT_BLOCKS.map((b) => (
          <button key={b.id} onClick={() => addBlock(b.id)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
            + {b.name}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Drag & drop PDF-editor */}
        <FieldOverlayEditor pdfUrl={pdfUrl} fields={fields} setFields={setFields} zone={zone} setZone={setZone} page={page} setPage={setPage} selected={selected} setSelected={setSelected} />

        {/* Veldenlijst (labels, types, verplicht) — posities komen van het slepen */}
        <div className="card-base h-fit">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="font-semibold text-gray-900">Velden ({fields.length})</h2>
            <button onClick={addField} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Veld toevoegen</button>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{error}</div>}
          {fields.length === 0 ? (
            <p className="text-sm text-gray-400">Nog geen velden. Klik op <b>Analyseer met AI</b>, voeg een <b>standaardblok</b> toe of voeg handmatig een veld toe.</p>
          ) : (
            <div className="space-y-2">
              {fields.map((f, i) => {
                const lowConf = typeof f.confidence === 'number' && f.confidence < 0.6
                return (
                <div
                  key={i}
                  onClick={() => { setSelected(i); setPage(f.page_number || 1) }}
                  className={`space-y-1 rounded-lg p-1.5 -m-1.5 cursor-pointer transition-colors ${selected === i ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'}`}
                >
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <input className="col-span-12 sm:col-span-5 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" value={f.label} onChange={(e) => setF(i, { label: e.target.value })} placeholder="Label" />
                    <select className="col-span-5 sm:col-span-3 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" value={f.type} onChange={(e) => setF(i, { type: e.target.value })}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    <input type="number" min="1" title="Pagina" className="col-span-3 sm:col-span-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" value={f.page_number} onChange={(e) => setF(i, { page_number: Math.max(1, Number(e.target.value)) })} />
                    <label className="col-span-3 sm:col-span-2 text-[11px] text-gray-600 flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={(e) => setF(i, { required: e.target.checked })} />verpl.</label>
                    <button onClick={(e) => { e.stopPropagation(); delField(i) }} className="col-span-1 h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400 justify-self-end" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  {lowConf && <div className="text-[10px] text-amber-600 pl-1">⚠ Lage zekerheid — controle aanbevolen</div>}
                </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3">Posities en grootte stel je in door op de PDF te slepen. De ontvanger vult deze velden in bij ondertekening.</p>
        </div>
      </div>
    </div>
  )
}
