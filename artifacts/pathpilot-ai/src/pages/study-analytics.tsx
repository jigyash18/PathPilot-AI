import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock3, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { getStudyAnalytics, recordStudySession, type StudyAnalytics, type StudyRangeSelection, type StudySessionInput } from '@workspace/api-client-react';
import { formatDate } from '@/lib/date-utils';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
const card = 'rounded-2xl border border-border bg-card p-5 md:p-6';
const formatMinutes = (value: number) => `${Number(value.toFixed(1))} min`;
const dateLabel = (value: string) => formatDate(value, { timeZone: 'UTC', month: 'short', day: 'numeric' }, 'Date unavailable');
function apiMessage(error: unknown) {
  const data = (error as { data?: { error?: string } })?.data;
  return data?.error ?? 'Study activity is unavailable. Please retry.';
}

function SessionRecorder({ goals, onSaved }: { goals: StudyAnalytics['goals']; onSaved: () => void }) {
  const [start, setStart] = useState(() => new Date(Date.now() - 3_600_000).toISOString().slice(0, 16));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 16));
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const save = useMutation({ mutationFn: recordStudySession, retry: false });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    setError(''); setMessage('');
    const startedAt = new Date(`${start}:00Z`);
    const endedAt = new Date(`${end}:00Z`);
    const duration = endedAt.getTime() - startedAt.getTime();
    if (!Number.isFinite(duration) || duration < 60_000 || duration > 43_200_000) { setError('Choose valid UTC times for a session lasting 1 minute to 12 hours.'); return; }
    if (endedAt.getTime() > Date.now() || startedAt.getTime() < Date.now() - 366 * 86_400_000) { setError('Record a completed session from the last 366 days. Future times are not allowed.'); return; }
    const input = { goalId: goalId ? Number(goalId) : null, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString() };
    const fingerprint = JSON.stringify(input);
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true;
    try {
      const result = await save.mutateAsync({ ...input, requestId: submission.current.key } satisfies StudySessionInput);
      setMessage(`${formatMinutes(result.minutes)} saved. Task completion and your roadmap have not been changed.`);
      onSaved();
    } catch (cause) { setError(apiMessage(cause)); }
    finally { busy.current = false; }
  };
  return <section id="record-study" className={card} aria-labelledby="record-heading">
    <div className="mb-4 flex items-center gap-3"><Clock3 className="text-primary" aria-hidden="true" /><h2 id="record-heading" className="font-serif text-2xl font-semibold">Record a completed session</h2></div>
    <p className="mb-5 text-sm text-muted-foreground">Enter time you actually studied, excluding breaks. All times here are UTC. Sessions may cross midnight; overlapping entries are rejected. Records are self-reported, not stopwatch measurements.</p>
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label><span className="field-label">Started (UTC)</span><input className="field" type="datetime-local" step="60" required value={start} onChange={(event) => { setStart(event.target.value); setMessage(''); }} disabled={save.isPending} /></label>
      <label><span className="field-label">Finished (UTC)</span><input className="field" type="datetime-local" step="60" required value={end} onChange={(event) => { setEnd(event.target.value); setMessage(''); }} disabled={save.isPending} /></label>
      <label><span className="field-label">Goal (optional)</span><select className="field" value={goalId} onChange={(event) => { setGoalId(event.target.value); setMessage(''); }} disabled={save.isPending}><option value="">General study</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.goalName}</option>)}</select></label>
      <div className="flex items-end"><button className={`${button} w-full`} disabled={save.isPending}>{save.isPending && <Loader2 size={16} className="animate-spin" />} {save.isPending ? 'Saving…' : 'Save study session'}</button></div>
      {error && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-4" role="alert">{error}</p>}
      {message && <p className="rounded-lg bg-secondary p-3 text-sm text-primary sm:col-span-2 lg:col-span-4" role="status">{message}</p>}
    </form>
  </section>;
}

