import { useState } from 'react'
import { Shield } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Implement actual login via /api/v1/auth/login
    // On success: store JWT in localStorage, redirect to /dashboard
    console.log('Login attempt:', email)
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
              placeholder="admin@example.com"
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
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-overseer-600 text-white py-2.5 rounded-lg font-medium hover:bg-overseer-700 transition-colors"
          >
            Anmelden
          </button>
        </form>
      </div>
    </div>
  )
}
