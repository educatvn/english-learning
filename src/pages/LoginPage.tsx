import { GoogleLogin } from '@react-oauth/google'
import { Play } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <Play className="w-8 h-8 text-primary-foreground translate-x-0.5" />
          </div>
          <div className="text-center">
            <h1 className="font-semibold text-lg tracking-tight">English Learning</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Sign in to continue</p>
          </div>
        </div>

        {/* Google sign-in button */}
        <div className="flex flex-col items-center gap-3">
          <GoogleLogin
            onSuccess={(response) => {
              if (response.credential) login(response.credential)
            }}
            onError={() => {
              console.error('Google sign-in failed')
            }}
            useOneTap
          />
        </div>
      </div>
    </div>
  )
}
