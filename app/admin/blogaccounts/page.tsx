export const dynamic = 'force-dynamic'

import { BlogAccountsManager } from './blog-accounts-manager'

export default function BlogAccountsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Blogprojecten</h1>
        <p className="text-sm text-gray-500 mt-0.5">Framer-projecten koppelen, planning instellen en blogs genereren.</p>
      </div>
      <BlogAccountsManager />
    </div>
  )
}
