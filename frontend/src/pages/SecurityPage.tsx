import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Smartphone, Mail, CheckCircle, XCircle, Copy, Check } from 'lucide-react'
import { api } from '../api/client'

type Step = 'choose' | 'totp-scan' | 'totp-verify' | 'email-sent' | 'email-verify'

export default function SecurityPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ method: string }>({
    queryKey: ['2fa-status'],
    queryFn: () => api.get('/api/v1/2fa/status').then(r => r.data),
  })

  const method = data?.method ?? 'none'
  const isActive = method !== 'none'

  const [step, setStep] = useState<Step | null>(null)
  const [totpSecret, setTotpSecret] = useState('')
  const [totpQr, setTotpQr] = useState('')
  const [emailTarget, setEmailTarget] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)

  const reset = () => {
    setStep(null)
    setCode('')
    setError(null)
    setTotpSecret('')
    setTotpQr('')
    setEmailTarget('')
    setConfirmDisable(false)
  }

  const startTotp = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post('/api/v1/2fa/setup/totp/init')
      setTotpSecret(res.data.secret)
      setTotpQr(res.data.qr_uri)
      setStep('totp-scan')
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Fehler')
    } finally {
      setLoading(false)
    }
  }

  const confirmTotp = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/api/v1/2fa/setup/totp/confirm', { secret: totpSecret, code })
      qc.invalidateQueries({ queryKey: ['2fa-status'] })
      reset()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Ungültiger Code')
    } finally {
      setLoading(false)
    }
  }

  const startEmail = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post('/api/v1/2fa/setup/email/init')
      setEmailTarget(res.data.sent_to)
      setStep('email-sent')
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Fehler')
    } finally {
      setLoading(false)
    }
  }

  const confirmEmail = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/api/v1/2fa/setup/email/confirm', { code })
      qc.invalidateQueries({ queryKey: ['2fa-status'] })
      reset()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Ungültiger Code')
    } finally {
      setLoading(false)
    }
  }

  const disable = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/api/v1/2fa/disable')
      qc.invalidateQueries({ queryKey: ['2fa-status'] })
      reset()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Fehler')
    } finally {
      setLoading(false)
    }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(totpSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) return <div className="p-8 text-gray-400">Lade...</div>

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <ShieldCheck className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Sicherheit</h1>
      </div>

      {/* Current status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold text-gray-800 mb-3">Zwei-Faktor-Authentifizierung</h2>
        <div className="flex items-center gap-3">
          {isActive ? (
            <>
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span className="text-sm text-gray-700">
                Aktiv &ndash; {method === 'totp' ? 'Authenticator-App' : 'E-Mail'}
              </span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-500">Nicht aktiviert</span>
            </>
          )}
        </div>

        {isActive && !step && (
          <div className="mt-4">
            {!confirmDisable ? (
              <button
                onClick={() => setConfirmDisable(true)}
                className="text-sm text-red-600 hover:text-red-700 transition-colors"
              >
                2FA deaktivieren
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">Wirklich deaktivieren?</span>
                <button
                  onClick={disable}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
                >
                  Ja, deaktivieren
                </button>
                <button
                  onClick={() => setConfirmDisable(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Abbrechen
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup flow */}
      {!isActive && !step && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={startTotp}
            disabled={loading}
            className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:border-overseer-400 hover:shadow-md transition-all disabled:opacity-60"
          >
            <Smartphone className="w-8 h-8 text-overseer-600 mb-3" />
            <h3 className="font-semibold text-gray-800 mb-1">Authenticator-App</h3>
            <p className="text-sm text-gray-500">
              Google Authenticator, Authy o.ä. verwenden
            </p>
          </button>
          <button
            onClick={startEmail}
            disabled={loading}
            className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:border-overseer-400 hover:shadow-md transition-all disabled:opacity-60"
          >
            <Mail className="w-8 h-8 text-overseer-600 mb-3" />
            <h3 className="font-semibold text-gray-800 mb-1">E-Mail</h3>
            <p className="text-sm text-gray-500">Code per E-Mail bei jeder Anmeldung</p>
          </button>
        </div>
      )}

      {/* TOTP: Scan QR */}
      {step === 'totp-scan' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">QR-Code scannen</h3>
          <p className="text-sm text-gray-600 mb-4">
            Scannen Sie den QR-Code mit Ihrer Authenticator-App.
          </p>
          <div className="flex justify-center mb-4">
            <img src={totpQr} alt="TOTP QR Code" className="rounded-lg" />
          </div>
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 mb-4">
            <code className="text-xs text-gray-600 flex-1 break-all">{totpSecret}</code>
            <button onClick={copySecret} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Code aus der App</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none text-center text-2xl tracking-[0.3em] font-mono"
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={confirmTotp}
              disabled={loading || code.length < 6}
              className="flex-1 bg-overseer-600 text-white py-2.5 rounded-lg font-medium hover:bg-overseer-700 transition-colors disabled:opacity-60"
            >
              {loading ? 'Verifiziere...' : 'Aktivieren'}
            </button>
            <button
              onClick={reset}
              className="px-4 py-2.5 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Email: Code sent */}
      {step === 'email-sent' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">E-Mail-Code eingeben</h3>
          <p className="text-sm text-gray-600 mb-4">
            Ein 6-stelliger Code wurde an <strong>{emailTarget}</strong> gesendet.
          </p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none text-center text-2xl tracking-[0.3em] font-mono"
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={confirmEmail}
              disabled={loading || code.length < 6}
              className="flex-1 bg-overseer-600 text-white py-2.5 rounded-lg font-medium hover:bg-overseer-700 transition-colors disabled:opacity-60"
            >
              {loading ? 'Verifiziere...' : 'Aktivieren'}
            </button>
            <button
              onClick={reset}
              className="px-4 py-2.5 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
