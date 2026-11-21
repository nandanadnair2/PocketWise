'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const [mode, setMode] = useState<'parent' | 'child'>('parent')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const result = await signIn('credentials', {
      ...(mode === 'parent' ? { email, password } : { name, pin }),
      redirect: false,
    })

    if (result?.error) {
      setError(mode === 'parent' ? 'Invalid email or password' : 'Invalid name or PIN')
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex items-center justify-center p-8">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-4 text-center">Log in to PocketWise</h1>
        <div className="flex rounded-lg border mb-4 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('parent')}
            className={`flex-1 py-2 text-sm font-medium ${mode === 'parent' ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-600'}`}
          >
            Parent
          </button>
          <button
            type="button"
            onClick={() => setMode('child')}
            className={`flex-1 py-2 text-sm font-medium ${mode === 'child' ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-600'}`}
          >
            Kid
          </button>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'parent' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  maxLength={6}
                  required
                />
              </div>
            </>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          No account?{' '}
          <Link href="/register" className="text-indigo-600 hover:underline">
            Sign up as a parent
          </Link>
        </p>
      </div>
    </main>
  )
}
