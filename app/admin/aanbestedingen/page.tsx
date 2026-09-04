'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Stamp, Plus, Loader2, Trash2, RefreshCw, Gauge, FileSearch, BookOpen, Send, Users, Mail, X } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Aanbestedingen — workspaces.
 *
 * Een workspace is een onderwerp met een eigen zoekfilter bij
 * publicprocurement.be. Hangt er een werknemer aan, dan ziet hij hem en krijgt
 * hij de mails; hangt er niemand aan, dan enkel de beheerders.
 */

type Workspace = {
  id: string
  naam: string
  short_link: string
  include_closed: boolean
  eigenaar: string | null
  eigenaar_naam: string | null
  eigenaar_email: string | null
  ontvangers: string[]
  ai_top_x: number
  mail_drempel: number
  auto_enabled: boolean
  auto_dagen: number[]
  auto_uur: number
}

type StaffLid = { id: string; naam: string | null; email: string | null }

type RunInfo = {
  bezig: { id: string; fase: string; stap_nu: number; stap_totaal: number; omschrijving: string; annuleren_gevraagd: boolean } | null
  laatste: { fase: string; status: string; resultaat: string; klaar_op: string | null } | null
}

type Formulier = {
  id?: string
  naam: string
  link: string
  eigenaar: string
  includeClosed: boolean
  aiTopX: number
  mailDrempel: number
  autoEnabled: boolean
  autoDagen: number[]
  autoUur: number
}

const LEEG: Formulier = {
  naam: '', link: '', eigenaar: '', includeClosed: false,
  aiTopX: 25, mailDrempel: 70, autoEnabled: false, autoDagen: [1, 2, 3, 4, 5], autoUur: 5,
}

const DAGEN = [
  { n: 1, k: 'ma' }, { n: 2, k: 'di' }, { n: 3, k: 'wo' }, { n: 4, k: 'do' },
  { n: 5, k: 'vr' }, { n: 6, k: 'za' }, { n: 7, k: 'zo' },
]

