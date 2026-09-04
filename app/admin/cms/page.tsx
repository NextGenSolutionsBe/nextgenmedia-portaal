import { redirect } from 'next/navigation'

// Oude losse CMS Manager is uitgefaseerd — blogbeheer loopt via Blogs → Projecten.
// Route blijft bestaan als redirect zodat oude bladwijzers/links niet breken.
export default function CmsRedirect() {
  redirect('/admin/blogaccounts')
}
