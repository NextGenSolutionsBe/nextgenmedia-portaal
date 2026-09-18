'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, X, Trash2, Rocket, Pencil, Database, RefreshCw, Upload, ImageIcon, Settings2, Check } from 'lucide-react'
import { toast } from 'sonner'

type Field = { id: string; name: string; type: string; editable?: boolean; options?: { id: string; name: string }[] }
type Collection = { id: string; framer_collection_id: string; name: string; slug: string | null; fields: Field[]; item_count: number }
type Item = { id: string; collection_id: string; framer_item_id: string | null; slug: string | null; field_data: Record<string, string>; status: string }

const STATUS_STYLE: Record<string, string> = {
  synced: 'bg-green-50 text-green-700 border-green-200',
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  dirty: 'bg-amber-50 text-amber-700 border-amber-200',
}
const STATUS_LABEL: Record<string, string> = { synced: 'Live', new: 'Nieuw', dirty: 'Gewijzigd' }

export function PortalCms() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [editItem, setEditItem] = useState<Item | 'new' | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [manageFields, setManageFields] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/portal/cms')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setCollections(j.collections ?? [])
      setItems(j.items ?? [])
      setActive((prev) => prev || (j.collections?.[0]?.id ?? ''))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const activeCol = collections.find((c) => c.id === active) ?? null
  // Verwijderde items niet tonen in de lijst, maar wél als openstaande wijziging tellen.
  const colItems = useMemo(() => items.filter((i) => i.collection_id === active && i.status !== 'deleted'), [items, active])
  const pendingCount = items.filter((i) => i.status === 'new' || i.status === 'dirty' || i.status === 'deleted').length
  const pendingDeletes = items.filter((i) => i.status === 'deleted').length

  const publish = async () => {
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch('/api/portal/cms/publish', { method: 'POST' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      if (j.publishWarning) toast.warning(j.publishWarning, { duration: 8000 })
      else toast.success('Je wijzigingen zijn gepubliceerd en gaan live.')
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Publiceren mislukt'
      setPublishError(msg)
      toast.error(msg)
    } finally { setPublishing(false) }
  }

  const sync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/portal/cms/sync', { method: 'POST' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Actuele inhoud opgehaald van je website.')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verversen mislukt') } finally { setSyncing(false) }
  }

  const remove = async (item: Item) => {
    if (!confirm('Dit item verwijderen?')) return
    try {
      const res = await fetch(`/api/portal/cms/item?id=${item.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Laden…</div>
  if (collections.length === 0) return <div className="card-base text-sm text-gray-500">Er zijn nog geen bewerkbare collecties. Neem contact op met NextGenMedia.</div>

  const previewFields = (activeCol?.fields ?? []).slice(0, 3)

  return (
    <div className="space-y-4">
      {/* Collectie-tabs + publiceren */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {collections.map((c) => (
            <button key={c.id} onClick={() => setActive(c.id)}
              className={`text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${active === c.id ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>
              <Database className="h-3.5 w-3.5" />{c.name || '(naamloos)'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setManageFields(true)} disabled={!activeCol} className="btn-secondary text-sm" title="Velden van deze collectie beheren">
            <Settings2 className="h-4 w-4" />Velden
          </button>
          <button onClick={sync} disabled={syncing} className="btn-secondary text-sm" title="Actuele inhoud ophalen van je website">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Ververs
          </button>
          <button onClick={publish} disabled={publishing || pendingCount === 0}
            className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            title={pendingCount === 0 ? 'Geen wijzigingen om te publiceren' : 'Wijzigingen live zetten'}>
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Opslaan &amp; publiceren{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        </div>
      </div>

      {/* Publiceer-fout (blijft staan tot volgende poging) */}
      {publishError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-medium mb-0.5">Publiceren gaf een fout terug</div>
          <div className="break-words whitespace-pre-wrap font-mono text-[12px]">{publishError}</div>
        </div>
      )}

      {/* Items */}
      <div className="card-base p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-medium">
            {colItems.length} item(s)
            {pendingDeletes > 0 && <span className="ml-2 text-xs font-normal text-red-500">· {pendingDeletes} verwijderd (wacht op publiceren)</span>}
          </span>
          <button onClick={() => setEditItem('new')} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Nieuw item</button>
        </div>
        {colItems.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">Nog geen items. Klik op “Nieuw item”.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {colItems.map((it) => (
              <div key={it.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{it.field_data[previewFields[0]?.id] || it.slug || '(geen titel)'}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {previewFields.slice(1).map((f) => it.field_data[f.id]).filter(Boolean).join(' · ') || it.slug}
                  </div>
                </div>
                <span className={`status-badge border text-[10px] shrink-0 ${STATUS_STYLE[it.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[it.status] ?? it.status}</span>
                <button onClick={() => setEditItem(it)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(it)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400">Wijzigingen worden bewaard als concept tot je op <b>Opslaan &amp; publiceren</b> klikt — dan gaan ze live op je website.</p>

      {manageFields && activeCol && (
        <FieldManager collection={activeCol} onClose={() => setManageFields(false)} onChanged={load} />
      )}

      {editItem && activeCol && (
        <ItemEditor
          collection={activeCol}
          item={editItem === 'new' ? null : editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); load() }}
        />
      )}
    </div>
  )
}

// Veldtypes die de klant zelf mag aanmaken — in gewone taal, geen jargon.
const FIELD_TYPES: { type: string; label: string }[] = [
  { type: 'string', label: 'Korte tekst' },
  { type: 'formattedText', label: 'Lange tekst' },
  { type: 'number', label: 'Getal' },
  { type: 'boolean', label: 'Aan/uit' },
  { type: 'date', label: 'Datum' },
  { type: 'image', label: 'Afbeelding' },
  { type: 'file', label: 'Bestand' },
  { type: 'link', label: 'Link' },
  { type: 'color', label: 'Kleur' },
  { type: 'enum', label: 'Keuzelijst' },
]
const typeLabel = (t: string) => FIELD_TYPES.find((f) => f.type === t)?.label ?? t

/** Veldbeheer: velden bekijken, hernoemen, verwijderen en toevoegen.
 *  Velden zijn structuur — die gaan direct naar de website (geen concept). */
function FieldManager({ collection, onClose, onChanged }: {
  collection: Collection
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [fields, setFields] = useState<Field[]>(collection.fields ?? [])
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('string')
  const [newCases, setNewCases] = useState('')

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50'

  const after = async (j: { fields?: Field[] }) => {
    if (Array.isArray(j.fields)) setFields(j.fields)
    await onChanged()
  }

  const addField = async () => {
    if (!newName.trim()) { toast.error('Geef het veld een naam'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/portal/cms/field', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: collection.id, name: newName.trim(), type: newType,
          cases: newType === 'enum' ? newCases.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      await after(j)
      setNewName(''); setNewCases(''); setAdding(false)
      toast.success('Veld toegevoegd op je website.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBusy(false) }
  }

  const saveRename = async (fieldId: string) => {
    if (!renameValue.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/portal/cms/field', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId: collection.id, fieldId, name: renameValue.trim() }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      await after(j)
      setRenaming(null)
      toast.success('Veldnaam aangepast.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Hernoemen mislukt') } finally { setBusy(false) }
  }

  const deleteField = async (f: Field) => {
    if (!confirm(`Veld "${f.name}" verwijderen? De inhoud van dit veld verdwijnt bij alle items op je website.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/portal/cms/field?collectionId=${collection.id}&fieldId=${encodeURIComponent(f.id)}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      await after(j)
      toast.success('Veld verwijderd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Velden — {collection.name || '(naamloos)'}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Wijzigingen aan velden gaan meteen door op je website.</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-2">
          {fields.length === 0 && <p className="text-sm text-gray-500">Deze collectie heeft nog geen velden.</p>}
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              {renaming === f.id ? (
                <>
                  <input className={inp} value={renameValue} autoFocus onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(f.id); if (e.key === 'Escape') setRenaming(null) }} />
                  <button onClick={() => saveRename(f.id)} disabled={busy} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-green-600" title="Opslaan"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setRenaming(null)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500" title="Annuleren"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-[11px] text-gray-500">{typeLabel(f.type)}</div>
                  </div>
                  <button onClick={() => { setRenaming(f.id); setRenameValue(f.name) }} disabled={busy}
                    className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600" title="Hernoemen"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => deleteField(f)} disabled={busy}
                    className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}

          {adding ? (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Naam van het veld</label>
                <input className={inp} value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} placeholder="bijv. Ondertitel" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Soort veld</label>
                <select className={inp} value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
              </div>
              {newType === 'enum' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Keuzes <span className="text-gray-400">— gescheiden door komma&apos;s</span></label>
                  <input className={inp} value={newCases} onChange={(e) => setNewCases(e.target.value)} placeholder="Nieuws, Tips, Overig" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={addField} disabled={busy} className="btn-primary text-sm flex-1">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Veld toevoegen
                </button>
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Annuleer</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="btn-secondary text-sm w-full"><Plus className="h-4 w-4" />Nieuw veld</button>
          )}
        </div>

        <div className="p-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary w-full">Sluiten</button>
        </div>
      </div>
    </div>
  )
}

function ItemEditor({ collection, item, onClose, onSaved }: {
  collection: Collection
  item: Item | null
  onClose: () => void
  onSaved: () => void
}) {
  const [slug, setSlug] = useState(item?.slug ?? '')
  const [values, setValues] = useState<Record<string, string>>(item?.field_data ?? {})
  const [saving, setSaving] = useState(false)

  const set = (id: string, v: string) => setValues((p) => ({ ...p, [id]: v }))
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50'

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/portal/cms/item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item?.id, collectionId: collection.id, slug: slug.trim(), values }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setSaving(false) }
  }

  const editable = collection.fields.filter((f) => f.editable !== false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{item ? 'Item bewerken' : 'Nieuw item'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug (URL) <span className="text-gray-400">— uniek</span></label>
            <input className={inp} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="bijv. mijn-eerste-item" />
          </div>
          {editable.map((f) => (
            <div key={f.id}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{f.name} <span className="text-gray-400">· {f.type}</span></label>
              <FieldInput field={f} value={values[f.id] ?? ''} onChange={(v) => set(f.id, v)} inpClass={inp} />
            </div>
          ))}
          {editable.length === 0 && <p className="text-sm text-gray-400">Deze collectie heeft geen bewerkbare velden.</p>}
        </div>
        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}

function FieldInput({ field, value, onChange, inpClass }: { field: Field; value: string; onChange: (v: string) => void; inpClass: string }) {
  switch (field.type) {
    case 'formattedText':
      return <textarea rows={5} className={inpClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Tekst (HTML mag)" />
    case 'number':
      return <input type="number" className={inpClass} value={value} onChange={(e) => onChange(e.target.value)} />
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={value === 'true' || value === '1'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} /> Aan
        </label>
      )
    case 'enum':
      if (field.options && field.options.length > 0) {
        return (
          <select className={inpClass} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">— kies —</option>
            {field.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )
      }
      return <input type="text" className={inpClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Categorie" />
    case 'date':
      return <input type="date" className={inpClass} value={value?.slice(0, 10) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'color':
      return <input type="color" className="h-9 w-16 rounded border border-gray-200" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
    case 'image':
    case 'file':
      return <MediaField field={field} value={value} onChange={onChange} inpClass={inpClass} />
    case 'link':
      return <input type="url" className={inpClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
    default:
      return <input type="text" className={inpClass} value={value} onChange={(e) => onChange(e.target.value)} />
  }
}

function MediaField({ field, value, onChange, inpClass }: { field: Field; value: string; onChange: (v: string) => void; inpClass: string }) {
  const [uploading, setUploading] = useState(false)
  const isImage = field.type === 'image'

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/portal/cms/upload', { method: 'POST', body: fd })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      onChange(j.url)
      toast.success('Bestand geüpload.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload mislukt') } finally { setUploading(false) }
  }

  return (
    <div className="space-y-2">
      {value && isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="max-h-32 rounded-lg border border-gray-100 object-contain" />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="btn-secondary text-sm cursor-pointer">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {value ? 'Vervangen' : (isImage ? 'Afbeelding uploaden' : 'Bestand uploaden')}
          <input type="file" accept={isImage ? 'image/*' : undefined} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-xs text-gray-400 hover:text-red-500">Verwijderen</button>
        )}
      </div>
      {value && !isImage && <div className="text-[11px] text-gray-500 flex items-center gap-1 truncate"><ImageIcon className="h-3 w-3" />{value}</div>}
      <input type="url" className={inpClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="…of plak een URL" />
    </div>
  )
}
