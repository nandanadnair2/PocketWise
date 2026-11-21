'use client'

import { useState, useEffect } from 'react'

interface Child {
  id: string
  name: string
  role: string
  wallet: {
    id: string
    balance: number
    frozen: boolean
    mockCardLast4: string
  } | null
}

export default function ChildrenPage() {
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [error, setError] = useState('')

  async function loadChildren() {
    const res = await fetch('/api/auth/child')
    if (res.ok) {
      setChildren(await res.json())
    }
    setLoading(false)
  }

  useEffect(() => { loadChildren() }, [])

  async function addChild(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/auth/child', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, pin: newPin }),
    })
    if (res.ok) {
      setNewName('')
      setNewPin('')
      setShowAdd(false)
      loadChildren()
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to add child')
    }
  }

  function formatPaise(paise: number) {
    return `₹${(paise / 100).toFixed(2)}`
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">My Children</h1>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            {showAdd ? 'Cancel' : '+ Add Child'}
          </button>
        </div>

        {showAdd && (
          <form onSubmit={addChild} className="bg-white p-6 rounded-xl shadow mb-6 space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Child's Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN (4-6 digits, used to log in)</label>
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                maxLength={6}
                pattern="[0-9]{4,6}"
                title="PIN must be 4 to 6 digits"
                required
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Create Child Account
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : children.length === 0 ? (
          <div className="bg-white p-8 rounded-xl shadow text-center text-gray-500">
            No children yet. Click "Add Child" to create one.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {children.map((child) => (
              <div key={child.id} className="bg-white p-6 rounded-xl shadow">
                <div className="flex justify-between items-start mb-2">
                  <h2 className="text-xl font-semibold text-gray-800">{child.name}</h2>
                  {child.wallet?.frozen && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded">Frozen</span>
                  )}
                </div>
                {child.wallet && (
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Balance: <span className="font-semibold text-indigo-600">{formatPaise(child.wallet.balance)}</span></p>
                    <p>Card: •••• {child.wallet.mockCardLast4} <span className="text-amber-600">(mock)</span></p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
