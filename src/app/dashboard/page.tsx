import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import PendingRequests from '@/components/PendingRequests'

export const instant = false

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const role = (session.user as any).role
  if (role === 'CHILD') redirect('/kid')

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">PocketWise Dashboard</h1>
            <p className="text-gray-600">Welcome, {session.user.name} ({role})</p>
          </div>
          <form action={async () => {
            'use server'
            const { signOut } = await import('@/auth')
            await signOut({ redirectTo: '/' })
          }}>
            <button className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-100">
              Log Out
            </button>
          </form>
        </div>

        {role === 'PARENT' ? (
          <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Link href="/parent/children" className="bg-white p-6 rounded-xl shadow hover:shadow-md transition">
                <h2 className="text-xl font-semibold text-indigo-600 mb-2">👨‍👩‍👧 Manage Children</h2>
                <p className="text-gray-600 text-sm">Add a child account, view wallets, set limits</p>
              </Link>
              <Link href="/parent/limits" className="bg-white p-6 rounded-xl shadow hover:shadow-md transition">
                <h2 className="text-xl font-semibold text-indigo-600 mb-2">🚦 Spending Limits</h2>
                <p className="text-gray-600 text-sm">Set daily, weekly and per-category limits</p>
              </Link>
            </div>
            <div className="bg-white p-6 rounded-xl shadow">
              <PendingRequests />
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <Link href="/kid/wallet" className="bg-white p-6 rounded-xl shadow hover:shadow-md transition">
              <h2 className="text-xl font-semibold text-indigo-600 mb-2">💳 My Wallet</h2>
              <p className="text-gray-600 text-sm">See your balance and transactions</p>
            </Link>
            <Link href="/kid/goals" className="bg-white p-6 rounded-xl shadow hover:shadow-md transition">
              <h2 className="text-xl font-semibold text-indigo-600 mb-2">🎯 Savings Goals</h2>
              <p className="text-gray-600 text-sm">Track your savings progress</p>
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
