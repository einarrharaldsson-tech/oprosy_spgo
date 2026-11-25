import { useEffect, useState } from 'react';
import { api } from '../api';

const emptyForm = {
  inn: '',
  nameFull: '',
  nameShort: '',
};

export default function AdminMunicipalitiesPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const data = await api('/municipalities?all=1');
    setItems(data);
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
      await api('/municipalities', { method: 'POST', body: form });
      setForm(emptyForm);
      setOk('Округ создан');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (m) => {
    setEditId(m.id);
    setEdit({
      inn: m.inn || '',
      nameFull: m.nameFull || '',
      nameShort: m.nameShort || '',
      isActive: m.isActive,
    });
  };

  const saveEdit = async (id) => {
    setError('');
    setOk('');
    try {
      await api(`/municipalities/${id}`, {
        method: 'PUT',
        body: {
          inn: edit.inn,
          nameFull: edit.nameFull,
          nameShort: edit.nameShort,
          isActive: edit.isActive,
        },
      });
      setEditId(null);
      setOk('Сохранено');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeItem = async (m) => {
    const okConfirm = window.confirm(
      `Удалить округ «${m.nameFull}»?\n\nУдаление возможно только если нет пользователей и опросов.`
    );
    if (!okConfirm) return;
    setError('');
    setOk('');
    try {
      await api(`/municipalities/${m.id}`, { method: 'DELETE' });
      if (editId === m.id) setEditId(null);
      setOk('Округ удалён');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;

  return (
    <div>
      <h1 className="page-title">Округа</h1>
      <p className="page-sub">
        Муниципалитеты для изоляции данных. Пользователи и опросы привязываются к округу; администраторы
        видят все округа.
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
        <h3 style={{ margin: 0 }}>Новый округ</h3>
        <div className="field">
          <label>ИНН</label>
          <input
            value={form.inn}
            onChange={(e) => setForm({ ...form, inn: e.target.value })}
            required
            inputMode="numeric"
            pattern="\d{10}|\d{12}"
            title="10 или 12 цифр"
          />
        </div>
        <div className="field">
          <label>Полное наименование</label>
          <input
            value={form.nameFull}
            onChange={(e) => setForm({ ...form, nameFull: e.target.value })}
            required
            placeholder="Сергиево - Посадский городской округ"
          />
        </div>
        <div className="field">
          <label>Краткое наименование</label>
          <input
            value={form.nameShort}
            onChange={(e) => setForm({ ...form, nameShort: e.target.value })}
            required
            placeholder="СПГО"
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Создать
        </button>
      </form>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>ИНН</th>
              <th>Полное</th>
              <th>Краткое</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                {editId === m.id ? (
                  <>
                    <td>
                      <input
                        value={edit.inn}
                        onChange={(e) => setEdit({ ...edit, inn: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={edit.nameFull}
                        onChange={(e) => setEdit({ ...edit, nameFull: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={edit.nameShort}
                        onChange={(e) => setEdit({ ...edit, nameShort: e.target.value })}
                      />
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
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => saveEdit(m.id)}
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
                    <td>{m.inn}</td>
                    <td>{m.nameFull}</td>
                    <td>{m.nameShort}</td>
                    <td>{m.isActive ? 'Активен' : 'Отключён'}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost" onClick={() => startEdit(m)}>
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => removeItem(m)}
                        >
                          Удалить
                        </button>
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
