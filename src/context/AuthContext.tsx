import { createContext, useContext, useState } from 'react'

export interface GoogleUser {
  sub: string
  name: string
  email: string
  picture: string
}

interface AuthContextValue {
  user: GoogleUser | null
  login: (credential: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
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
    <AuthContext.Provider value={{ user, login, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
