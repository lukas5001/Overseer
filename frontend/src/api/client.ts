import axios from 'axios'

export const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: add JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('overseer_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: on 401 try refresh, then redirect to login
let isRefreshing = false
const AUTH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/2fa/verify', '/api/v1/auth/2fa/resend', '/api/v1/auth/refresh']

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const url = originalRequest?.url || ''

    // Never intercept 401s from auth endpoints — let the caller handle them
    if (AUTH_PATHS.some((p) => url.endsWith(p))) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshing) {
      originalRequest._retry = true
      isRefreshing = true
      try {
        const resp = await api.post('/api/v1/auth/refresh')
        const newToken = resp.data.access_token
        localStorage.setItem('overseer_token', newToken)
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        isRefreshing = false
        return api(originalRequest)
      } catch {
        isRefreshing = false
        localStorage.removeItem('overseer_token')
        window.location.href = '/login'
      }
    } else if (error.response?.status === 401) {
      localStorage.removeItem('overseer_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
