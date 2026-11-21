import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        name: { label: 'Name', type: 'text' },
        pin: { label: 'PIN', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials) return null

        // Child login: name + PIN (children have no email)
        if (credentials.name && credentials.pin) {
          const child = await prisma.user.findFirst({
            where: { name: credentials.name as string, role: 'CHILD' },
          })
          if (!child || !child.pinHash) return null
          const valid = await bcrypt.compare(credentials.pin as string, child.pinHash)
          if (!valid) return null
          return { id: child.id, email: child.email, name: child.name, role: child.role, parentId: child.parentId }
        }

        // Parent login: email + password
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        })

        if (!user || !user.passwordHash) return null

        const valid = await bcrypt.compare(credentials.password as string, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          parentId: user.parentId,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.parentId = (user as any).parentId
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        ;(session.user as any).role = token.role
        ;(session.user as any).parentId = token.parentId
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
})
