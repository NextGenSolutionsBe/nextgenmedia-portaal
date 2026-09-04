import { Toaster } from 'sonner'

export default function KantoorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Toaster richColors position="top-right" />
      {children}
    </>
  )
}
