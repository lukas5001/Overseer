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

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('overseer_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
