export const dynamic = 'force-dynamic'

import { BlogAccountsManager } from './blog-accounts-manager'

export default function BlogAccountsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Blogprojecten</h1>
        <p className="text-sm text-gray-500 mt-0.5">Koppel een Framer-project, stel de planning in en genereer blogs. Een project kan optioneel aan een klant gekoppeld zijn.</p>
      </div>
      <BlogAccountsManager />
    </div>
  )
}
