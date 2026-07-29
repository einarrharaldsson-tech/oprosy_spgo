import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import AppFooter from './AppFooter';
import Brand from './Brand';
import { listPendingConductSessions } from '../lib/offlineConductStore';

const ROLE_LABEL = {
  admin: 'Администратор',
  editor: 'Редактор',
  user: 'Пользователь',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';
  const canConstruct = user.role === 'admin' || user.role === 'editor';
  const canCompleted = canConstruct;
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const refresh = async () => {
      const pending = await listPendingConductSessions();
      setPendingCount(pending.filter((item) => item.status !== 'active').length);
    };
    refresh().catch(() => {});
    const onOnline = () => refresh().catch(() => {});
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(() => refresh().catch(() => {}), 10000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-meta">
          <span>
            {user.fullName || user.login}
            <span className="muted"> · {ROLE_LABEL[user.role]}</span>
          </span>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      <nav className="nav">
        <NavLink to="/" end>
          Опросы
        </NavLink>
        <NavLink to="/offline-queue">
          Очередь
          {pendingCount > 0 && <span className="nav-link-badge">{pendingCount}</span>}
        </NavLink>
        {canConstruct && (
          <NavLink to="/admin/constructor">Конструктор</NavLink>
        )}
        {isAdmin && <NavLink to="/admin/import">Импорт опроса</NavLink>}
        {isAdmin && <NavLink to="/admin/users">Пользователи</NavLink>}
        {canCompleted && <NavLink to="/completed">Завершённые</NavLink>}
        {isAdmin && <NavLink to="/history">История</NavLink>}
      </nav>

      <main className="page">
        <Outlet />
      </main>

      <AppFooter />
    </div>
  );
}
