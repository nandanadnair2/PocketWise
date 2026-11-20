import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold text-indigo-600 mb-4">PocketWise</h1>
        <p className="text-xl text-gray-600 mb-2">A parent-controlled virtual wallet for kids</p>
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-8">
          ⚠️ MOCK LEDGER ONLY — No real money, no real card numbers, no real children's data
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/register"
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition"
          >
            Parent Sign Up
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 border border-indigo-600 text-indigo-600 rounded-lg font-medium hover:bg-indigo-50 transition"
          >
            Log In
          </Link>
        </div>
      </div>
    </main>
  )
}