function ActivityCharts({ data }: { data: StudyAnalytics }) {
  const counts = Object.entries(data.summary.currentTaskCounts).map(([name, count]) => ({ name, count }));
  const showTrend = data.days.length >= 7 && data.days.filter((day) => day.minutes > 0).length >= 4;
  return <section id="study-activity" className="space-y-5" aria-label="Study activity charts">
    <div className="grid gap-5 xl:grid-cols-2">
      <div className={card}><h2 className="font-serif text-2xl font-semibold">Daily recorded study</h2><p className="mt-1 text-xs text-muted-foreground">{data.range.from} – {data.range.to} · UTC · minutes per day</p>
        {data.summary.recordedMinutes === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No sessions recorded in this range. Log your first completed session above.</p> : <div className="mt-5 h-64" role="img" aria-label={`Daily study minutes from ${data.range.from} to ${data.range.to}. Total ${formatMinutes(data.summary.recordedMinutes)}. Full values follow in the data table.`}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.days} margin={{ top: 12, right: 12, bottom: 20, left: 0 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={25} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }} /><Tooltip labelFormatter={(label) => `${label} UTC`} formatter={(value: number) => [formatMinutes(value), 'Recorded study']} /><Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>}
      </div>
      <div className={card}><h2 className="font-serif text-2xl font-semibold">Tasks right now</h2><p className="mt-1 text-xs text-muted-foreground">Current state across your goals · not period changes</p><div className="mt-5 h-64" role="img" aria-label={counts.map((item) => `${item.count} ${item.name}`).join(', ')}><ResponsiveContainer width="100%" height="100%"><BarChart data={counts} margin={{ top: 12, right: 12, bottom: 20, left: 0 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} label={{ value: 'Tasks', angle: -90, position: 'insideLeft' }} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" isAnimationActive={false} /></BarChart></ResponsiveContainer></div><p className="text-xs text-muted-foreground">{counts.map((item) => `${item.count} ${item.name}`).join(' · ')}</p></div>
    </div>
    <div className={card}><h2 className="font-serif text-2xl font-semibold">Study trend</h2><p className="mt-1 text-xs text-muted-foreground">Recorded minutes per UTC day in the selected range. Zero means no record, not proof of no study.</p>{showTrend ? <div className="mt-4 h-60" role="img" aria-label="Daily study trend in minutes; values are available in the following table."><ResponsiveContainer width="100%" height="100%"><LineChart data={data.days} margin={{ top: 12, right: 12, bottom: 20, left: 0 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={25} tick={{ fontSize: 11 }} /><YAxis label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }} /><Tooltip labelFormatter={(label) => `${label} UTC`} /><Line type="linear" dataKey="minutes" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p className="mt-4 text-sm text-muted-foreground">A trend appears for ranges of at least 7 days with recorded activity on at least 4 days.</p>}
      <details className="mt-4"><summary className="cursor-pointer text-sm font-bold text-primary">Accessible daily data table</summary><div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left text-xs text-muted-foreground">UTC dates, recorded minutes, and distinct tasks completed on each day. A task completed again on another day appears on both days.</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Recorded minutes</th><th scope="col">Tasks completed</th></tr></thead><tbody>{data.days.map((day) => <tr key={day.date} className="border-t border-border"><th scope="row" className="py-2 font-normal">{day.date}</th><td>{day.minutes}</td><td>{day.completedTasks}</td></tr>)}</tbody></table></div></details>
    </div>
  </section>;
}

