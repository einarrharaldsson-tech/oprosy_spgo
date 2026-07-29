import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import SurveysPage from './pages/SurveysPage';
import ConductPage from './pages/ConductPage';
import HistoryPage from './pages/HistoryPage';
import CompletedPage from './pages/CompletedPage';
import AdminUsersPage from './pages/AdminUsersPage';
import ConstructorListPage from './pages/ConstructorListPage';
import ConstructorEditPage from './pages/ConstructorEditPage';
import SurveyResponsesPage from './pages/SurveyResponsesPage';
import ImportSurveyPage from './pages/ImportSurveyPage';
import OfflineQueuePage from './pages/OfflineQueuePage';
function RequireAuth({ roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Загрузка…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Загрузка…</div>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<SurveysPage />} />
          <Route path="survey/:id" element={<ConductPage />} />
            <Route path="offline-queue" element={<OfflineQueuePage />} />
          <Route element={<RequireAuth roles={['admin', 'editor']} />}>
            <Route path="completed" element={<CompletedPage />} />
          </Route>
          <Route element={<RequireAuth roles={['admin']} />}>
            <Route path="history" element={<HistoryPage />} />
          </Route>
          <Route element={<RequireAuth roles={['admin']} />}>
            <Route path="admin/users" element={<AdminUsersPage />} />
            <Route path="admin/import" element={<ImportSurveyPage />} />
          </Route>
          <Route element={<RequireAuth roles={['admin', 'editor']} />}>
            <Route path="admin/constructor" element={<ConstructorListPage />} />
            <Route path="admin/constructor/:id" element={<ConstructorEditPage />} />
            <Route path="admin/surveys/:id/responses" element={<SurveyResponsesPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
