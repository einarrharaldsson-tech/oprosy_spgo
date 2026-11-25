import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

const ALL_ROLES = [
  { value: 'admin', label: 'Администратор' },
  { value: 'editor', label: 'Редактор' },
  { value: 'user', label: 'Пользователь' },
];

const EDITOR_ROLES = [
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

function roleLabel(role) {
  return ALL_ROLES.find((r) => r.value === role)?.label || role;
}

function sortUsers(list) {
  return [...list].sort((a, b) => {
    const an = (a.fullName || a.login || '').toLocaleLowerCase('ru');
    const bn = (b.fullName || b.login || '').toLocaleLowerCase('ru');
    return an.localeCompare(bn, 'ru');
  });
}

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'admin';
  const roleOptions = isAdmin ? ALL_ROLES : EDITOR_ROLES;
  const [users, setUsers] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const [userData, muniData] = await Promise.all([
      api('/users'),
      api(isAdmin ? '/municipalities?all=1' : '/municipalities'),
    ]);
    setUsers(userData);
    setMunicipalities(muniData);
    const defaultMuni =
      me?.municipalityId != null
        ? String(me.municipalityId)
        : muniData[0]
          ? String(muniData[0].id)
          : '';
    setForm((prev) => ({
      ...prev,
      municipalityId: prev.municipalityId || defaultMuni,
      role: isAdmin ? prev.role : prev.role === 'admin' ? 'user' : prev.role,
    }));
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

  const grouped = useMemo(() => {
    const admins = sortUsers(users.filter((u) => u.role === 'admin'));
    const others = users.filter((u) => u.role !== 'admin');
    const byMuni = new Map();
    for (const u of others) {
      const key = u.municipalityId != null ? String(u.municipalityId) : 'none';
      if (!byMuni.has(key)) byMuni.set(key, []);
      byMuni.get(key).push(u);
    }
    const muniOrder = municipalities.map((m) => String(m.id));
    const keys = [...byMuni.keys()].sort((a, b) => {
      if (a === 'none') return 1;
      if (b === 'none') return -1;
      const ia = muniOrder.indexOf(a);
      const ib = muniOrder.indexOf(b);
      if (ia === -1 && ib === -1) {
        const na = byMuni.get(a)[0]?.municipalityNameFull || '';
        const nb = byMuni.get(b)[0]?.municipalityNameFull || '';
        return na.localeCompare(nb, 'ru');
      }
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    const blocks = keys.map((key) => {
      const list = sortUsers(byMuni.get(key));
      const m = municipalities.find((x) => String(x.id) === key);
      const title = m
        ? `${m.nameShort} — ${m.nameFull}`
        : list[0]?.municipalityNameFull ||
          list[0]?.municipalityNameShort ||
          'Без округа';
      return { key, title, short: m?.nameShort || list[0]?.municipalityNameShort || '—', users: list };
    });
    return { admins, blocks };
  }, [users, municipalities]);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      const body = {
        login: form.login,
        password: form.password,
        fullName: form.fullName,
        role: form.role,
        municipalityId: isAdmin
          ? form.role === 'admin'
            ? form.municipalityId
              ? Number(form.municipalityId)
              : null
            : Number(form.municipalityId)
          : Number(me.municipalityId),
      };
      await api('/users', { method: 'POST', body });
      setForm({
        ...emptyForm,
        role: 'user',
        municipalityId: isAdmin
          ? form.municipalityId
          : me?.municipalityId
            ? String(me.municipalityId)
            : '',
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
        municipalityId: isAdmin
          ? edit.role === 'admin'
            ? edit.municipalityId
              ? Number(edit.municipalityId)
              : null
            : Number(edit.municipalityId)
          : Number(me.municipalityId),
      };
      if (isAdmin) body.isActive = edit.isActive;
      if (edit.password) body.password = edit.password;
      await api(`/users/${id}`, { method: 'PUT', body });
      setEditId(null);
      setOk('Сохранено');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const setBlocked = async (u, blocked) => {
    if (!isAdmin) return;
    if (u.role === 'admin') {
      setError('Администраторов блокировать нельзя');
      return;
    }
    const label = u.fullName ? `${u.fullName} (${u.login})` : u.login;
    const okConfirm = window.confirm(
      blocked
        ? `Заблокировать «${label}»? Вход будет запрещён.`
        : `Разблокировать «${label}»?`
    );
    if (!okConfirm) return;
    setError('');
    setOk('');
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: { isActive: !blocked } });
      setOk(blocked ? 'Учётная запись заблокирована' : 'Учётная запись разблокирована');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const removeUser = async (u) => {
    const label = u.fullName ? `${u.fullName} (${u.login})` : u.login;
    const okConfirm = window.confirm(
      `Удалить пользователя «${label}»?\n\n` +
        `Если у него были проведения опросов, в истории они останутся за вами.`
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
          ? `Пользователь удалён. Проведений переназначено: ${moved}.`
          : 'Пользователь удалён.'
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;

  const muniOptions = municipalities;
  const myMuniLabel =
    me?.municipality?.nameFull ||
    me?.municipality?.nameShort ||
    municipalities.find((m) => Number(m.id) === Number(me?.municipalityId))?.nameFull ||
    '';

  const renderRow = (u, { showMunicipality }) => {
    if (editId === u.id) {
      return (
        <tr key={u.id}>
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
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </td>
          {showMunicipality && (
            <td>
              {isAdmin ? (
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
              ) : (
                u.municipalityNameShort || myMuniLabel || '—'
              )}
            </td>
          )}
          <td>
            {isAdmin && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={edit.isActive}
                  onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })}
                />
                Активен
              </label>
            )}
            {!isAdmin && (u.isActive ? 'Активен' : 'Заблокирован')}
            <input
              type="password"
              placeholder="Новый пароль"
              value={edit.password}
              onChange={(e) => setEdit({ ...edit, password: e.target.value })}
              style={{ marginTop: 6, width: '100%' }}
            />
          </td>
          <td>
            <div className="users-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => saveEdit(u.id)}
              >
                ОК
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditId(null)}
              >
                Отмена
              </button>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={u.id}>
        <td>{u.login}</td>
        <td>{u.fullName || '—'}</td>
        <td>{roleLabel(u.role)}</td>
        {showMunicipality && (
          <td>
            {u.municipalityNameShort || (u.role === 'admin' ? 'Все' : '—')}
          </td>
        )}
        <td>{u.isActive ? 'Активен' : 'Заблокирован'}</td>
        <td>
          <div className="users-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => startEdit(u)}
            >
              Изменить
            </button>
            {isAdmin && me?.id !== u.id && u.role !== 'admin' && (
              <button
                type="button"
                className={`btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-primary'}`}
                disabled={busyId === u.id}
                onClick={() => setBlocked(u, u.isActive)}
              >
                {u.isActive ? 'Заблокировать' : 'Разблокировать'}
              </button>
            )}
            {me?.id !== u.id && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => removeUser(u)}
              >
                Удалить
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const renderTable = (list, { showMunicipality }) => (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table className="table table--users">
        <thead>
          <tr>
            <th>Логин</th>
            <th>ФИО</th>
            <th>Роль</th>
            {showMunicipality && <th>Округ</th>}
            <th>Статус</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.length ? (
            list.map((u) => renderRow(u, { showMunicipality }))
          ) : (
            <tr>
              <td colSpan={showMunicipality ? 6 : 5} className="muted">
                Нет пользователей
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <h1 className="page-title">Пользователи</h1>
      <p className="page-sub">
        {isAdmin
          ? 'Администраторы — отдельно; остальные сгруппированы по округам. Блокировка входа доступна только администратору.'
          : `Редактор создаёт пользователей только своего округа${myMuniLabel ? ` («${myMuniLabel}»)` : ''}.`}
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
            {roleOptions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {isAdmin ? (
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
        ) : (
          <div className="field">
            <label>Округ</label>
            <input value={myMuniLabel || 'Ваш округ'} disabled readOnly />
          </div>
        )}
        <button className="btn btn-primary" type="submit">
          Создать
        </button>
      </form>

      {isAdmin && (
        <section className="users-section">
          <h2 className="users-section__title">Администраторы</h2>
          <p className="users-section__meta">{grouped.admins.length} учётных записей</p>
          {renderTable(grouped.admins, { showMunicipality: true })}
        </section>
      )}

      {grouped.blocks.map((block) => (
        <section key={block.key} className="users-section">
          <h2 className="users-section__title">{block.title}</h2>
          <p className="users-section__meta">
            {block.users.length}{' '}
            {block.users.length === 1
              ? 'пользователь'
              : block.users.length > 1 && block.users.length < 5
                ? 'пользователя'
                : 'пользователей'}
          </p>
          {renderTable(block.users, { showMunicipality: false })}
        </section>
      ))}

      {!isAdmin && !grouped.blocks.length && (
        <div className="empty">Пока нет пользователей в вашем округе</div>
      )}
    </div>
  );
}
