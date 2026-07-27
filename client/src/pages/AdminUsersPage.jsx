import { useEffect, useState } from 'react';
import { api } from '../api';

const ROLES = [
  { value: 'admin', label: 'Администратор' },
  { value: 'editor', label: 'Редактор' },
  { value: 'user', label: 'Пользователь' },
];

const emptyForm = {
  login: '',
  password: '',
  fullName: '',
  role: 'user',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const data = await api('/users');
    setUsers(data);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      await api('/users', { method: 'POST', body: form });
      setForm(emptyForm);
      setOk('Пользователь создан');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (u) => {
    setEditId(u.id);
    setEdit({
      fullName: u.fullName || '',
      role: u.role,
      isActive: u.isActive,
      password: '',
    });
  };

  const saveEdit = async (id) => {
    setError('');
    setOk('');
    try {
      const body = {
        fullName: edit.fullName,
        role: edit.role,
        isActive: edit.isActive,
      };
      if (edit.password) body.password = edit.password;
      await api(`/users/${id}`, { method: 'PUT', body });
      setEditId(null);
      setOk('Сохранено');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;

  return (
    <div>
      <h1 className="page-title">Пользователи</h1>
      <p className="page-sub">
        Администратор — пользователи и конструктор. Редактор — конструктор и проведение.
        Пользователь — только проведение опросов с доступом.
      </p>

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="alert alert-ok" style={{ marginBottom: 12 }}>{ok}</div>}

      <form className="panel stack" onSubmit={create} style={{ marginBottom: 20 }}>
        <h3 style={{ margin: 0 }}>Новый пользователь</h3>
        <div className="field">
          <label>Логин</label>
          <input
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={4}
          />
        </div>
        <div className="field">
          <label>ФИО</label>
          <input
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Роль</label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          Создать
        </button>
      </form>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Логин</th>
              <th>ФИО</th>
              <th>Роль</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                {editId === u.id ? (
                  <>
                    <td>{u.login}</td>
                    <td>
                      <input
                        value={edit.fullName}
                        onChange={(e) => setEdit({ ...edit, fullName: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={edit.role}
                        onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={edit.isActive}
                          onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })}
                        />
                        Активен
                      </label>
                      <input
                        type="password"
                        placeholder="Новый пароль"
                        value={edit.password}
                        onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                        style={{ marginTop: 6, width: '100%' }}
                      />
                    </td>
                    <td>
                      <div className="row">
                        <button type="button" className="btn btn-primary" onClick={() => saveEdit(u.id)}>
                          ОК
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setEditId(null)}>
                          Отмена
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{u.login}</td>
                    <td>{u.fullName || '—'}</td>
                    <td>{ROLES.find((r) => r.value === u.role)?.label || u.role}</td>
                    <td>{u.isActive ? 'Активен' : 'Отключён'}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => startEdit(u)}>
                        Изменить
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
