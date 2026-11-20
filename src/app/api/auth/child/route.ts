import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// Parent creates a child account + wallet
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user || (session.user as any).role !== 'PARENT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parentId = session.user.id as string

    const { name, pin } = await req.json()
    if (!name) {
      return NextResponse.json({ error: 'Child name is required' }, { status: 400 })
    }

    const pinHash = pin ? await bcrypt.hash(pin, 12) : null

    // Generate a mock card last4 (fake, for UI only)
    const mockCardLast4 = String(Math.floor(1000 + Math.random() * 9000))

    const child = await prisma.user.create({
      data: {
        name,
        role: 'CHILD',
        pinHash,
        parentId: parentId,
        wallet: {
          create: {
            mockCardLast4,
          },
        },
      },
      include: { wallet: true },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorId: parentId,
        action: 'CHILD_CREATED',
        detail: { childId: child.id, childName: child.name },
      },
    })

    return NextResponse.json({
      id: child.id,
      name: child.name,
      role: child.role,
      wallet: child.wallet,
    }, { status: 201 })
  } catch (error) {
    console.error('Child creation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// List children of the logged-in parent
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user || (session.user as any).role !== 'PARENT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const children = await prisma.user.findMany({
      where: { parentId: session.user.id as string, role: 'CHILD' },
      include: { wallet: true },
    })

    return NextResponse.json(children)
  } catch (error) {
    console.error('List children error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
