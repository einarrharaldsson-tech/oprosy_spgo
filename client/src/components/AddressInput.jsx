import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Address input with DaData suggestions via our API proxy.
 */
export default function AddressInput({
  value,
  onChange,
  required,
  disabled,
  placeholder = 'Начните вводить адрес',
}) {
  const listId = useId();
  const wrapRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [hint, setHint] = useState('');
  const seqRef = useRef(0);

  useEffect(() => {
    if (disabled) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }

    const q = String(value || '').trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setHint('');
      return undefined;
    }

    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api('/dadata/address', {
          method: 'POST',
          body: { query: q, count: 7 },
        });
        if (seq !== seqRef.current) return;
        const list = data.suggestions || [];
        setSuggestions(list);
        setOpen(list.length > 0);
        setHighlight(-1);
        setHint('');
      } catch (err) {
        if (seq !== seqRef.current) return;
        setSuggestions([]);
        setOpen(false);
        setHint(err.message || 'Подсказки недоступны');
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value, disabled]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (item) => {
    onChange(item.value || item.unrestrictedValue || '');
    setSuggestions([]);
    setOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="address-suggest" ref={wrapRef}>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onKeyDown={onKeyDown}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {loading && <span className="address-suggest-status muted">Поиск…</span>}
      {hint && !loading && <span className="address-suggest-status muted">{hint}</span>}
      {open && suggestions.length > 0 && (
        <ul id={listId} className="address-suggest-list" role="listbox">
          {suggestions.map((s, i) => (
            <li key={`${s.value}-${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                className={i === highlight ? 'is-active' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                {s.value}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
