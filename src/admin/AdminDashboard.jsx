import { translateExternalMessage } from '../i18n/externalMessages.js';
import { translate, getIntlLocale } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, CircleUserRound,
  Clock3, Eye, FileClock, KeyRound, Laptop, LockKeyhole, RefreshCw, Search,
  Orbit, ShieldAlert, ShieldCheck, Smartphone, Sun, Tablet, UserCheck, UserCog, UsersRound, UserX, Waves,
} from 'lucide-react';
import { adminApi } from './adminApi.js';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'visits', label: 'Visits', icon: Eye },
  { id: 'planets', label: 'Planets', icon: Orbit },
  { id: 'audit', label: 'Audit log', icon: FileClock },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

const BODY_LABELS = { planet: 'Planet', gas: 'Gas giant', star: 'Star' };
const BODY_ICONS = { planet: Orbit, gas: Waves, star: Sun };
const BodyIcon = ({ type }) => {
  useLocale(); const Icon = BODY_ICONS[type] ?? Orbit; return <Icon size={14} />; };

const number = { format: value => new Intl.NumberFormat(getIntlLocale()).format(value) };
const shortDate = { format: value => new Intl.DateTimeFormat(getIntlLocale(), { month: 'short', day: 'numeric' }).format(value) };
const dateTime = { format: value => new Intl.DateTimeFormat(getIntlLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value) };

const formatDate = (value, fallback = translate('Never')) => value ? dateTime.format(new Date(value)) : translate(fallback);
const actionLabel = (value = '') => translate(value) !== value ? translate(value) : value.split('.').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' · ');
const localDayKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function LoadingState() {
  useLocale();
  return <div className="admin-loading" role="status"><span /><strong>{translate("Loading secure data")}</strong><small>{translate("Retrieving the latest administration records…")}</small></div>;
}

function ErrorState({ message, onRetry }) {
  useLocale();
  return (
    <div className="admin-error" role="alert">
      <ShieldAlert size={22} />
      <strong>{translate("Couldn't load this view")}</strong>
      <span>{translateExternalMessage(message) || translate('The administration service did not respond.')}</span>
      <button type="button" onClick={onRetry}><RefreshCw size={13} /> {translate("Try again")}</button>
    </div>
  );
}

function Pagination({ page, pages, onPage }) {
  useLocale();
  if (pages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label={translate("Results pages")}>
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /> {translate("Previous")}</button>
      <span>{translate("Page")} <strong>{page}</strong> {translate("of")} {pages}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages}>{translate("Next")} <ChevronRight size={14} /></button>
    </nav>
  );
}

