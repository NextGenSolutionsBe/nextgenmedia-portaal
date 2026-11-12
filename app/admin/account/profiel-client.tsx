'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Camera, Trash2, Save, Mail, KeyRound, Eye, EyeOff } from 'lucide-react'
import { geldigEmail, wachtwoordFout, MIN_WACHTWOORD } from '@/lib/account'

type Profiel = { voornaam: string; achternaam: string; email: string; fotoVersie: string | null; oprichter?: boolean }

const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15'

async function vraag<T>(url: string, init: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

/** Vierkant bijsnijden en verkleinen tot 512 px, in de browser. */
async function maakVierkant(f: File): Promise<Blob> {
  const beeld = await createImageBitmap(f)
  const zijde = Math.min(beeld.width, beeld.height)
  const doel = Math.min(512, zijde)
  const c = document.createElement('canvas')
  c.width = doel; c.height = doel
  c.getContext('2d')?.drawImage(beeld, (beeld.width - zijde) / 2, (beeld.height - zijde) / 2, zijde, zijde, 0, 0, doel, doel)
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.88))
  if (!blob) throw new Error('Deze foto kon niet verwerkt worden.')
  return blob
}

export function ProfielClient() {
  const router = useRouter()
  const [p, setP] = useState<Profiel | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [voornaam, setVoornaam] = useState('')
  const [achternaam, setAchternaam] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const [fotoKapot, setFotoKapot] = useState(false)
  const kies = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [pwEmail, setPwEmail] = useState('')
  const [huidig, setHuidig] = useState('')
  const [nieuw, setNieuw] = useState('')
  const [nogEens, setNogEens] = useState('')
  const [toon, setToon] = useState(false)

  useEffect(() => {
    vraag<{ profiel: Profiel }>('/api/admin/account/profiel', { cache: 'no-store' })
      .then((j) => { setP(j.profiel); setVoornaam(j.profiel.voornaam); setAchternaam(j.profiel.achternaam) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [])

  if (fout) return <div className="card-base text-sm text-red-600">{fout}</div>
  if (!p) return <div className="card-base py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  const naamGewijzigd = voornaam.trim() !== p.voornaam || achternaam.trim() !== p.achternaam
  const initiaal = (p.voornaam || p.email || '?').charAt(0).toUpperCase()

  const bewaarNaam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!voornaam.trim() || bezig) return
    setBezig('naam')
    try {
      const j = await vraag<{ profiel: Profiel }>('/api/admin/account/profiel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'naam', voornaam, achternaam }) })
      setP(j.profiel); setVoornaam(j.profiel.voornaam); setAchternaam(j.profiel.achternaam)
      toast.success('Je naam is bewaard.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }

  const nieuweFoto = async (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type)) { toast.error('Kies een JPG, PNG of WebP.'); return }
    setBezig('foto')
    try {
      const blob = await maakVierkant(f)
      const fd = new FormData(); fd.append('foto', new File([blob], 'profiel.jpg', { type: 'image/jpeg' }))
      const j = await vraag<{ fotoVersie: string | null }>('/api/admin/account/foto', { method: 'POST', body: fd })
      setP((x) => (x ? { ...x, fotoVersie: j.fotoVersie } : x)); setFotoKapot(false)
      toast.success('Je profielfoto staat erop.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setBezig(null); if (kies.current) kies.current.value = '' }
  }

  const fotoWeg = async () => {
    if (!confirm('Je profielfoto verwijderen?')) return
    setBezig('foto')
    try {
      await vraag('/api/admin/account/foto', { method: 'DELETE' })
      setP((x) => (x ? { ...x, fotoVersie: null } : x))
      toast.success('Profielfoto verwijderd.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(null) }
  }

  const bewaarEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    const adres = email.trim().toLowerCase()
    if (!geldigEmail(adres)) { toast.error('Dat is geen geldig e-mailadres.'); return }
    if (!confirm(`Je logt voortaan in met ${adres}. Doorgaan?`)) return
    setBezig('email')
    try {
      const j = await vraag<{ email: string }>('/api/admin/account/profiel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'email', email: adres, huidigWachtwoord: pwEmail }) })
      setP((x) => (x ? { ...x, email: j.email } : x)); setEmail(''); setPwEmail('')
      toast.success(`Je logt voortaan in met ${j.email}.`); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Wijzigen mislukt') } finally { setBezig(null) }
  }

  const pwFout = nieuw ? wachtwoordFout(nieuw) : null
  const bewaarWachtwoord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwFout) { toast.error(pwFout); return }
    if (nieuw !== nogEens) { toast.error('De twee nieuwe wachtwoorden zijn niet gelijk.'); return }
    setBezig('wachtwoord')
    try {
      await vraag('/api/admin/account/profiel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'wachtwoord', huidigWachtwoord: huidig, nieuwWachtwoord: nieuw }) })
      setHuidig(''); setNieuw(''); setNogEens('')
      toast.success('Je wachtwoord is gewijzigd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Wijzigen mislukt') } finally { setBezig(null) }
  }

  return (
    <div className="space-y-4">
      <div className="card-base">
        <div className="text-[11px] font-medium text-gray-400 mb-3">Profiel</div>
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="flex sm:flex-col items-center gap-3 shrink-0">
            <div className="h-20 w-20 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-2xl font-semibold overflow-hidden border border-gray-200">
              {p.fotoVersie && !fotoKapot
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/admin/account/foto?v=${encodeURIComponent(p.fotoVersie)}`} alt="Je profielfoto" className="h-full w-full object-cover" onError={() => setFotoKapot(true)} />
                : initiaal}
            </div>
            <div className="flex sm:flex-col gap-1.5">
              <input ref={kies} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => nieuweFoto(e.target.files?.[0])} />
              <button type="button" onClick={() => kies.current?.click()} disabled={!!bezig} className="btn-secondary text-xs h-8">
                {bezig === 'foto' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}{p.fotoVersie ? 'Andere foto' : 'Foto kiezen'}
              </button>
              {p.fotoVersie && (
                <button type="button" onClick={fotoWeg} disabled={!!bezig} className="btn-secondary text-xs h-8 text-red-600"><Trash2 className="h-3.5 w-3.5" />Verwijderen</button>
              )}
            </div>
          </div>
          <form onSubmit={bewaarNaam} className="flex-1 min-w-0 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Voornaam</label>
                <input className={INP} value={voornaam} onChange={(e) => setVoornaam(e.target.value)} autoComplete="given-name" maxLength={80} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Achternaam</label>
                <input className={INP} value={achternaam} onChange={(e) => setAchternaam(e.target.value)} autoComplete="family-name" maxLength={120} />
              </div>
            </div>
            <p className="text-[11px] text-gray-400">Je foto en naam zie je bovenaan de zijbalk. De foto's bij Kies jouw expert en Met wie? in de klantapp beheer je in Personeel.</p>
            <button type="submit" disabled={!naamGewijzigd || !voornaam.trim() || !!bezig} className="btn-primary">
              {bezig === 'naam' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Naam bewaren
            </button>
          </form>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <form onSubmit={bewaarEmail} className="card-base space-y-3">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Mail className="h-4 w-4 text-gray-400" />E-mailadres</h2>
            <p className="text-sm text-gray-500 mt-0.5">Hiermee log je in. Nu: <b className="font-medium text-gray-800 break-all">{p.email}</b></p>
            {p.oprichter && <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-2">Let op: je goedkeuring als zaakvoerder in Aankopen hangt aan dit adres. Wissel je, laat dan ook die lijst in de app aanpassen.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nieuw e-mailadres</label>
            <input className={INP} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="naam@nextgenmedia.be" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Huidig wachtwoord</label>
            <input className={INP} type="password" value={pwEmail} onChange={(e) => setPwEmail(e.target.value)} autoComplete="current-password" />
          </div>
          <button type="submit" disabled={!email.trim() || !pwEmail || !!bezig} className="btn-primary">
            {bezig === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}E-mailadres wijzigen
          </button>
        </form>

        <form onSubmit={bewaarWachtwoord} className="card-base space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2"><KeyRound className="h-4 w-4 text-gray-400" />Wachtwoord</h2>
              <p className="text-sm text-gray-500 mt-0.5">Minstens {MIN_WACHTWOORD} tekens, met letters en cijfers.</p>
            </div>
            <button type="button" onClick={() => setToon((x) => !x)} className="text-gray-400 hover:text-gray-700 p-1" aria-label={toon ? 'Wachtwoorden verbergen' : 'Wachtwoorden tonen'}>
              {toon ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input type="text" name="username" autoComplete="username" value={p.email} readOnly hidden />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Huidig wachtwoord</label>
            <input className={INP} type={toon ? 'text' : 'password'} value={huidig} onChange={(e) => setHuidig(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nieuw wachtwoord</label>
            <input className={INP} type={toon ? 'text' : 'password'} value={nieuw} onChange={(e) => setNieuw(e.target.value)} autoComplete="new-password" />
            {pwFout && <p className="text-[11px] text-amber-700 mt-1">{pwFout}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nieuw wachtwoord, nog eens</label>
            <input className={INP} type={toon ? 'text' : 'password'} value={nogEens} onChange={(e) => setNogEens(e.target.value)} autoComplete="new-password" />
            {nogEens && nieuw !== nogEens && <p className="text-[11px] text-amber-700 mt-1">Nog niet gelijk.</p>}
          </div>
          <button type="submit" disabled={!huidig || !nieuw || !!pwFout || nieuw !== nogEens || !!bezig} className="btn-primary">
            {bezig === 'wachtwoord' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Wachtwoord wijzigen
          </button>
        </form>
      </div>
    </div>
  )
}
