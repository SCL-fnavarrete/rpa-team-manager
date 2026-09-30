import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import { QueryClient, QueryClientProvider } from 'react-query';

// Components
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppLayout } from '@/components/common/AppLayout';

// Pages
import { LoginPage } from '@/pages/auth/LoginPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { ProjectsPage } from '@/pages/projects/ProjectsPage';
import { ProjectDetailPage } from '@/pages/projects/ProjectDetailPage';
import { ClientsPage } from '@/pages/projects/ClientsPage';
import { TimeTrackingPage } from '@/pages/time/TimeTrackingPage';
import { TasksPage } from '@/pages/tasks/TasksPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { LLMConfigPage } from '@/pages/settings/LLMConfigPage';
import IdeasPage from '@/pages/ideas/IdeasPage';
import FilesPage from '@/pages/files/FilesPage';
import SupportPage from '@/pages/support/SupportPage';
import PMODashboard from '@/pages/pmo/PMODashboard';
import BillingPage from '@/pages/billing/BillingPage';
import ProfilePage from '@/pages/profile/ProfilePage';
import TeamManagementPage from '@/pages/admin/TeamManagementPage';
import PriorityMatrixPage from '@/pages/priorities/PriorityMatrixPage';
import { ScopingPage } from '@/pages/scoping/ScopingPage';

// React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
          <Router>
            <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            
            {/* Protected routes */}
            <Route path="/" element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }>
              {/* Dashboard */}
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              
              {/* Projects & Scoping */}
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="cotizador" element={<ScopingPage />} />
              <Route path="clients" element={
                <ProtectedRoute requiredRoles={['team_lead', 'rpa_operations']}>
                  <ClientsPage />
                </ProtectedRoute>
              } />
              
              {/* Tasks */}
              <Route path="tasks" element={<TasksPage />} />
              
              {/* Time Tracking */}
              <Route path="time" element={<TimeTrackingPage />} />
              
              {/* Ideas */}
              <Route path="ideas" element={<IdeasPage />} />
              
              
              {/* Files */}
              <Route path="files" element={<FilesPage />} />
              
              {/* Support */}
              <Route path="support" element={<SupportPage />} />
              
              {/* PMO Dashboard */}
              <Route path="pmo" element={
                <ProtectedRoute requiredRoles={['team_lead', 'rpa_operations', 'billing']}>
                  <PMODashboard />
                </ProtectedRoute>
              } />
              
              {/* PMO Gantt for specific projects - accessible by developers */}
              <Route path="pmo/gantt/:id" element={
                <ProtectedRoute requiredRoles={['team_lead', 'rpa_operations', 'rpa_developer']}>
                  <PMODashboard ganttMode={true} />
                </ProtectedRoute>
              } />

              {/* Billing / Cobranza */}
              <Route path="billing" element={
                <ProtectedRoute requiredRoles={['team_lead', 'rpa_operations', 'billing']}>
                  <BillingPage />
                </ProtectedRoute>
              } />

              {/* Admin (Team Lead only) */}
              <Route path="admin" element={
                <ProtectedRoute requiredRoles={['team_lead']}>
                  <TeamManagementPage />
                </ProtectedRoute>
              } />

              {/* Priority Matrices (Team Lead only - datos de rentabilidad) */}
              <Route path="priorities" element={
                <ProtectedRoute requiredRoles={['team_lead']}>
                  <PriorityMatrixPage />
                </ProtectedRoute>
              } />

              {/* Profile */}
              <Route path="profile" element={<ProfilePage />} />
              
              {/* Settings (Team Lead only) */}
              <Route path="settings" element={
                <ProtectedRoute requiredRoles={['team_lead']}>
                  <SettingsPage />
                </ProtectedRoute>
              } />

              {/* LLM Configuration (Team Lead only) */}
              <Route path="settings/llm" element={
                <ProtectedRoute requiredRoles={['team_lead']}>
                  <LLMConfigPage />
                </ProtectedRoute>
              } />
            </Route>
            
            {/* Unauthorized page */}
            <Route path="/unauthorized" element={
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                padding: '20px',
                textAlign: 'center'
              }}>
                <h1>Acceso denegado</h1>
                <p>No tienes permiso para acceder a esta página.</p>
                <button onClick={() => window.history.back()}>
                  
                  Volver
                </button>
              </div>
            } />
            
            {/* 404 page */}
            <Route path="*" element={
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                padding: '20px',
                textAlign: 'center'
              }}>
                <h1>Página no encontrada</h1>
                <p>La página que buscas no existe.</p>
                <button onClick={() => window.location.href = '/dashboard'}>
                  
                  Ir al inicio
                </button>
              </div>
            } />
            </Routes>
          </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
