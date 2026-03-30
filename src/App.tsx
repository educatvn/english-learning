import { Routes, Route } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import PlayPage from './pages/PlayPage'
import PlaylistPage from './pages/PlaylistPage'
import ProgressPage from './pages/ProgressPage'
import HistoryPage from './pages/HistoryPage'
import AddVideoPage from './pages/admin/AddVideoPage'
import NewVideoPage from './pages/admin/NewVideoPage'

function App() {
  const { user } = useAuth()

  if (!user) return <LoginPage />

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/playlist/:id" element={<HomePage />} />
      <Route path="/play/:videoId" element={<PlayPage />} />
      <Route path="/playlist/:id/play" element={<PlaylistPage />} />
      <Route path="/progress" element={<ProgressPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/admin/add-video" element={<AddVideoPage />} />
      <Route path="/admin/new-video" element={<NewVideoPage />} />
    </Routes>
  )
}

export default App
