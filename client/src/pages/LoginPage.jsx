import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import AppFooter from '../components/AppFooter';
import Brand from '../components/Brand';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(loginName.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card stack" onSubmit={onSubmit}>
        <div>
          <Brand />
          <h1>Вход в систему</h1>
          <p className="hint">Авторизуйтесь, чтобы проводить опросы или работать с конструктором.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="field">
          <label htmlFor="login">Логин</label>
          <input
            id="login"
            autoComplete="username"
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>

      <AppFooter />
    </div>
  );
}
