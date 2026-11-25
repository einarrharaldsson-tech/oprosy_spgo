import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

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
  municipalityId: '',
};

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [userData, muniData] = await Promise.all([
      api('/users'),
      api('/municipalities?all=1'),
    ]);
    setUsers(userData);
    setMunicipalities(muniData);
    if (!form.municipalityId && muniData.length) {
      const active = muniData.find((m) => m.isActive) || muniData[0];
      setForm((prev) => ({ ...prev, municipalityId: String(active.id) }));
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      const body = {
        ...form,
        municipalityId:
          form.role === 'admin'
            ? form.municipalityId
              ? Number(form.municipalityId)
              : null
            : Number(form.municipalityId),
      };
      await api('/users', { method: 'POST', body });
      setForm({
        ...emptyForm,
        municipalityId: form.municipalityId || (municipalities[0] ? String(municipalities[0].id) : ''),
      });
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
      municipalityId: u.municipalityId ? String(u.municipalityId) : '',
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
        municipalityId:
          edit.role === 'admin'
            ? edit.municipalityId
              ? Number(edit.municipalityId)
              : null
            : Number(edit.municipalityId),
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

  const removeUser = async (u) => {
    const label = u.fullName ? `${u.fullName} (${u.login})` : u.login;
    const okConfirm = window.confirm(
      `Удалить пользователя «${label}»?\n\n` +
        `Если у него были проведения опросов, в истории они останутся за администратором.`
    );
    if (!okConfirm) return;
    setError('');
    setOk('');
    try {
      const result = await api(`/users/${u.id}`, { method: 'DELETE' });
      if (editId === u.id) setEditId(null);
      const moved = Number(result?.responsesReassigned || 0);
      setOk(
        moved > 0
          ? `Пользователь удалён. Проведений переназначено администратору: ${moved}.`
          : 'Пользователь удалён.'
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;

  const muniOptions = municipalities.filter((m) => m.isActive || true);

  return (
    <div>
      <h1 className="page-title">Пользователи</h1>
      <p className="page-sub">
        Администратор — пользователи и конструктор (видит все округа). Редактор и пользователь —
        только свой округ. При удалении пользователя его проведения в истории остаются за
        администратором.
      </p>

      {error && (
        <div className="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {ok && (
        <div className="alert alert-ok" style={{ marginBottom: 12 }}>
          {ok}
        </div>
      )}

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
        <div className="field">
          <label>
            Округ{form.role === 'admin' ? ' (необязательно)' : ''}
          </label>
          <select
            value={form.municipalityId}
            onChange={(e) => setForm({ ...form, municipalityId: e.target.value })}
            required={form.role !== 'admin'}
          >
            {form.role === 'admin' && <option value="">— Все округа —</option>}
            {muniOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nameShort} — {m.nameFull}
                {!m.isActive ? ' (отключён)' : ''}
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
              <th>Округ</th>
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
                      <select
                        value={edit.municipalityId}
                        onChange={(e) => setEdit({ ...edit, municipalityId: e.target.value })}
                        required={edit.role !== 'admin'}
                      >
                        {edit.role === 'admin' && <option value="">— Все округа —</option>}
                        {muniOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nameShort}
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
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => saveEdit(u.id)}
                        >
                          ОК
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setEditId(null)}
                        >
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
                    <td>
                      {u.municipalityNameShort ||
                        (u.role === 'admin' ? 'Все' : '—')}
                    </td>
                    <td>{u.isActive ? 'Активен' : 'Отключён'}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost" onClick={() => startEdit(u)}>
                          Изменить
                        </button>
                        {me?.id !== u.id && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => removeUser(u)}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
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