export default function AanbestedingenPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [staff, setStaff] = useState<StaffLid[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [form, setForm] = useState<Formulier | null>(null)
  const [bezig, setBezig] = useState(false)
  const [bezigMet, setBezigMet] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, RunInfo>>({})

  /** De lopende taak van één workspace ophalen. Het scherm polst hier zolang
   *  er iets bezig is, ook als je het venster tussendoor gesloten had. */
  const leesRun = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/admin/aanbestedingen/run?filterId=${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      setRuns((v) => ({ ...v, [id]: { bezig: j.bezig ?? null, laatste: j.laatste ?? null } }))
    } catch { /* een mislukte peiling is geen fout om te tonen */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/aanbestedingen/filters', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setWorkspaces(j.workspaces ?? [])
      setStaff(j.staff ?? [])
      setIsAdmin(!!j.isAdmin)
      setHint(j.hint ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally {
      setLaden(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Eén keer bij het laden, en daarna elke drie seconden zolang er ergens iets
  // draait. Staat alles stil, dan stopt het pollen vanzelf.
  useEffect(() => {
    if (workspaces.length === 0) return
    workspaces.forEach((w) => leesRun(w.id))
    const tik = setInterval(() => {
      const actief = workspaces.filter((w) => runs[w.id]?.bezig)
      if (actief.length === 0) return
      actief.forEach((w) => leesRun(w.id))
    }, 3000)
    return () => clearInterval(tik)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, leesRun, JSON.stringify(Object.keys(runs).map((k) => !!runs[k].bezig))])

  const bewerk = (w: Workspace) => setForm({
    id: w.id, naam: w.naam,
    // De opgeslagen code is genoeg om mee te werken; je hoeft de hele deel-link
    // niet opnieuw te plakken.
    link: w.short_link,
    eigenaar: w.eigenaar ?? '',
    includeClosed: w.include_closed,
    aiTopX: w.ai_top_x, mailDrempel: w.mail_drempel,
    autoEnabled: w.auto_enabled, autoDagen: w.auto_dagen ?? [], autoUur: w.auto_uur,
  })

  const bewaar = async () => {
    if (!form) return
    setBezig(true)
    try {
      const r = await fetch('/api/admin/aanbestedingen/filters', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(form.id ? 'Workspace bijgewerkt' : 'Workspace aangemaakt')
      setForm(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setBezig(false)
    }
  }

  const verwijder = async (w: Workspace) => {
    if (!confirm(`Workspace "${w.naam}" verwijderen? Ook de opgehaalde opdrachten en de kennisbank eronder gaan weg.`)) return
    try {
      const r = await fetch(`/api/admin/aanbestedingen/filters?id=${encodeURIComponent(w.id)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success('Verwijderd')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt')
    }
  }

  /** Ophalen kost niets; beoordelen kost een paar cent. Zelfde afhandeling,
   *  maar de melding vertelt wél wat het gekost heeft. */
  const draai = async (w: Workspace, wat: 'ophalen' | 'scoren' | 'analyseren' | 'mailen') => {
    setBezigMet(`${w.id}:${wat}`)
    // Even later beginnen te polsen: de run bestaat pas als de server hem
    // heeft aangemaakt, en anders zie je de balk pas op het einde.
    const start = setTimeout(() => leesRun(w.id), 800)
    try {
      const r = await fetch(`/api/admin/aanbestedingen/${wat}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterId: w.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(j.resultaat ?? 'Klaar')
      // Een half dossier ziet er even net uit als een volledig; die
      // waarschuwing mag dus niet onder de gewone melding verdwijnen.
      if (j.waarschuwing) toast.warning(j.waarschuwing, { duration: 10_000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Mislukt')
    } finally {
      clearTimeout(start)
      setBezigMet(null)
      leesRun(w.id)
    }
  }

  const annuleer = async (w: Workspace) => {
    try {
      const r = await fetch('/api/admin/aanbestedingen/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterId: w.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      // Geen "gestopt!" melden: dat is het nog niet. Zeg wat er echt gebeurt.
      toast.info(j.bericht, { duration: 8000 })
      leesRun(w.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Annuleren mislukt')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Stamp className="h-6 w-6" />Aanbestedingen
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Belgische overheidsopdrachten per onderwerp opvolgen. Eén workspace per thema.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setForm({ ...LEEG })} className="btn-primary shrink-0">
            <Plus className="h-4 w-4" />Nieuwe workspace
          </button>
        )}
      </div>

      {hint && (
        <div className="card-base bg-amber-50 border-amber-200 text-sm text-amber-800">{hint}</div>
      )}

      {laden ? (
        <div className="card-base text-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-400">
          <Stamp className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nog geen workspaces</p>
          <p className="text-xs mt-1">
            Maak er een per onderwerp — bijvoorbeeld Software &amp; IT, Marketing of Advertising.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((w) => (
            <div key={w.id} className="card-base flex flex-col gap-3">
              <Link href={`/admin/aanbestedingen/${w.id}`} className="min-w-0 group">
                <div className="font-medium truncate group-hover:underline">{w.naam}</div>
                <div className="text-xs text-gray-400 truncate">{w.short_link}</div>
              </Link>

              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex items-start gap-1.5">
                  <Users className="h-3.5 w-3.5 shrink-0 mt-px text-gray-400" />
                  <span className="min-w-0 break-words">
                    {w.eigenaar_naam || w.eigenaar_email
                      ? w.eigenaar_naam ?? w.eigenaar_email
                      : <span className="text-gray-400">Geen werknemer — enkel beheerders</span>}
                  </span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0 mt-px text-gray-400" />
                  <span className="min-w-0 break-words">{w.ontvangers.join(', ') || '—'}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="status-badge bg-gray-100 text-gray-600">top {w.ai_top_x}</span>
                <span className="status-badge bg-gray-100 text-gray-600">drempel {w.mail_drempel}</span>
                {w.include_closed && <span className="status-badge bg-gray-100 text-gray-600">incl. afgesloten</span>}
                <span className={`status-badge ${w.auto_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {w.auto_enabled ? `automatisch ${String(w.auto_uur).padStart(2, '0')}u` : 'handmatig'}
                </span>
              </div>

              {(() => {
                const run = runs[w.id]
                if (run?.bezig) {
                  const b = run.bezig
                  const pct = b.stap_totaal > 0 ? Math.round((b.stap_nu / b.stap_totaal) * 100) : null
                  return (
                    <div className="rounded-lg bg-gray-50 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium capitalize">{b.fase}</span>
                        <button
                          onClick={() => annuleer(w)} disabled={b.annuleren_gevraagd}
                          className="h-6 px-2 rounded text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          {b.annuleren_gevraagd ? 'Stopt…' : 'Annuleren'}
                        </button>
                      </div>
                      {/* Zonder totaal geen percentage verzinnen: dan een
                          onbepaalde balk, want een valse 50% is misleidend. */}
                      <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className={`h-full bg-gray-900 ${pct === null ? 'animate-pulse w-1/3' : ''}`}
                          style={pct === null ? undefined : { width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-gray-500 break-words">
                        {b.omschrijving || 'Bezig…'}
                      </div>
                    </div>
                  )
                }
                if (run?.laatste?.resultaat) {
                  const l = run.laatste
                  const kleur = l.status === 'mislukt' ? 'text-red-600'
                    : l.status === 'geannuleerd' ? 'text-amber-700' : 'text-gray-500'
                  return (
                    <div className={`text-[11px] ${kleur} break-words`}>
                      <span className="capitalize">{l.fase}</span>: {l.resultaat}
                    </div>
                  )
                }
                return null
              })()}

              <div className="flex items-center gap-1 pt-1 mt-auto border-t border-gray-100 flex-wrap">
                <button
                  onClick={() => draai(w, 'ophalen')} disabled={!!bezigMet || !!runs[w.id]?.bezig}
                  title="Nieuwe opdrachten ophalen bij publicprocurement.be. Kost niets."
                  className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600 flex items-center gap-1 disabled:opacity-50"
                >
                  {bezigMet === `${w.id}:ophalen`
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  Ophalen
                </button>
                <button
                  onClick={() => draai(w, 'scoren')} disabled={!!bezigMet || !!runs[w.id]?.bezig}
                  title="Nieuwe opdrachten laten beoordelen op titel en CPV-code. Kost ongeveer een cent per tien opdrachten."
                  className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600 flex items-center gap-1 disabled:opacity-50"
                >
                  {bezigMet === `${w.id}:scoren`
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Gauge className="h-3.5 w-3.5" />}
                  Beoordelen
                </button>
                <button
                  onClick={() => draai(w, 'analyseren')} disabled={!!bezigMet || !!runs[w.id]?.bezig}
                  title={`De ${w.ai_top_x} best scorende opdrachten vanaf score ${w.mail_drempel} volledig uitwerken, met de bestekken erbij. Kost ongeveer zeven cent per dossier.`}
                  className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600 flex items-center gap-1 disabled:opacity-50"
                >
                  {bezigMet === `${w.id}:analyseren`
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <FileSearch className="h-3.5 w-3.5" />}
                  Uitwerken
                </button>
                <button
                  onClick={() => draai(w, 'mailen')} disabled={!!bezigMet || !!runs[w.id]?.bezig}
                  title={`Eén mail met alles wat nieuw is en score ${w.mail_drempel} of hoger haalt. Over dezelfde opdracht wordt nooit twee keer gemaild.`}
                  className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600 flex items-center gap-1 disabled:opacity-50"
                >
                  {bezigMet === `${w.id}:mailen`
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Send className="h-3.5 w-3.5" />}
                  Mailen
                </button>
                <Link
                  href={`/admin/aanbestedingen/${w.id}/kennis`}
                  title="Wat de AI over ons weet: visie, referenties en tarieven. Zonder tarieven noemt een dossier geen prijs."
                  className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600 flex items-center gap-1"
                >
                  <BookOpen className="h-3.5 w-3.5" />Kennisbank
                </Link>
                {isAdmin && (
                  <>
                    <button onClick={() => bewerk(w)} className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600">
                      Bewerk
                    </button>
                    <button
                      onClick={() => verwijder(w)} title="Verwijderen"
                      className="h-7 w-7 ml-auto flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-semibold">{form.id ? 'Workspace bewerken' : 'Nieuwe workspace'}</h2>
              <button onClick={() => setForm(null)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium">Naam</label>
                <input
                  value={form.naam} onChange={(e) => setForm({ ...form, naam: e.target.value })}
                  placeholder="Software &amp; IT" className="input-base mt-1 w-full"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Filterlink van publicprocurement.be</label>
                <input
                  value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })}
                  placeholder="https://www.publicprocurement.be/…?shortLink=v2-…"
                  className="input-base mt-1 w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Zoek daar op je CPV-codes, deel de zoekopdracht en plak die link hier.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">Werknemer</label>
                <select
                  value={form.eigenaar} onChange={(e) => setForm({ ...form, eigenaar: e.target.value })}
                  className="input-base mt-1 w-full"
                >
                  <option value="">Niemand — enkel beheerders zien dit en krijgen de mails</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.naam || s.email}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Max. analyses per run</label>
                  <input
                    type="number" min={1} max={50} value={form.aiTopX}
                    onChange={(e) => setForm({ ...form, aiTopX: Number(e.target.value) })}
                    className="input-base mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Mail vanaf score</label>
                  <input
                    type="number" min={0} max={100} value={form.mailDrempel}
                    onChange={(e) => setForm({ ...form, mailDrempel: Number(e.target.value) })}
                    className="input-base mt-1 w-full"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" checked={form.includeClosed}
                  onChange={(e) => setForm({ ...form, includeClosed: e.target.checked })}
                />
                Ook afgesloten opdrachten ophalen
                <span className="text-xs text-gray-500">(veel meer resultaten)</span>
              </label>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox" checked={form.autoEnabled}
                    onChange={(e) => setForm({ ...form, autoEnabled: e.target.checked })}
                  />
                  Automatisch ophalen, beoordelen, uitwerken en mailen
                </label>

                {form.autoEnabled && (
                  <div className="space-y-3 pl-6">
                    <div className="flex flex-wrap gap-1">
                      {DAGEN.map((d) => {
                        const aan = form.autoDagen.includes(d.n)
                        return (
                          <button
                            key={d.n} type="button"
                            onClick={() => setForm({
                              ...form,
                              autoDagen: aan
                                ? form.autoDagen.filter((x) => x !== d.n)
                                : [...form.autoDagen, d.n].sort(),
                            })}
                            className={`h-8 w-9 rounded-lg text-xs ${aan ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
                          >
                            {d.k}
                          </button>
                        )
                      })}
                    </div>
                    <div>
                      <label className="text-sm">Niet vóór (Belgische tijd)</label>
                      <input
                        type="number" min={0} max={23} value={form.autoUur}
                        onChange={(e) => setForm({ ...form, autoUur: Number(e.target.value) })}
                        className="input-base mt-1 w-24"
                      />
                      {/* Geen klokslag beloven die we niet kunnen halen: de
                          hosting laat enkel dagelijkse schema's toe. */}
                      <p className="text-xs text-gray-500 mt-1">
                        We kijken twee keer per dag, rond 7u en rond 14u. Zet je hier 14, dan draait hij in
                        de namiddagronde — niet om klokslag twee.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={() => setForm(null)} className="h-9 px-3 rounded-lg text-sm hover:bg-gray-100">
                Annuleren
              </button>
              <button onClick={bewaar} disabled={bezig} className="btn-primary disabled:opacity-50">
                {bezig && <Loader2 className="h-4 w-4 animate-spin" />}
                {form.id ? 'Opslaan' : 'Aanmaken'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
