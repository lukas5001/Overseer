import { useState, useRef, useEffect } from 'react'
import { Shield, ArrowLeft, Mail, Smartphone } from 'lucide-react'
import axios from 'axios'
import { api } from '../api/client'

interface Props {
  onLogin: () => void
}

interface TwoFAState {
  pendingToken: string
  method: 'totp' | 'email'
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('admin@overseer.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [twoFA, setTwoFA] = useState<TwoFAState | null>(null)
  const [code, setCode] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (twoFA && codeRef.current) codeRef.current.focus()
  }, [twoFA])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post('/api/v1/auth/login', { email, password })
      if (res.data.requires_2fa) {
        setTwoFA({
          pendingToken: res.data.pending_token,
          method: res.data.two_fa_method,
        })
      } else {
        localStorage.setItem('overseer_token', res.data.access_token)
        onLogin()
      }
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Login fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!twoFA) return
    setError(null)
    setLoading(true)
    try {
      const res = await axios.post('/api/v1/auth/2fa/verify',
        { code },
        { headers: { Authorization: `Bearer ${twoFA.pendingToken}` } },
      )
      localStorage.setItem('overseer_token', res.data.access_token)
      onLogin()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? '2FA-Verifizierung fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!twoFA) return
    try {
      await axios.post('/api/v1/auth/2fa/resend', {}, {
        headers: { Authorization: `Bearer ${twoFA.pendingToken}` },
      })
      setError(null)
    } catch {
      setError('Code konnte nicht erneut gesendet werden')
    }
  }

  const handleBack = () => {
    setTwoFA(null)
    setCode('')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-overseer-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-12 h-12 text-overseer-600 mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">Overseer</h1>
          <p className="text-sm text-gray-500 mt-1">
            {twoFA ? 'Zwei-Faktor-Authentifizierung' : 'Monitoring System Login'}
          </p>
        </div>

        {twoFA ? (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3 mb-2">
              {twoFA.method === 'totp' ? (
                <Smartphone className="w-5 h-5 text-overseer-600 flex-shrink-0" />
              ) : (
                <Mail className="w-5 h-5 text-overseer-600 flex-shrink-0" />
              )}
              <p className="text-sm text-gray-600">
                {twoFA.method === 'totp'
                  ? 'Geben Sie den Code aus Ihrer Authenticator-App ein.'
                  : 'Ein Code wurde an Ihre E-Mail-Adresse gesendet.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input
                ref={codeRef}
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none text-center text-2xl tracking-[0.3em] font-mono"
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full bg-overseer-600 text-white py-2.5 rounded-lg font-medium hover:bg-overseer-700 transition-colors disabled:opacity-60"
            >
              {loading ? 'Verifiziere…' : 'Verifizieren'}
            </button>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Zurück
              </button>
              {twoFA.method === 'email' && (
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-sm text-overseer-600 hover:text-overseer-700 transition-colors"
                >
                  Code erneut senden
                </button>
              )}
            </div>
          </form>
        ) : (
          <>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none"
                  placeholder="admin@overseer.local"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Passwort</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none"
                  placeholder="admin123"
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-overseer-600 text-white py-2.5 rounded-lg font-medium hover:bg-overseer-700 transition-colors disabled:opacity-60"
              >
                {loading ? 'Anmelden…' : 'Anmelden'}
              </button>
            </form>
            <p className="text-xs text-center text-gray-400 mt-6">
              Demo: admin@overseer.local / admin123
            </p>
          </>
        )}
      </div>
    </div>
  )
}
