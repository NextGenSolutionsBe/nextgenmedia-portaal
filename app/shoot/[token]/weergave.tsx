import type { ReactNode } from 'react'
import { Aperture, CalendarDays, Clock, Download, MapPin, Navigation, Phone, Mail, Users, ListChecks, Backpack, Info, FileText } from 'lucide-react'
import { belLink, datumLang, kaartLink, locatieVan, shootNaam, tijdBereik, type Shoot } from '@/lib/shoots/model'

/** Het shootplan zoals de ontvanger het ziet (gsm eerst). `pdf` = de link naar de pdf van deze shoot. */
export function ShootplanWeergave({ s, pdf }: { s: Shoot; pdf: string }) {
  const bijgewerkt = s.updated_at ? new Date(s.updated_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null

  return (
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <div className="text-xs text-gray-500 mb-1 inline-flex items-center gap-1.5"><Aperture className="h-3.5 w-3.5" />Shootplan{s.klant ? ` · ${s.klant}` : ''}</div>
          <h1 className="text-2xl font-bold text-gray-900">{shootNaam(s)}</h1>
          {bijgewerkt && <p className="text-xs text-gray-500 mt-1">Laatst bijgewerkt op {bijgewerkt}. Deze pagina toont altijd de laatste versie.</p>}
        </div>

        {s.status === 'geannuleerd' && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 font-medium">Deze shoot is geannuleerd.</div>
        )}

        <section className="card-base grid sm:grid-cols-2 gap-3">
          <div className="flex items-start gap-3"><CalendarDays className="h-5 w-5 text-gray-400 mt-0.5" /><div><div className="text-xs text-gray-500">Datum</div><div className="font-semibold">{datumLang(s.datum) || 'Nog niet vastgelegd'}</div></div></div>
          <div className="flex items-start gap-3"><Clock className="h-5 w-5 text-gray-400 mt-0.5" /><div><div className="text-xs text-gray-500">Uur</div><div className="font-semibold">{tijdBereik(s.start, s.einde) || 'Zie het programma'}</div></div></div>
          {s.doel && <p className="sm:col-span-2 text-sm text-gray-700 whitespace-pre-wrap border-t border-gray-100 pt-3">{s.doel}</p>}
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <a href={pdf} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm"><FileText className="h-4 w-4" />Pdf bekijken</a>
            <a href={`${pdf}?download=1`} className="btn-secondary text-sm"><Download className="h-4 w-4" />Downloaden</a>
          </div>
        </section>

        {s.programma.length > 0 && (
          <section className="card-base">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" />Programma</h2>
            <ol className="relative border-l-2 border-geel ml-2 space-y-4">
              {s.programma.map((p) => {
                const loc = p.locatie ? locatieVan(s, p.locatie) : null
                return (
                  <li key={p.id} className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-gray-900 ring-2 ring-white" />
                    <div className="text-sm font-bold text-gray-900">{tijdBereik(p.van, p.tot) || 'Later'}</div>
                    {p.wat && <div className="text-sm text-gray-800 whitespace-pre-wrap">{p.wat}</div>}
                    {p.locatie && (
                      <div className="text-xs text-gray-600 mt-1 flex items-center gap-1.5 flex-wrap">
                        <MapPin className="h-3.5 w-3.5" />{p.locatie}{loc?.adres && loc.adres !== p.locatie ? ` · ${loc.adres}` : ''}
                        {loc?.adres && <a href={kaartLink(loc.adres)} target="_blank" rel="noopener noreferrer" className="underline font-medium">Route</a>}
                      </div>
                    )}
                    {p.wie && <div className="text-xs text-gray-600 mt-0.5 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{p.wie}</div>}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {s.locaties.length > 0 && (
          <section className="card-base">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" />{s.locaties.length > 1 ? 'Locaties' : 'Locatie'}</h2>
            <ul className="space-y-3">
              {s.locaties.map((x) => (
                <li key={x.id} className="rounded-xl border border-gray-100 p-3">
                  <div className="font-medium">{x.naam}</div>
                  {x.adres && x.adres !== x.naam && <div className="text-sm text-gray-600">{x.adres}</div>}
                  {(x.contact || x.telefoon) && <div className="text-sm text-gray-600 mt-1">Ter plaatse: {x.contact}{x.telefoon && <> · <a href={belLink(x.telefoon)} className="underline">{x.telefoon}</a></>}</div>}
                  {x.notitie && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{x.notitie}</p>}
                  {x.adres && <a href={kaartLink(x.adres)} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs mt-2"><Navigation className="h-3.5 w-3.5" />Route in Maps</a>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {s.betrokkenen.length > 0 && (
          <section className="card-base">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" />Wie is erbij</h2>
            <ul className="divide-y divide-gray-100">
              {s.betrokkenen.map((b) => (
                <li key={b.id} className="py-2 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{b.naam || b.email}</div>{b.rol && <div className="text-xs text-gray-500">{b.rol}</div>}</div>
                  {b.telefoon && <a href={belLink(b.telefoon)} className="btn-secondary text-xs" aria-label={`Bel ${b.naam}`}><Phone className="h-3.5 w-3.5" />{b.telefoon}</a>}
                  {b.email && <a href={`mailto:${b.email}`} className="h-8 w-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100" aria-label={`Mail ${b.naam || b.email}`}><Mail className="h-4 w-4" /></a>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {s.shotlist.length > 0 && <Lijst titel="Shotlist" icoon={<ListChecks className="h-4 w-4 text-gray-400" />} punten={s.shotlist} />}
        {s.paklijst.length > 0 && <Lijst titel="Mee te nemen" icoon={<Backpack className="h-4 w-4 text-gray-400" />} punten={s.paklijst} />}

        {s.praktisch && (
          <section className="card-base">
            <h2 className="font-semibold mb-2 flex items-center gap-2"><Info className="h-4 w-4 text-gray-400" />Praktisch</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{s.praktisch}</p>
          </section>
        )}

        {s.briefing && (
          <details className="card-base">
            <summary className="font-semibold cursor-pointer">Volledige briefing</summary>
            <p className="text-sm text-gray-700 whitespace-pre-wrap mt-3">{s.briefing}</p>
          </details>
        )}

        <p className="text-xs text-gray-400 text-center pb-6">Vragen? Antwoord gewoon op de mail of bel ons.</p>
      </main>
  )
}


function Lijst({ titel, icoon, punten }: { titel: string; icoon: ReactNode; punten: string[] }) {
  return (
    <section className="card-base">
      <h2 className="font-semibold mb-2 flex items-center gap-2">{icoon}{titel}</h2>
      <ul className="space-y-1.5">
        {punten.map((p, i) => <li key={i} className="text-sm text-gray-800 flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />{p}</li>)}
      </ul>
    </section>
  )
}
