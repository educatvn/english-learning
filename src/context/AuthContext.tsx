import { createContext, useContext, useState } from 'react'

export interface GoogleUser {
  sub: string
  name: string
  email: string
  picture: string
}

interface AuthContextValue {
  user: GoogleUser | null
  isAdmin: boolean
  login: (credential: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAdmin: false,
  login: () => {},
  signOut: () => {},
})

function parseJwt(token: string): GoogleUser {
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  return {
    sub: payload.sub as string,
    name: payload.name as string,
    email: payload.email as string,
    picture: payload.picture as string,
  }
}

// Comma-separated list of admin emails in .env.local
// e.g. VITE_ADMIN_EMAILS=alice@gmail.com,bob@company.com
const ADMIN_EMAILS = new Set(
  ((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
)

function checkIsAdmin(user: GoogleUser | null): boolean {
  return user ? ADMIN_EMAILS.has(user.email.toLowerCase()) : false
}

const STORAGE_KEY = 'auth_user'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<GoogleUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as GoogleUser) : null
    } catch {
      return null
    }
  })

  const isAdmin = checkIsAdmin(user)

  function login(credential: string) {
    const u = parseJwt(credential)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, isAdmin, login, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
