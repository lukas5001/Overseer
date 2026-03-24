import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, User as UserIcon, ShieldCheck, Sliders } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type { User } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'

type Tab = 'profile' | '2fa' | 'preferences'

// ── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ user }: { user: User }) {
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState(user.display_name ?? '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const updateProfile = useMutation({
    mutationFn: () => api.put('/api/v1/auth/preferences', { display_name: displayName }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['current-user'] }); setMessage({ text: 'Profil gespeichert', ok: true }) },
    onError: (e: any) => setMessage({ text: e.response?.data?.detail ?? 'Fehler', ok: false }),
  })

  const changePw = useMutation({
    mutationFn: () => api.post('/api/v1/auth/change-password', {
      current_password: currentPw,
      new_password: newPw,
    }).then(r => r.data),
    onSuccess: () => { setCurrentPw(''); setNewPw(''); setConfirmPw(''); setMessage({ text: 'Passwort geändert', ok: true }) },
    onError: (e: any) => setMessage({ text: e.response?.data?.detail ?? 'Fehler', ok: false }),
  })

  return (
    <div className="space-y-6">
      {/* Display Name */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Profil</h3>
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail</label>
            <input type="email" value={user.email} disabled
              className="w-full text-sm border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-gray-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending}
            className="px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
            Speichern
          </button>
        </div>
      </div>

      {/* Password Change */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Passwort ändern</h3>
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Aktuelles Passwort</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Neues Passwort</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Passwort bestätigen</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          {newPw && confirmPw && newPw !== confirmPw && (
            <p className="text-xs text-red-500">Passwörter stimmen nicht überein</p>
          )}
          <button onClick={() => changePw.mutate()}
            disabled={changePw.isPending || !currentPw || !newPw || newPw !== confirmPw}
            className="px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
            Passwort ändern
          </button>
        </div>
      </div>

      {message && (
        <p className={clsx('text-sm px-3 py-2 rounded-lg', message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
          {message.text}
        </p>
      )}
    </div>
  )
}

// ── 2FA Tab ──────────────────────────────────────────────────────────────────

function TwoFATab({ user }: { user: User }) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [qrData, setQrData] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [showDisable2fa, setShowDisable2fa] = useState(false)

  const setupTotp = useMutation({
    mutationFn: () => api.post('/api/v1/auth/2fa/setup-totp').then(r => r.data),
    onSuccess: (data: any) => setQrData(data.qr_code ?? data.secret),
  })

  const verifyTotp = useMutation({
    mutationFn: () => api.post('/api/v1/auth/2fa/verify-totp', { code }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['current-user'] }); setMessage({ text: 'TOTP aktiviert', ok: true }); setQrData(null) },
    onError: (e: any) => setMessage({ text: e.response?.data?.detail ?? 'Ungültiger Code', ok: false }),
  })

  const enableEmail2fa = useMutation({
    mutationFn: () => api.post('/api/v1/auth/2fa/enable-email').then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['current-user'] }); setMessage({ text: 'Email-2FA aktiviert', ok: true }) },
    onError: (e: any) => setMessage({ text: e.response?.data?.detail ?? 'Fehler', ok: false }),
  })

  const disable2fa = useMutation({
    mutationFn: () => api.post('/api/v1/auth/2fa/disable').then(r => r.data),
    onSuccess: () => { setShowDisable2fa(false); qc.invalidateQueries({ queryKey: ['current-user'] }); setMessage({ text: '2FA deaktiviert', ok: true }) },
  })

  const statusLabel = user.two_fa_method === 'totp' ? 'TOTP aktiv' : user.two_fa_method === 'email' ? 'Email-2FA aktiv' : 'Deaktiviert'
  const statusColor = user.two_fa_method !== 'none' ? 'text-emerald-700 bg-emerald-100' : 'text-gray-600 bg-gray-100'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-800 mb-4">Zwei-Faktor-Authentifizierung</h3>

      <div className="mb-6">
        <span className={clsx('px-3 py-1 rounded-full text-xs font-medium', statusColor)}>{statusLabel}</span>
      </div>

      {/* TOTP Setup */}
      {user.two_fa_method === 'none' && !qrData && (
        <div className="space-y-3">
          <button onClick={() => setupTotp.mutate()} disabled={setupTotp.isPending}
            className="px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
            TOTP einrichten
          </button>
          <button onClick={() => enableEmail2fa.mutate()} disabled={enableEmail2fa.isPending}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-60 ml-3">
            Email-2FA aktivieren
          </button>
        </div>
      )}

      {/* QR Code display */}
      {qrData && (
        <div className="space-y-3 max-w-sm">
          <p className="text-sm text-gray-600">Scanne den QR-Code mit deiner Authenticator-App:</p>
          {qrData.startsWith('data:') ? (
            <img src={qrData} alt="TOTP QR Code" className="w-48 h-48 border rounded-lg" />
          ) : (
            <code className="block text-xs bg-gray-100 p-3 rounded-lg break-all">{qrData}</code>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bestätigungscode</label>
            <input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="123456"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <button onClick={() => verifyTotp.mutate()} disabled={verifyTotp.isPending || code.length < 6}
            className="px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
            Bestätigen
          </button>
        </div>
      )}

      {/* Disable */}
      {user.two_fa_method !== 'none' && (
        <button onClick={() => setShowDisable2fa(true)}
          className="mt-4 px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50">
          2FA deaktivieren
        </button>
      )}

      <ConfirmDialog
        open={showDisable2fa}
        title="2FA deaktivieren"
        message="Zwei-Faktor-Authentifizierung wirklich deaktivieren? Du kannst sie jederzeit wieder aktivieren."
        confirmLabel="Deaktivieren"
        variant="warning"
        loading={disable2fa.isPending}
        onConfirm={() => disable2fa.mutate()}
        onCancel={() => setShowDisable2fa(false)}
      />

      {message && (
        <p className={clsx('mt-4 text-sm px-3 py-2 rounded-lg', message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
          {message.text}
        </p>
      )}
    </div>
  )
}

// ── Preferences Tab ──────────────────────────────────────────────────────────

function PreferencesTab() {
  const qc = useQueryClient()
  const [pollingInterval, setPollingInterval] = useState('15')
  const [message, setMessage] = useState<string | null>(null)

  const savePref = useMutation({
    mutationFn: () => api.put('/api/v1/auth/preferences', { polling_interval: parseInt(pollingInterval) }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['current-user'] }); setMessage('Gespeichert') },
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-800 mb-4">Präferenzen</h3>
      <div className="max-w-md space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Polling-Interval</label>
          <select value={pollingInterval} onChange={e => setPollingInterval(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
            <option value="15">15 Sekunden</option>
            <option value="30">30 Sekunden</option>
            <option value="60">60 Sekunden</option>
            <option value="0">Manuell</option>
          </select>
        </div>
        <button onClick={() => savePref.mutate()} disabled={savePref.isPending}
          className="px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
          Speichern
        </button>
        {message && <p className="text-sm text-emerald-600">{message}</p>}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['current-user'],
    queryFn: () => api.get('/api/v1/auth/me').then(r => r.data),
    refetchInterval: false,
  })

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'profile', label: 'Profil', icon: UserIcon },
    { key: '2fa', label: '2FA', icon: ShieldCheck },
    { key: 'preferences', label: 'Präferenzen', icon: Sliders },
  ]

  if (isLoading) return <div className="p-8 text-gray-400">Lade…</div>
  if (!user) return <div className="p-8 text-red-500">Fehler beim Laden.</div>

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Einstellungen</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={clsx('flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key ? 'border-overseer-600 text-overseer-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'profile' && <ProfileTab user={user} />}
      {activeTab === '2fa' && <TwoFATab user={user} />}
      {activeTab === 'preferences' && <PreferencesTab />}
    </div>
  )
}