export default function StudyAnalyticsPage() {
  const cache = useQueryClient();
  const [selection, setSelection] = useState<StudyRangeSelection>({ range: 'week' });
  const [draft, setDraft] = useState({ from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const [rangeError, setRangeError] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['study-analytics', selection, offset], queryFn: ({ signal }) => getStudyAnalytics(selection, offset, signal), retry: false });
  const data = query.data;
  const selectRange = (range: StudyRangeSelection['range']) => {
    setRangeError(''); setOffset(0);
    setSelection(range === 'custom' ? { range, ...draft } : { range });
  };
  const applyCustom = (event: FormEvent) => {
    event.preventDefault();
    const days = (Date.parse(draft.to) - Date.parse(draft.from)) / 86_400_000 + 1;
    if (!Number.isFinite(days) || days < 1 || days > 366 || draft.to > new Date().toISOString().slice(0, 10)) {
      setRangeError('Choose up to 366 days ending on or before today (UTC).'); return;
    }
    setRangeError(''); setOffset(0); setSelection({ range: 'custom', ...draft });
  };
  const saved = () => { setOffset(0); void cache.invalidateQueries({ queryKey: ['study-analytics'] }); };
  return <div className="space-y-5" data-testid="study-analytics">
    <header className="mb-8"><p className="mb-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary">Your study ledger</p><h1 className="font-serif text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-tight tracking-[-.045em]">Study Analytics</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Real records, clearer next steps. Recorded time is separate from task estimates and your configured target. Weeks start Monday; dates and times use UTC.</p></header>
    <section className={card} aria-label="Analytics date filters"><div className="flex flex-wrap items-end gap-4"><label><span className="field-label">Study period</span><select className="field" value={selection.range} onChange={(event) => selectRange(event.target.value as StudyRangeSelection['range'])}><option value="week">This week (to date)</option><option value="last-week">Last week</option><option value="30-days">Last 30 days</option><option value="custom">Custom range</option></select></label><button type="button" className={button} onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} aria-hidden="true" />Refresh</button>{query.isFetching && <span className="text-sm text-muted-foreground" role="status">Loading analytics…</span>}</div>
      {selection.range === 'custom' && <form onSubmit={applyCustom} className="mt-4 flex flex-wrap items-end gap-3"><label><span className="field-label">From (UTC)</span><input className="field" type="date" required value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label><span className="field-label">Through (UTC)</span><input className="field" type="date" required value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label><button className={button}>Apply dates</button>{rangeError && <p role="alert" className="w-full text-sm text-destructive">{rangeError}</p>}</form>}
      {data && <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">Showing {data.range.from} through {data.range.to}, inclusive (UTC).</p>}
    </section>
    {query.isPending && <div role="status" className={`${card} flex items-center gap-2`}><Loader2 size={18} className="animate-spin" />Loading your study record…</div>}
    {query.isError && <div className={`${card} border-destructive/30`} role="alert"><p className="text-sm text-destructive">{apiMessage(query.error)}</p><button className={`${button} mt-4`} onClick={() => void query.refetch()}>Try again</button></div>}
    {data && !query.isError && <>
      <SessionRecorder goals={data.goals} onSaved={saved} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Study summaries">{[
        ['Recorded time', formatMinutes(data.summary.recordedMinutes), 'Minutes within the selected UTC dates; sessions crossing midnight are split.'],
        ['Completed sessions', String(data.summary.completedSessions), 'Session records whose finish time falls within the selected period.'],
        ['Average session', data.summary.averageSessionMinutes === null ? '—' : formatMinutes(data.summary.averageSessionMinutes), 'Full duration of sessions finishing in this period.'],
        ['Tasks completed', String(data.summary.completedTasksInRange), 'Distinct tasks with a completed progress event in this period.'],
        ['Current task progress', `${data.summary.currentCompletionPercent}%`, 'Current average task completion percentage across all your goals, not period change.'],
        ['Active goals now', String(data.summary.activeGoals), 'Goals with unfinished tasks or no tasks yet, including overdue goals.'],
        ['Current study streak', `${data.summary.currentStreak} days`, 'Consecutive UTC days with recorded study through today or yesterday; independent of the filter.'],
        ['Configured daily target', `${data.summary.dailyTargetHours} h`, 'Your current profile setting, not recorded study time.'],
      ].map(([title, value, description]) => <article key={title} className={card}><h2 className="text-xs font-bold text-muted-foreground">{title}</h2><p className="mt-3 font-serif text-3xl font-semibold text-primary">{value}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p></article>)}</section>
      <ActivityCharts data={data} />
      <section className={card}><h2 className="font-serif text-2xl font-semibold">Progress insights</h2><p className="mt-1 text-xs text-muted-foreground">Transparent rules based on your records. Suggestions never alter a task or plan.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{data.insights.map((insight) => <article key={insight.title} className="rounded-xl border border-border p-4"><h3 className="font-semibold">{insight.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.detail}</p>{insight.href.startsWith('#') ? <a href={insight.href} className="mt-3 inline-block text-sm font-bold text-primary underline">View activity</a> : <Link href={insight.href} className="mt-3 inline-block text-sm font-bold text-primary underline">{insight.href === '/profile' ? 'Review preferences' : 'Review goals'}</Link>}</article>)}</div></section>
      <section className={card}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-2xl font-semibold">Goals & deadlines</h2><Link href="/goals" className="text-sm font-bold text-primary underline">Goal studio</Link></div><p className="mt-1 text-xs text-muted-foreground">Current goal state, independent of the date filter. Choose a goal in the header for detailed roadmap history below.</p>{!data.goals.length ? <p className="mt-5 text-sm text-muted-foreground">No goals yet. You can record general study now or create your first goal.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{data.goals.map((goal) => <article key={goal.id} className="rounded-xl border border-border p-4"><h3 className="font-semibold">{goal.goalName}</h3><p className="mt-1 text-xs text-muted-foreground">Deadline: {goal.deadline.slice(0, 10)} · {goal.completedCount}/{goal.taskCount} tasks completed · {goal.missedCount} missed</p><progress className="mt-3 h-3 w-full accent-[hsl(var(--primary))]" max={100} value={goal.overallProgress} aria-label={`${goal.goalName}: ${goal.overallProgress}% task progress`} /><p className="mt-1 text-xs text-muted-foreground">{goal.overallProgress}% task progress · {goal.dailyHours} h/day configured for this goal</p></article>)}</div>}</section>
      <section className={card} aria-labelledby="activity-heading"><h2 id="activity-heading" className="font-serif text-2xl font-semibold">Activity history</h2><p className="mt-1 text-xs text-muted-foreground">Newest first in this range. Sessions show full durations, even when they cross the range boundary. Task events have dates only, so their order within a day is unknown.</p>{!data.activity.length ? <p className="mt-5 text-sm text-muted-foreground">No recorded activity for these dates.</p> : <ol className="mt-4 divide-y divide-border">{data.activity.map((item) => <li key={item.key} className="flex flex-col justify-between gap-2 py-3 sm:flex-row"><div><p className="text-sm font-semibold">{item.kind === 'session' ? 'Study session completed' : `Task ${item.kind}`} · {item.title}</p><time className="text-xs text-muted-foreground" dateTime={item.at}>{item.dateOnly ? `${item.at.slice(0, 10)} UTC · time not recorded` : `${item.at.slice(0, 10)} ${item.at.slice(11, 16)} UTC`}</time></div>{item.minutes !== null && <span className="text-sm font-bold text-primary">{formatMinutes(item.minutes)}</span>}</li>)}</ol>}<div className="mt-4 flex items-center gap-3"><button type="button" className={button} disabled={offset === 0 || query.isFetching} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button><span className="text-xs text-muted-foreground">Page {offset / 50 + 1}</span><button type="button" className={button} disabled={!data.activityHasMore || offset >= 10000 || query.isFetching} onClick={() => setOffset((value) => value + 50)}>Next</button></div>{offset >= 10000 && <p className="mt-2 text-xs text-muted-foreground">Narrow the date range to explore more records.</p>}</section>
    </>}
  </div>;
}
