import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// A child signs in with name + PIN, so the name must be unique and the PIN must exist.
const createChildSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(30, 'Name is too long'),
  pin: z.coerce.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
})

// Parent creates a child account + wallet
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user || (session.user as any).role !== 'PARENT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parentId = session.user.id as string

    const parsed = createChildSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }
    const { name, pin } = parsed.data

    // Child names are used to sign in, so they must be unique (ignoring upper/lower case).
    const taken = await prisma.user.findFirst({
      where: { role: 'CHILD', name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (taken) {
      return NextResponse.json(
        { error: 'That name is already taken. Try adding an initial or number, like "Aman K".' },
        { status: 409 }
      )
    }

    const pinHash = await bcrypt.hash(pin, 12)

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