function TrendChart({ data = [], valueKey = 'visits', days: requestedDays = 14, valueLabel: requestedValueLabel }) {
  useLocale();
  const days = Math.max(1, Number(requestedDays) || 14);
  const valueLabel = requestedValueLabel || valueKey.replace(/([A-Z])/g, ' $1').toLowerCase();
  const points = useMemo(() => {
    const byDay = new Map(data.map((item) => [localDayKey(item.day), item]));
    return Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (days - 1 - index));
      const key = localDayKey(date);
      return { day: date, value: Number(byDay.get(key)?.[valueKey] ?? 0) };
    });
  }, [data, days, valueKey]);
  const max = Math.max(1, ...points.map((item) => item.value));
  const labelStep = days <= 7 ? 2 : days <= 31 ? 7 : 14;
  const shouldLabel = (index) => index === 0 || index === points.length - 1 || index % labelStep === 0;
  const [activeIndex, setActiveIndex] = useState(null);
  return (
    <div className="admin-chart" role="group" aria-label={translate("Daily {0} over the last {1} days", { 0: valueLabel, 1: days })}>
      <div className="admin-chart-grid" aria-hidden="true"><i /><i /><i /></div>
      <div className="admin-chart-bars">
        {points.map((item, index) => (
          <span
            className={`admin-chart-column ${activeIndex === index ? 'is-active' : ''}`}
            key={item.day.toISOString()}
            tabIndex="0"
            aria-label={`${shortDate.format(item.day)}: ${number.format(item.value)} ${valueLabel}`}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
          >
            <span className="admin-chart-bar" style={{ height: `${Math.max(item.value ? 6 : 2, (item.value / max) * 100)}%` }}>
              <span className="admin-chart-tooltip" role="status"><strong>{number.format(item.value)}</strong><small>{shortDate.format(item.day)}</small><em>{valueLabel}</em></span>
            </span>
            {shouldLabel(index) && <small>{shortDate.format(item.day)}</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

const REPORTING_RANGES = [
  { value: 7, label: 'Weekly' },
  { value: 30, label: 'Monthly' },
  { value: 90, label: '90 days' },
];

function RangeSelector({ value, onChange, label = translate('Reporting period') }) {
  useLocale();
  return (
    <div className="admin-range-selector" role="group" aria-label={translate(label)}>
      {REPORTING_RANGES.map((range) => (
        <button type="button" key={range.value} className={value === range.value ? 'active' : ''} onClick={() => onChange(range.value)} aria-pressed={value === range.value}>
          {translate(range.label)}
        </button>
      ))}
    </div>
  );
}

function Overview({ data, onNavigate, rangeDays, onRangeChange }) {
  useLocale();
  const rangeLabel = translate(REPORTING_RANGES.find((range) => range.value === rangeDays)?.label)?.toLowerCase() || translate("{0} days", { 0: rangeDays });
  const stats = [
    { label: translate('Total users'), value: data.counts.users, meta: translate("{0} active", { 0: number.format(data.counts.activeUsers) }), icon: UsersRound, tone: 'blue' },
    { label: translate('Visits today'), value: data.counts.visitsToday, meta: translate("{0} unique", { 0: number.format(data.counts.uniqueToday) }), icon: Activity, tone: 'green' },
    { label: translate('Planets'), value: data.counts.planets, meta: data.bodyTypes.map((item) => `${number.format(item.projects)} ${translate(BODY_LABELS[item.type]).toLowerCase()}`).join(' · '), icon: Orbit, tone: 'violet' },
    { label: translate('Open sessions'), value: data.counts.openSessions, meta: translate('Unexpired sessions'), icon: KeyRound, tone: 'amber' },
  ];
  return (
    <div className="admin-overview">
      <section className="admin-stat-grid" aria-label={translate("Service overview")}>
        {stats.map(({ label, value, meta, icon: Icon, tone }) => (
          <article className={`admin-stat ${tone}`} key={label}>
            <span className="admin-stat-icon"><Icon size={18} /></span>
            <span><small>{translate(label)}</small><strong>{number.format(value)}</strong><em>{meta}</em></span>
          </article>
        ))}
      </section>

      <section className="admin-panel admin-trend-panel">
        <header>
          <div><span className="admin-eyebrow">{translate("Traffic")}</span><h2>{translate("Visits over the last {0} days", { 0: rangeDays })}</h2></div>
          <div className="admin-panel-actions"><RangeSelector value={rangeDays} onChange={onRangeChange} /><button type="button" className="admin-text-button" onClick={() => onNavigate('visits')}>{translate("View visit log")} <ChevronRight size={13} /></button></div>
        </header>
        <TrendChart data={data.visitTrend} days={rangeDays} valueLabel={translate("page visits")} />
        <div className="admin-chart-legend"><span><i className="blue" /> {translate("Page visits")}</span><span><i className="muted" /> {translate("Daily values ·")} {rangeLabel}</span></div>
      </section>

      <div className="admin-overview-columns">
        <section className="admin-panel">
          <header><div><span className="admin-eyebrow">{translate("Latest work")}</span><h2>{translate("Recent planets")}</h2></div><button type="button" className="admin-icon-button" onClick={() => onNavigate('planets')} aria-label={translate("View all planets")}><ChevronRight size={15} /></button></header>
          <div className="admin-compact-list">
            {data.recentPlanets.length === 0 && <p className="admin-empty">{translate("No cloud planets yet.")}</p>}
            {data.recentPlanets.map((planet) => (
              <div key={planet.id}>
                <span className="admin-list-icon"><BodyIcon type={planet.bodyType} /></span>
                <span><strong>{planet.name}</strong><small>@{planet.username} · {translate(BODY_LABELS[planet.bodyType] ?? 'Planet')} · {formatDate(planet.updatedAt)}</small></span>
                <span className={`admin-badge ${planet.visibility}`}>{translate(planet.visibility)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-panel">
          <header><div><span className="admin-eyebrow">{translate("Accountability")}</span><h2>{translate("Administrator activity")}</h2></div><button type="button" className="admin-icon-button" onClick={() => onNavigate('audit')} aria-label={translate("View audit log")}><ChevronRight size={15} /></button></header>
          <div className="admin-compact-list audit">
            {data.recentAudit.length === 0 && <p className="admin-empty">{translate("No administrator changes recorded yet.")}</p>}
            {data.recentAudit.map((event) => (
              <div key={event.id}>
                <span className="admin-list-icon"><FileClock size={14} /></span>
                <span><strong>{actionLabel(event.action)}</strong><small>{event.actor} · {formatDate(event.createdAt)}</small></span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function UsersPanel({ currentUser }) {
  useLocale();
  const { showPopup, showConfirm } = usePopup();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [verified, setVerified] = useState('');
  const [activity, setActivity] = useState('');
  const [planets, setPlanets] = useState('');
  const [sessions, setSessions] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.users({ page, q: query, status, role, verified, activity, planets, sessions })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, query, status, role, verified, activity, planets, sessions]);
  useEffect(() => { load(); }, [load]);

  const update = async (target, patch) => {
    const isSuspend = patch.status === 'suspended';
    const isDemote = patch.role === 'user';
    const confirmed = await showConfirm({
      title: isSuspend ? translate('Suspend this account?') : isDemote ? translate('Remove administrator access?') : translate('Confirm account change'),
      message: isSuspend
        ? translate("{0} will be signed out everywhere and unable to sign in until reactivated.", { 0: target.username })
        : isDemote ? translate("{0} will immediately lose access to administration data.", { 0: target.username })
          : translate("Apply this change to {0}?", { 0: target.username }),
      confirmLabel: isSuspend ? translate('Suspend account') : translate('Apply change'),
      danger: isSuspend || isDemote,
    });
    if (!confirmed) return;
    setBusy(target.id);
    try {
      const result = await adminApi.updateUser(target.id, patch);
      setData((current) => ({ ...current, users: current.users.map((user) => user.id === target.id ? result.user : user) }));
      showPopup(translate('The account was updated and the action was added to the audit log.'), { type: 'success', title: translate('User updated') });
    } catch (nextError) {
      showPopup(nextError.message, { type: 'error', title: translate('Update blocked') });
    } finally { setBusy(''); }
  };

  const revoke = async (target) => {
    const confirmed = await showConfirm({
      title: translate('Revoke all sessions?'),
      message: translate("{0} will be signed out on every device. Their password will not change.", { 0: target.username }),
      confirmLabel: translate('Revoke sessions'),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(target.id);
    try {
      const result = await adminApi.revokeSessions(target.id);
      setData((current) => ({ ...current, users: current.users.map((user) => user.id === target.id ? { ...user, activeSessions: 0 } : user) }));
      showPopup(translate("{0} session{1} revoked.", { 0: result.revoked, 1: result.revoked === 1 ? '' : 's' }), { type: 'success', title: translate('Sessions closed') });
    } catch (nextError) {
      showPopup(nextError.message, { type: 'error', title: translate('Could not revoke sessions') });
    } finally { setBusy(''); }
  };

  return (
    <section className="admin-panel admin-data-panel">
      <header className="admin-data-head">
        <div><span className="admin-eyebrow">{translate("Accounts")}</span><h2>{translate("User management")}</h2><p>{translate("Review access, roles, account status, and sessions.")}</p></div>
        <button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> {translate("Refresh")}</button>
      </header>
      <form className="admin-filters users-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}>
        <label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translate("Search name, username, or email")} aria-label={translate("Search users")} /></label>
        <select value={translateExternalMessage(status)} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label={translate("Filter user status")}>
          <option value="">{translate("All statuses")}</option><option value="active">{translate("Active")}</option><option value="suspended">{translate("Suspended")}</option>
        </select>
        <select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }} aria-label={translate("Filter user role")}>
          <option value="">{translate("All roles")}</option><option value="admin">{translate("Administrators")}</option><option value="user">{translate("Members")}</option>
        </select>
        <select value={verified} onChange={(event) => { setPage(1); setVerified(event.target.value); }} aria-label={translate("Filter email verification")}>
          <option value="">{translate("All verification")}</option><option value="verified">{translate("Verified email")}</option><option value="unverified">{translate("Unverified email")}</option>
        </select>
        <select value={planets} onChange={(event) => { setPage(1); setPlanets(event.target.value); }} aria-label={translate("Filter planet ownership")}>
          <option value="">{translate("All planet activity")}</option><option value="has">{translate("Has planets")}</option><option value="none">{translate("No planets")}</option>
        </select>
        <select value={activity} onChange={(event) => { setPage(1); setActivity(event.target.value); }} aria-label={translate("Filter recent activity")}>
          <option value="">{translate("Any last seen")}</option><option value="7d">{translate("Seen in 7 days")}</option><option value="30d">{translate("Seen in 30 days")}</option><option value="never">{translate("Never seen")}</option>
        </select>
        <select value={sessions} onChange={(event) => { setPage(1); setSessions(event.target.value); }} aria-label={translate("Filter active sessions")}>
          <option value="">{translate("All sessions")}</option><option value="active">{translate("Has active sessions")}</option><option value="none">{translate("No active sessions")}</option>
        </select>
        <button type="submit">{translate("Search")}</button>
      </form>
      {!data && !error && <LoadingState />}
      {error && <ErrorState message={translateExternalMessage(error)} onRetry={load} />}
      {data && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{translate("User")}</th><th>{translate("Status")}</th><th>{translate("Role")}</th><th>{translate("Planets")}</th><th>{translate("Sessions")}</th><th>{translate("Last seen")}</th><th><span className="sr-only">{translate("Actions")}</span></th></tr></thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id}>
                    <td><span className="admin-user-cell"><span className="admin-user-avatar">{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span><span><strong>{user.displayName || user.username}{user.id === currentUser.id && <em>{translate("You")}</em>}</strong><small>@{user.username} · {user.email}</small></span></span></td>
                    <td><span className={`admin-status ${user.status}`}><i />{translate(user.status)}</span></td>
                    <td><span className={`admin-role ${user.role}`}><ShieldCheck size={12} /> {translate(user.role)}</span></td>
                    <td>{number.format(user.projectCount)}</td>
                    <td>{number.format(user.activeSessions)}</td>
                    <td><span className="admin-muted">{formatDate(user.lastSeenAt)}</span></td>
                    <td>
                      <div className="admin-row-actions">
                        {user.status === 'active'
                          ? <button type="button" className="danger" disabled={busy === user.id || user.id === currentUser.id} onClick={() => update(user, { status: 'suspended' })}><UserX size={13} /> {translate("Suspend")}</button>
                          : <button type="button" disabled={busy === user.id} onClick={() => update(user, { status: 'active' })}><UserCheck size={13} /> {translate("Activate")}</button>}
                        {user.role === 'admin'
                          ? <button type="button" disabled={busy === user.id || user.id === currentUser.id} onClick={() => update(user, { role: 'user' })}><CircleUserRound size={13} /> {translate("Make member")}</button>
                          : <button type="button" disabled={busy === user.id} onClick={() => update(user, { role: 'admin' })}><UserCog size={13} /> {translate("Make admin")}</button>}
                        <button type="button" disabled={busy === user.id || user.id === currentUser.id || user.activeSessions === 0} onClick={() => revoke(user)}><KeyRound size={13} /> {translate("Revoke sessions")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.users.length === 0 && <p className="admin-empty">{translate("No users match these filters.")}</p>}
          </div>
          <footer className="admin-results-footer"><span>{number.format(data.total)} {translate("user")}{data.total === 1 ? '' : 's'}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer>
        </>
      )}
    </section>
  );
}

function VisitsPanel() {
  useLocale();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [days, setDays] = useState(30);
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.visits({ page, days })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, days]);
  useEffect(() => { load(); }, [load]);
  const DeviceIcon = ({ device }) => device === 'Mobile' ? <Smartphone size={13} /> : device === 'Tablet' ? <Tablet size={13} /> : <Laptop size={13} />;
  return (
    <div className="admin-stack">
      {data && <section className="admin-panel admin-trend-panel"><header><div><span className="admin-eyebrow">{translate("Audience")}</span><h2>{translate("Visits and unique visitors")}</h2></div><RangeSelector value={days} onChange={(value) => { setPage(1); setDays(value); }} /></header><div className="admin-inline-metrics"><div><strong>{number.format(data.summary?.visits ?? data.total)}</strong><span>{translate("Total visits")}</span></div><div><strong>{number.format(data.summary?.uniqueVisitors ?? 0)}</strong><span>{translate("Unique visitors")}</span></div><div><strong>{number.format(data.summary?.averagePerDay ?? 0)}</strong><span>{translate("Average per day")}</span></div></div><TrendChart data={data.trend} days={days} valueLabel={translate("page visits")} /><div className="admin-chart-legend"><span><i className="blue" /> {translate("Page visits")}</span><span><i className="green" /> {translate("Hover a day for the exact count")}</span></div></section>}
      <section className="admin-panel admin-data-panel">
        <header className="admin-data-head"><div><span className="admin-eyebrow">{translate("Recent traffic")}</span><h2>{translate("Visit log")}</h2><p>{translate("Raw network addresses are never shown or stored.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> {translate("Refresh")}</button></header>
        {!data && !error && <LoadingState />}{error && <ErrorState message={translateExternalMessage(error)} onRetry={load} />}
        {data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{translate("Time")}</th><th>{translate("Path")}</th><th>{translate("Visitor")}</th><th>{translate("Device")}</th><th>{translate("Referrer")}</th></tr></thead><tbody>{data.visits.map((visit) => <tr key={visit.id}><td><span className="admin-muted">{formatDate(visit.createdAt)}</span></td><td><code>{visit.path}</code></td><td>{visit.username ? `@${visit.username}` : <span className="admin-muted">{translate("Anonymous")}</span>}</td><td><span className="admin-device"><DeviceIcon device={visit.device} />{translate(visit.device)}</span></td><td><span className="admin-muted">{visit.referrerHost || translate('Direct')}</span></td></tr>)}</tbody></table>{data.visits.length === 0 && <p className="admin-empty">{translate("No visits in this period.")}</p>}</div><footer className="admin-results-footer"><span>{number.format(data.total)} {translate("visits")}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
      </section>
    </div>
  );
}

function PlanetsPanel() {
  useLocale();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('');
  const [type, setType] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.planets({ page, q: query, visibility, type })); }
    catch (requestError) { setError(requestError.message); }
  }, [page, query, visibility, type]);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="admin-panel admin-data-panel">
      <header className="admin-data-head"><div><span className="admin-eyebrow">{translate("Cloud library")}</span><h2>{translate("Recent planets")}</h2><p>{translate("Metadata only; private planet content is not exposed here.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> {translate("Refresh")}</button></header>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}>
        <label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translate("Search planet or owner")} aria-label={translate("Search planets")} /></label>
        <select value={type} onChange={(event) => { setPage(1); setType(event.target.value); }} aria-label={translate("Filter body type")}><option value="">{translate("All bodies")}</option><option value="planet">{translate("Planets")}</option><option value="gas">{translate("Gas giants")}</option><option value="star">{translate("Stars")}</option></select>
        <select value={visibility} onChange={(event) => { setPage(1); setVisibility(event.target.value); }} aria-label={translate("Filter planet visibility")}><option value="">{translate("All visibility")}</option><option value="private">{translate("Private")}</option><option value="unlisted">{translate("Unlisted")}</option><option value="public">{translate("Public")}</option></select>
        <button type="submit">{translate("Search")}</button>
      </form>
      {error && <ErrorState message={translateExternalMessage(error)} onRetry={load} />}
      {!data && !error && <LoadingState />}
      {data && <>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>{translate("Planet")}</th><th>{translate("Type")}</th><th>{translate("Owner")}</th><th>{translate("Visibility")}</th><th>{translate("Revision")}</th><th>{translate("Created")}</th><th>{translate("Last updated")}</th></tr></thead>
            <tbody>{data.planets.map((planet) => (
              <tr key={planet.id}>
                <td><span className="admin-terrain-cell"><span className="admin-list-icon"><BodyIcon type={planet.bodyType} /></span><span><strong>{planet.name}</strong><small>{planet.description || translate('No description')}</small></span></span></td>
                <td>{translate(BODY_LABELS[planet.bodyType] ?? 'Planet')}</td>
                <td>@{planet.owner.username}</td>
                <td><span className={`admin-badge ${planet.visibility}`}>{translate(planet.visibility)}</span></td>
                <td>v{planet.contentRevision}</td>
                <td><span className="admin-muted">{formatDate(planet.createdAt)}</span></td>
                <td><span className="admin-muted">{formatDate(planet.updatedAt)}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {data.planets.length === 0 && <p className="admin-empty">{translate("No planets match these filters.")}</p>}
        </div>
        <footer className="admin-results-footer"><span>{number.format(data.total)} {translate("planets")}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer>
      </>}
    </section>
  );
}

function AuditPanel() {
  useLocale();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.audit({ page, q: query })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, query]);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="admin-panel admin-data-panel">
      <header className="admin-data-head"><div><span className="admin-eyebrow">{translate("Accountability")}</span><h2>{translate("Administrator audit log")}</h2><p>{translate("Security-sensitive administrator actions are recorded with their actor and target.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> {translate("Refresh")}</button></header>
      <form className="admin-filters compact" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}><label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translate("Search action, actor, or target ID")} aria-label={translate("Search audit log")} /></label><button type="submit">{translate("Search")}</button></form>
      {!data && !error && <LoadingState />}{error && <ErrorState message={translateExternalMessage(error)} onRetry={load} />}
      {data && <><div className="admin-audit-list">{data.events.map((event) => <article key={event.id}><span className="admin-audit-mark"><FileClock size={14} /></span><div><header><strong>{actionLabel(event.action)}</strong><span>{formatDate(event.createdAt)}</span></header><p><b>{event.actor}</b> {translate("changed")} {translate(event.targetType)}{event.targetId ? ` ${event.targetId}` : ''}.</p>{event.metadata?.changes && <div className="admin-change-chips">{Object.entries(event.metadata.changes).map(([key, value]) => <span key={key}>{translate(key)}: <strong>{translate(String(value))}</strong></span>)}</div>}</div></article>)}{data.events.length === 0 && <p className="admin-empty">{translate("No audit events match this search.")}</p>}</div><footer className="admin-results-footer"><span>{number.format(data.total)} {translate("audit events")}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
    </section>
  );
}

function SecurityPanel() {
  useLocale();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.security()); }
    catch (nextError) { setError(nextError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data && !error) return <LoadingState />;
  if (error) return <ErrorState message={translateExternalMessage(error)} onRetry={load} />;
  const stats = [
    { label: translate('Failed sign-ins · 24h'), value: data.summary.failedLogins, icon: ShieldAlert, danger: data.summary.failedLogins > 10 },
    { label: translate('Open sessions'), value: data.summary.openSessions, icon: KeyRound },
    { label: translate('Suspended users'), value: data.summary.suspendedUsers, icon: UserX },
    { label: translate('Active administrators'), value: data.summary.admins, icon: ShieldCheck },
  ];
  return (
    <div className="admin-stack">
      <section className="admin-security-grid">{stats.map(({ label, value, icon: Icon, danger }) => <article className={danger ? 'danger' : ''} key={label}><Icon size={18} /><span><strong>{number.format(value)}</strong><small>{translate(label)}</small></span></article>)}</section>
      <section className="admin-panel admin-security-note"><LockKeyhole size={19} /><div><strong>{translate("Security controls are active")}</strong><p>{translate("Server-side role checks, exact-origin enforcement, HTTP-only cookies, rate limits, privacy-safe identifiers, password hashing, and administrator audit events protect this area.")}</p></div></section>
      <section className="admin-panel admin-data-panel"><header className="admin-data-head"><div><span className="admin-eyebrow">{translate("Authentication")}</span><h2>{translate("Recent security events")}</h2><p>{translate("Identifiers and network addresses are not exposed.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> {translate("Refresh")}</button></header><div className="admin-security-events">{data.events.map((event) => <div key={event.id}><span className={`admin-event-icon ${translate(event.outcome)}`}>{event.outcome === 'success' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}</span><span><strong>{actionLabel(event.type)}</strong><small>{event.username ? `@${event.username}` : translate('Unknown account')} · {formatDate(event.createdAt)}</small></span><span className={`admin-status ${translate(event.outcome)}`}><i />{translate(event.outcome)}</span></div>)}{data.events.length === 0 && <p className="admin-empty">{translate("No security events recorded yet.")}</p>}</div></section>
    </div>
  );
}

export default function AdminDashboard({ user, onBack }) {
  useLocale();
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [overviewDays, setOverviewDays] = useState(30);
  const [error, setError] = useState('');
  const loadOverview = useCallback(async () => {
    setError('');
    try { setOverview(await adminApi.overview({ days: overviewDays })); }
    catch (nextError) { setError(nextError.message); }
  }, [overviewDays]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  const changeOverviewRange = useCallback((days) => {
    setOverview(null);
    setOverviewDays(days);
  }, []);
  const title = TABS.find((item) => item.id === tab)?.label ?? translate('Overview');

  return (
    <section className="admin-dashboard" aria-labelledby="admin-title">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-heading"><span className="admin-shield"><ShieldCheck size={18} /></span><span><strong>{translate("Admin console")}</strong><small>Procedural Planets</small></span></div>
        <nav aria-label={translate("Administration")}>
          {TABS.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} /><span>{translate(label)}</span></button>)}
        </nav>
        <div className="admin-sidebar-account"><span>{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span><div><strong>{user.displayName || user.username}</strong><small>{translate("Administrator")}</small></div></div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-content">
            <div className="admin-topbar-title">
              <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={15} /> {translate("Exit admin")}</button>
              <div><span>{translate("Procedural Planets back office")}</span><h1 id="admin-title">{translate(title)}</h1></div>
            </div>
            <div className="admin-secure-indicator"><LockKeyhole size={13} /><span>{translate("Secure admin session")}</span></div>
          </div>
        </header>
        <div className="admin-mobile-tabs" role="tablist" aria-label={translate("Administration sections")}>{TABS.map(({ id, label }) => <button type="button" role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{translate(label)}</button>)}</div>
        <div className="admin-page">
          {tab === 'overview' && !overview && !error && <LoadingState />}
          {tab === 'overview' && error && <ErrorState message={translateExternalMessage(error)} onRetry={loadOverview} />}
          {tab === 'overview' && overview && <Overview data={overview} onNavigate={setTab} rangeDays={overviewDays} onRangeChange={changeOverviewRange} />}
          {tab === 'users' && <UsersPanel currentUser={user} />}
          {tab === 'visits' && <VisitsPanel />}
          {tab === 'planets' && <PlanetsPanel />}
          {tab === 'audit' && <AuditPanel />}
          {tab === 'security' && <SecurityPanel />}
        </div>
      </div>
    </section>
  );
}
