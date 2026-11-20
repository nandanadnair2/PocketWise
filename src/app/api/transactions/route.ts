import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { checkLimits } from '@/lib/limits'
import { txOptions } from '@/lib/tx-options'

// POST: create a transaction (purchase or allowance credit)
// Uses DB transaction with row-level locking (SELECT ... FOR UPDATE) to prevent concurrent overspend
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { type, amount, category, merchant, note, idempotencyKey, childId } = await req.json()

    if (!type || !amount || !idempotencyKey) {
      return NextResponse.json({ error: 'type, amount, and idempotencyKey are required' }, { status: 400 })
    }

    const role = (session.user as any).role
    const userId = session.user.id as string
    const amountPaise = Math.round(Number(amount))
    if (amountPaise <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    // Determine which wallet to use
    let walletChildId: string
    if (role === 'CHILD') {
      walletChildId = userId
    } else if (role === 'PARENT' && childId) {
      const child = await prisma.user.findFirst({
        where: { id: childId, parentId: userId, role: 'CHILD' },
      })
      if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 })
      walletChildId = childId
    } else {
      return NextResponse.json({ error: 'childId required for parent' }, { status: 400 })
    }

    // Idempotency: return existing transaction if key was already used
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey },
    })
    if (existing) {
      return NextResponse.json(existing, { status: 200 })
    }

    // Run the whole spend in a DB transaction with row-level lock
    const result = await prisma.$transaction(async (tx) => {
      // Lock the wallet row
      const wallet = await tx.$queryRawUnsafe<any[]>(
        'SELECT * FROM "Wallet" WHERE "childId" = $1 FOR UPDATE',
        walletChildId
      )
      if (!wallet || wallet.length === 0) {
        throw new Error('Wallet not found')
      }
      const w = wallet[0]

      if (w.frozen && type === 'PURCHASE') {
        // Record the declined transaction
        const txDeclined = await tx.transaction.create({
          data: {
            walletId: w.id,
            type,
            status: 'DECLINED_FROZEN',
            amount: amountPaise,
            category: category || 'OTHER',
            merchant,
            note,
            idempotencyKey,
          },
        })
        return { transaction: txDeclined, wallet: w }
      }

      if (type === 'ALLOWANCE_CREDIT') {
        // Parent adds money - no limit check needed
        const newBalance = w.balance + amountPaise
        await tx.wallet.update({
          where: { id: w.id },
          data: { balance: newBalance, version: { increment: 1 } },
        })
        const txRecord = await tx.transaction.create({
          data: {
            walletId: w.id,
            type: 'ALLOWANCE_CREDIT',
            status: 'APPROVED',
            amount: amountPaise,
            category: category || 'OTHER',
            merchant,
            note,
            idempotencyKey,
          },
        })
        return { transaction: txRecord, wallet: { ...w, balance: newBalance } }
      }

      if (type === 'PURCHASE') {
        // Check balance first
        if (w.balance < amountPaise) {
          const txDeclined = await tx.transaction.create({
            data: {
              walletId: w.id,
              type,
              status: 'DECLINED_LIMIT',
              amount: amountPaise,
              category: category || 'OTHER',
              merchant,
              note,
              idempotencyKey,
            },
          })
          return { declined: true, transaction: txDeclined, wallet: w }
        }

        // Check spending limits (limit engine)
        const cat = (category || 'OTHER') as any
        const limitCheck = await checkLimits(tx, w.id, cat, amountPaise)

        if (!limitCheck.allowed) {
          const txDeclined = await tx.transaction.create({
            data: {
              walletId: w.id,
              type,
              status: 'DECLINED_LIMIT',
              amount: amountPaise,
              category: cat,
              merchant,
              note,
              idempotencyKey,
            },
          })
          if (limitCheck.alerts.length > 0) {
            await tx.alert.createMany({
              data: limitCheck.alerts.map((a) => ({
                walletId: w.id,
                kind: a.kind,
                message: a.message,
              })),
            })
          }
          return { declined: true, transaction: txDeclined, wallet: w, blockedBy: limitCheck.blockedBy }
        }

        const newBalance = w.balance - amountPaise
        await tx.wallet.update({
          where: { id: w.id },
          data: { balance: newBalance, version: { increment: 1 } },
        })
        const txRecord = await tx.transaction.create({
          data: {
            walletId: w.id,
            type: 'PURCHASE',
            status: 'APPROVED',
            amount: amountPaise,
            category: cat,
            merchant,
            note,
            idempotencyKey,
          },
        })
        if (limitCheck.alerts.length > 0) {
          await tx.alert.createMany({
            data: limitCheck.alerts.map((a) => ({
              walletId: w.id,
              kind: a.kind,
              message: a.message,
            })),
          })
        }
        return { transaction: txRecord, wallet: { ...w, balance: newBalance } }
      }

      throw new Error('Unsupported transaction type')
    }, txOptions)

    if ((result as any).declined) {
      return NextResponse.json(result, { status: 402 })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error('Transaction error:', error)
    if (error.message === 'Wallet not found') {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET: list transactions
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

    let walletChildId: string
    if (role === 'CHILD') {
      walletChildId = userId
    } else if (role === 'PARENT' && childId) {
      const child = await prisma.user.findFirst({
        where: { id: childId, parentId: userId },
      })
      if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 })
      walletChildId = childId
    } else {
      return NextResponse.json({ error: 'childId required' }, { status: 400 })
    }

    const wallet = await prisma.wallet.findUnique({ where: { childId: walletChildId } })
    if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })

    const transactions = await prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json(transactions)
  } catch (error) {
    console.error('Transactions GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
