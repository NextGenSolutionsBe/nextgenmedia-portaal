import { NgmKop, NgmSchil, NgmVoet } from '@/components/ngm-merk'

/** Publieke boekingspagina's: eigen, rustige schil zonder login, in de huisstijl van NextGenMedia. */
export default function BoekenLayout({ children }: { children: React.ReactNode }) {
  return (
    <NgmSchil>
      <NgmKop label="Meeting boeken" breedte="2xl" />
      <main className="flex-1 px-4 py-6 sm:py-10">{children}</main>
      <NgmVoet />
    </NgmSchil>
  )
}
