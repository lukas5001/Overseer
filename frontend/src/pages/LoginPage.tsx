import { useState } from 'react'
import { Shield } from 'lucide-react'
import { api } from '../api/client'

interface Props {
  onLogin: () => void
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('admin@overseer.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post('/api/v1/auth/login', { email, password })
      localStorage.setItem('overseer_token', res.data.access_token)
      onLogin()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Login fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-overseer-900 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-12 h-12 text-overseer-600 mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">Overseer</h1>
          <p className="text-sm text-gray-500 mt-1">Monitoring System Login</p>
        </div>

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
      </div>
    </div>
  )
}
