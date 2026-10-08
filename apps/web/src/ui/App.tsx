import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { applyLocale, translate, type Key, type Locale } from '../i18n';
import { createIssue } from '../local/actions';
import type { LocalDb } from '../local/db';
import type { SyncEngine } from '../local/engine';

const CATEGORIES = ['Plumbing', 'Electrical', 'HVAC', 'Fire Protection', 'Civil', 'Finishing', 'Safety'];

/** A deliberately small shell: it proves the offline layer end to end. MVP screens are built on top of it. */
export function App({ db, engine }: { db: LocalDb; engine: SyncEngine }) {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [locale, setLocale] = useState<Locale>('en');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [error, setError] = useState('');
  const photo = useRef<HTMLInputElement>(null);
  const t = (key: Key, vars?: Record<string, string | number>) => translate(locale, key, vars);

  useEffect(() => applyLocale(locale), [locale]);
  useEffect(() => {
    void db.get('meta', 'projects').then((p) => setProjects((p as typeof projects) ?? []));
  }, [db, snap]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!projects[0]) return setError(t('new.needProject'));
    if (!title) return setError(t('new.what'));
    setError('');
    await createIssue(db, { projectId: projects[0].id, title, category, locationText: String(data.get('where') ?? '').trim() || null }, photo.current?.files?.[0]);
    form.reset();
    void engine.kick();
  }

  return (
    <div className="shell">
      <header className="bar">
        <strong>{projects[0]?.name ?? t('app.title')}</strong>
        <span className={`sync sync-${snap.state}`} role="status">
          <i aria-hidden="true" />
          {t(`sync.${snap.state}`)}
          {snap.waiting > 0 && ` · ${t('sync.waiting', { n: snap.waiting })}`}
        </span>
        <button type="button" className="quiet" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}>{t('lang.switch')}</button>
      </header>

      {snap.refused.length > 0 && (
        <section className="refused" aria-label={t('refused.title')}>
          <h2>{t('refused.title')}</h2>
          {snap.refused.map((r) => (
            <p key={r.seq}>
              {r.message} <button type="button" className="quiet" onClick={() => void engine.dismissRefused(r.seq)}>{t('refused.dismiss')}</button>
            </p>
          ))}
        </section>
      )}

      <main>
        <h1>{t('issues.title')}</h1>
        {snap.issues.length === 0 && <p className="empty">{t('issues.empty')}</p>}
        <ul className="list">
          {snap.issues.map((i) => (
            <li key={i.id}>
              <span className="num">{i.number ? `#${i.number}` : t('issues.notSent')}</span>
              <span className="title">{i.title}</span>
              <span className="meta">{[i.locationText, i.category].filter(Boolean).join(' · ')}</span>
              <span className={`pill pill-${i.status}`}>{t(`status.${i.status}`)}</span>
            </li>
          ))}
        </ul>

        <form className="new" onSubmit={(e) => void onCreate(e)}>
          <h2>{t('new.title')}</h2>
          <label className="btn">
            {t('new.photo')}
            <input ref={photo} type="file" accept="image/*" capture="environment" hidden />
          </label>
          <label>{t('new.where')}<input name="where" autoComplete="off" /></label>
          <fieldset>
            <legend>{t('new.kind')}</legend>
            {CATEGORIES.map((c) => (
              <button type="button" key={c} className="chip" aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </fieldset>
          <label>{t('new.what')}<input name="title" autoComplete="off" /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn primary">{t('new.create')}</button>
        </form>
      </main>
    </div>
  );
}
