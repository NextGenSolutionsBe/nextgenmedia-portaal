import { redirect } from 'next/navigation'

// De aparte "Blog review"-pagina is vervangen door de Blog Kalender, waar alle
// review/goedkeuring/publicatie gebeurt. Oude links blijven werken via redirect.
export default async function BlogsRedirectPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams
  redirect(account ? `/admin/blog-calendar?account=${account}` : '/admin/blog-calendar')
}
