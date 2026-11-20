import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// Get the wallet for the logged-in user (child) or a specific child (parent)
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const childId = searchParams.get('childId')
    const role = (session.user as any).role
    const userId = session.user.id as string

    let wallet
    if (role === 'CHILD') {
      wallet = await prisma.wallet.findUnique({
        where: { childId: userId },
        include: {
          transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
          limits: true,
          goals: true,
          alerts: { where: { read: false }, orderBy: { createdAt: 'desc' } },
        },
      })
    } else if (role === 'PARENT' && childId) {
      // Verify the child belongs to this parent
      const child = await prisma.user.findFirst({
        where: { id: childId, parentId: userId },
      })
      if (!child) {
        return NextResponse.json({ error: 'Child not found' }, { status: 404 })
      }
      wallet = await prisma.wallet.findUnique({
        where: { childId },
        include: {
          transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
          limits: true,
          goals: true,
          alerts: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      })
    } else {
      return NextResponse.json({ error: 'childId required for parent' }, { status: 400 })
    }

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    return NextResponse.json(wallet)
  } catch (error) {
    console.error('Wallet GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
