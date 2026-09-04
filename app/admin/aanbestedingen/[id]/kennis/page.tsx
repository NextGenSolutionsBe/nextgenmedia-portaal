'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, Plus, Trash2, Save, Upload, AlertTriangle, FileText, Euro,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * De kennisbank van één workspace.
 *
 * Dit is alles wat de AI over ons weet. Zonder tarieven hier komt er nooit een
 * prijs uit een analyse, en dat staat ook zo op het scherm — anders zoek je je
 * suf naar waarom elk dossier "geen prijs" toont.
 */

type Kennis = {
  visie: string; ondernemingsnummer: string; adres: string; tekenbevoegde: string
  contact_naam: string; contact_email: string; contact_telefoon: string
}
type Referentie = { id: string; klant: string; wat_we_deden: string; resultaat: string; sector_type: string }
type Tarief = { id: string; dienst: string; tarief: number; eenheid: string; opmerking: string }
type Doc = { id: string; name: string; kind: string; size_bytes: number; tekst_status: string | null; char_count: number }

const LEEG: Kennis = {
  visie: '', ondernemingsnummer: '', adres: '', tekenbevoegde: '',
  contact_naam: '', contact_email: '', contact_telefoon: '',
}

export default function KennisPage() {
  const { id: filterId } = useParams<{ id: string }>()

  const [naam, setNaam] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [kennis, setKennis] = useState<Kennis>(LEEG)
  const [referenties, setReferenties] = useState<Referentie[]>([])
  const [tarieven, setTarieven] = useState<Tarief[]>([])
  const [documenten, setDocumenten] = useState<Doc[]>([])
  const [laden, setLaden] = useState(true)
  const [bewaren, setBewaren] = useState(false)
  const [uploadt, setUploadt] = useState(false)

  const [nieuweRef, setNieuweRef] = useState({ klant: '', wat_we_deden: '', resultaat: '', sector_type: '' })
  const [nieuwTarief, setNieuwTarief] = useState({ dienst: '', tarief: '', eenheid: 'uur', opmerking: '' })
  const bestandRef = useRef<HTMLInputElement>(null)

  const url = `/api/admin/aanbestedingen/kennis?filterId=${encodeURIComponent(filterId)}`

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setNaam(j.workspace?.naam ?? '')
      setIsAdmin(!!j.isAdmin)
      setKennis({ ...LEEG, ...Object.fromEntries(Object.entries(j.kennis ?? {}).map(([k, v]) => [k, v ?? ''])) } as Kennis)
      setReferenties(j.referenties ?? [])
      setTarieven(j.tarieven ?? [])
      setDocumenten(j.documenten ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally {
      setLaden(false)
    }
  }, [url])
  useEffect(() => { load() }, [load])

  const bewaarKennis = async () => {
    setBewaren(true)
    try {
      const r = await fetch('/api/admin/aanbestedingen/kennis', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterId, ...kennis }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success('Bewaard')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setBewaren(false)
    }
  }

  const voegToe = async (body: Record<string, unknown>, opschonen: () => void) => {
    try {
      const r = await fetch('/api/admin/aanbestedingen/kennis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterId, ...body }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      opschonen(); load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt')
    }
  }

  const verwijder = async (type: string, id: string, wat: string) => {
    if (!confirm(`${wat} verwijderen?`)) return
    try {
      const r = await fetch(`${url}&type=${type}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt')
    }
  }

  const upload = async (bestand: File, kind: string) => {
    setUploadt(true)
    try {
      const fd = new FormData()
      fd.append('filterId', filterId); fd.append('kind', kind); fd.append('bestand', bestand)
      const r = await fetch('/api/admin/aanbestedingen/kennis', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      if (j.waarschuwing) toast.warning(j.waarschuwing, { duration: 10_000 })
      else toast.success(`Toegevoegd — ${j.tekens.toLocaleString('nl-BE')} tekens gelezen`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Uploaden mislukt')
    } finally {
      setUploadt(false)
      if (bestandRef.current) bestandRef.current.value = ''
    }
  }

  const veld = (label: string, k: keyof Kennis, plaats = '') => (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        value={kennis[k]} onChange={(e) => setKennis({ ...kennis, [k]: e.target.value })}
        placeholder={plaats} disabled={!isAdmin} className="input-base mt-1 w-full disabled:bg-gray-50"
      />
    </div>
  )

  if (laden) {
    return <div className="card-base text-center py-12 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <div>
        <Link href={`/admin/aanbestedingen/${filterId}`} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 w-fit">
          <ArrowLeft className="h-4 w-4" />{naam || 'Workspace'}
        </Link>
        <h1 className="text-2xl font-bold mt-1">Kennisbank</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Alles wat de AI over ons weet bij het beoordelen en uitwerken van een opdracht.
        </p>
      </div>

      {tarieven.length === 0 && (
        // Dit is de meestgestelde vraag in wording: "waarom staat er nooit een
        // prijs?". Beantwoord hem hier, vóór hij gesteld wordt.
        <div className="card-base bg-amber-50 border-amber-200 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Er staan nog geen tarieven. Zolang die er niet zijn <b>noemt een dossier geen prijs</b> — ook geen
            richtprijs. Dat is met opzet: een verzonnen bedrag in een offerte is erger dan geen bedrag.
          </span>
        </div>
      )}

      {!isAdmin && (
        <div className="card-base bg-gray-50 text-sm text-gray-600">
          Je kan de kennisbank bekijken maar niet wijzigen. Hier staan de tarieven, en die werken door in elke offerte.
        </div>
      )}

      {/* ── Wie wij zijn ────────────────────────────────────────────────── */}
      <div className="card-base space-y-4">
        <h2 className="font-semibold">Wie wij zijn</h2>
        <div>
          <label className="text-sm font-medium">Wat wij doen</label>
          <textarea
            value={kennis.visie} onChange={(e) => setKennis({ ...kennis, visie: e.target.value })}
            rows={6} disabled={!isAdmin}
            placeholder="Wat voor bureau zijn jullie, wat doen jullie wel en wat niet, hoe groot is het team? Hoe concreter, hoe scherper de scores."
            className="input-base mt-1 w-full disabled:bg-gray-50"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {veld('Ondernemingsnummer', 'ondernemingsnummer', 'BE0123456789')}
          {veld('Tekenbevoegde', 'tekenbevoegde', 'Naam en functie')}
        </div>
        {veld('Adres', 'adres')}
        <div className="grid sm:grid-cols-3 gap-3">
          {veld('Contactpersoon', 'contact_naam')}
          {veld('E-mail', 'contact_email')}
          {veld('Telefoon', 'contact_telefoon')}
        </div>
        {isAdmin && (
          <button onClick={bewaarKennis} disabled={bewaren} className="btn-primary disabled:opacity-50">
            {bewaren ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren
          </button>
        )}
      </div>

      {/* ── Tarieven ────────────────────────────────────────────────────── */}
      <div className="card-base space-y-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Euro className="h-4 w-4" />Tarieven</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Een prijs wordt uitsluitend hiermee berekend. Ontbreekt een post, dan zegt het dossier welk tarief het miste.
          </p>
        </div>

        {tarieven.length > 0 && (
          <div className="divide-y divide-gray-100">
            {tarieven.map((t) => (
              <div key={t.id} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.dienst}</div>
                  {t.opmerking && <div className="text-xs text-gray-500">{t.opmerking}</div>}
                </div>
                <div className="text-sm whitespace-nowrap">
                  € {Number(t.tarief).toLocaleString('nl-BE', { minimumFractionDigits: 2 })}
                  <span className="text-gray-400"> / {t.eenheid}</span>
                </div>
                {isAdmin && (
                  <button onClick={() => verwijder('tarief', t.id, t.dienst)}
                    className="h-7 w-7 shrink-0 grid place-items-center rounded-lg hover:bg-red-50 text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_6rem_auto] gap-2 pt-1">
            <input value={nieuwTarief.dienst} onChange={(e) => setNieuwTarief({ ...nieuwTarief, dienst: e.target.value })}
              placeholder="Dienst, bv. Contentproductie" className="input-base" />
            <input value={nieuwTarief.tarief} onChange={(e) => setNieuwTarief({ ...nieuwTarief, tarief: e.target.value })}
              placeholder="95" inputMode="decimal" className="input-base" />
            <input value={nieuwTarief.eenheid} onChange={(e) => setNieuwTarief({ ...nieuwTarief, eenheid: e.target.value })}
              placeholder="uur" className="input-base" />
            <button
              onClick={() => voegToe(
                { type: 'tarief', ...nieuwTarief, tarief: Number(String(nieuwTarief.tarief).replace(',', '.')) },
                () => setNieuwTarief({ dienst: '', tarief: '', eenheid: 'uur', opmerking: '' }),
              )}
              disabled={!nieuwTarief.dienst || !nieuwTarief.tarief}
              className="btn-primary disabled:opacity-40"
            ><Plus className="h-4 w-4" />Toevoegen</button>
          </div>
        )}
      </div>

      {/* ── Referenties ─────────────────────────────────────────────────── */}
      <div className="card-base space-y-3">
        <div>
          <h2 className="font-semibold">Eerdere opdrachten</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Het dossier kiest hieruit de sterkste referenties. Staat er niets, dan verzint hij er ook geen.
          </p>
        </div>

        {referenties.length > 0 && (
          <div className="divide-y divide-gray-100">
            {referenties.map((r) => (
              <div key={r.id} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {r.klant}
                    {r.sector_type && <span className="ml-2 status-badge bg-gray-100 text-gray-500">{r.sector_type}</span>}
                  </div>
                  {r.wat_we_deden && <div className="text-xs text-gray-600 mt-0.5">{r.wat_we_deden}</div>}
                  {r.resultaat && <div className="text-xs text-green-700 mt-0.5">{r.resultaat}</div>}
                </div>
                {isAdmin && (
                  <button onClick={() => verwijder('referentie', r.id, r.klant)}
                    className="h-7 w-7 shrink-0 grid place-items-center rounded-lg hover:bg-red-50 text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="space-y-2 pt-1">
            <div className="grid sm:grid-cols-2 gap-2">
              <input value={nieuweRef.klant} onChange={(e) => setNieuweRef({ ...nieuweRef, klant: e.target.value })}
                placeholder="Klant" className="input-base" />
              <input value={nieuweRef.sector_type} onChange={(e) => setNieuweRef({ ...nieuweRef, sector_type: e.target.value })}
                placeholder="Sector, bv. zorg of lokale overheid" className="input-base" />
            </div>
            <input value={nieuweRef.wat_we_deden} onChange={(e) => setNieuweRef({ ...nieuweRef, wat_we_deden: e.target.value })}
              placeholder="Wat deden we?" className="input-base w-full" />
            <input value={nieuweRef.resultaat} onChange={(e) => setNieuweRef({ ...nieuweRef, resultaat: e.target.value })}
              placeholder="Resultaat, liefst met een cijfer" className="input-base w-full" />
            <button
              onClick={() => voegToe({ type: 'referentie', ...nieuweRef },
                () => setNieuweRef({ klant: '', wat_we_deden: '', resultaat: '', sector_type: '' }))}
              disabled={!nieuweRef.klant} className="btn-primary disabled:opacity-40"
            ><Plus className="h-4 w-4" />Referentie toevoegen</button>
          </div>
        )}
      </div>

      {/* ── Eigen documenten ────────────────────────────────────────────── */}
      <div className="card-base space-y-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" />Eigen documenten</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Portfolio of prijslijst. De tekst wordt er meteen uit gehaald — komt er niets uit, dan hoor je dat direct,
            want dan kan de AI er niets mee.
          </p>
        </div>

        {documenten.length > 0 && (
          <div className="divide-y divide-gray-100">
            {documenten.map((d) => (
              <div key={d.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{d.name}</div>
                  <div className={`text-xs ${d.char_count > 0 ? 'text-gray-500' : 'text-amber-700'}`}>
                    {d.kind} · {(d.size_bytes / 1024).toFixed(0)} kB ·{' '}
                    {d.char_count > 0
                      ? `${d.char_count.toLocaleString('nl-BE')} tekens gelezen`
                      : `geen tekst (${d.tekst_status ?? 'onbekend'})`}
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => verwijder('document', d.id, d.name)}
                    className="h-7 w-7 shrink-0 grid place-items-center rounded-lg hover:bg-red-50 text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input ref={bestandRef} type="file" accept=".pdf,.docx,.xlsx,.zip" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, 'portfolio') }} />
            <button onClick={() => bestandRef.current?.click()} disabled={uploadt}
              className="btn-primary disabled:opacity-50">
              {uploadt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Document toevoegen
            </button>
            <span className="text-xs text-gray-400">pdf, docx, xlsx of zip · max 20 MB</span>
          </div>
        )}
      </div>
    </div>
  )
}
