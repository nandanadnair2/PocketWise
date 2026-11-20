import { NextResponse } from 'next/server'
import { auth } from '@/auth'

// Redirect-only guard for page routes. Every API route still checks the session and role itself,
// so this is a convenience layer, not the only line of defence.
const PROTECTED_PREFIXES = ['/dashboard', '/kid', '/parent']

const startsWithPath = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + '/')

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((p) => startsWithPath(pathname, p))

  if (!isProtected) return NextResponse.next()

  // Not signed in: send to the login page.
  if (!req.auth) {
    return NextResponse.redirect(new URL('/login', req.nextUrl.origin))
  }

  // Signed in but on the wrong side of the app: send to the dashboard, which routes by role.
  const role = (req.auth.user as { role?: string } | undefined)?.role
  if (startsWithPath(pathname, '/parent') && role !== 'PARENT') {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin))
  }
  if (startsWithPath(pathname, '/kid') && role !== 'CHILD') {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}