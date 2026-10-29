import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GoalCard } from '@/components/goal-card';
import { assertGoalsArray } from '@/lib/goals-response';
import { getAuthErrorMessage, getAuthSession, getUserInitials, signIn, signOut, signUp, type AuthSession, type AuthUser } from '@/lib/auth';
import { daysUntil, formatDate } from '@/lib/date-utils';
import {
  getGetGoalProgressQueryKey,
  getGetGoalRecommendationsQueryKey,
  getGetRoadmapQueryKey,
  getListGoalsQueryKey,
  useCompleteTask,
  useCreateGoal,
  useGenerateRoadmap,
  useGetGoalProgress,
  useGetGoalRecommendations,
  useGetRoadmap,
  useListGoals,
  useMissTask,
  useReplanGoal,
  customFetch,
  type AlternativePlanPreview,
  type TaskPlanPreview as GeneratedTaskPlanPreview,
  type ProgressDashboard as GeneratedProgressDashboard,
  type ConfirmedMilestone as GeneratedConfirmedMilestone,
  type ReplanTaskChange,
  type Goal,
  type Task,
} from '@workspace/api-client-react';

type ProgressDashboard = Omit<GeneratedProgressDashboard, 'timeline'> & {
  timeline: { planVersionId: number; version: number; createdAt: string; tasks: { taskId: number; taskName: string; topic: string; plannedDate: string | null; estimatedHours: number | null; completedDate: string | null; completionRecordAvailable: boolean }[] }[];
};
type TaskPlanPreview = Omit<GeneratedTaskPlanPreview, 'status'> & { status: 'ai_generated' | 'fallback_missing_credentials' | 'fallback_provider_error' | 'fallback_invalid_output' };
type ConfirmedMilestone = Omit<GeneratedConfirmedMilestone, 'completedTaskCount' | 'taskCount'> & { completedTaskCount: number; taskCount: number };
import {
  AlertCircle,
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Compass,
  Flag,
  Gauge,
  Lightbulb,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plane,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  Target,
  TrendingUp,
  X,
  XCircle,
  Eye,
  EyeOff,
  UserRound,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import ProfilePage from '@/pages/profile';
const StudyAnalyticsPage = lazy(() => import('@/pages/study-analytics'));
const SmartRoadmapPage = lazy(() => import('@/pages/roadmap-smart'));
import { defaultGoalDailyHours, getProfile, type ProfilePreferences, type UserProfile } from '@/lib/profile';
import { buildOverviewTasks, focusSelectionKey, readFocusTaskId, resolveFocusTask, writeFocusTaskId } from '@/lib/focus-selection';

const queryClient = new QueryClient();

type GoalContextValue = {
  goals: Goal[];
  selectedGoal?: Goal;
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
  profilePreferences?: ProfilePreferences;
  focusTaskId: number | null;
  setFocusTaskId: (taskId: number | null) => void;
};

import { createContext, useContext } from 'react';
const GoalContext = createContext<GoalContextValue | null>(null);

function useGoalsContext() {
  const context = useContext(GoalContext);
  if (!context) throw new Error('Goal context is unavailable');
  return context;
}

function GoalProvider({ children, userId }: { children: ReactNode; userId: string | number }) {
  const { data: goals = [], isLoading, isError, refetch } = useListGoals({
    query: { select: assertGoalsArray, queryKey: getListGoalsQueryKey() },
  });
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem('pathpilot-selected-goal'));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const focusKey = selectedId ? focusSelectionKey(userId, selectedId) : null;
  const [focusState, setFocusState] = useState<{ key: string | null; taskId: number | null }>(() => ({
    key: focusKey,
    taskId: focusKey ? readFocusTaskId(localStorage, focusKey) : null,
  }));
  const focusTaskId = focusState.key === focusKey ? focusState.taskId : null;

  useEffect(() => {
    setFocusState({ key: focusKey, taskId: focusKey ? readFocusTaskId(localStorage, focusKey) : null });
  }, [focusKey]);

  useEffect(() => {
    if (!focusKey) return;
    const syncSelection = (event: StorageEvent) => {
      if (event.key === focusKey || event.key === null) {
        setFocusState({ key: focusKey, taskId: readFocusTaskId(localStorage, focusKey) });
      }
    };
    window.addEventListener('storage', syncSelection);
    return () => window.removeEventListener('storage', syncSelection);
  }, [focusKey]);

  useEffect(() => {
    if (goals.length && (!selectedId || !goals.some((goal) => goal.id === selectedId))) {
      setSelectedIdState(goals[0].id);
    }
  }, [goals, selectedId]);

  const setSelectedId = (id: number | null) => {
    setSelectedIdState(id);
    if (id === null) localStorage.removeItem('pathpilot-selected-goal');
    else localStorage.setItem('pathpilot-selected-goal', String(id));
  };
  const setFocusTaskId = (taskId: number | null) => {
    if (focusKey) writeFocusTaskId(localStorage, focusKey, taskId);
    setFocusState({ key: focusKey, taskId });
  };

  return (
    <GoalContext.Provider value={{
      goals,
      selectedGoal: goals.find((goal) => goal.id === selectedId),
      selectedId,
      setSelectedId,
      isLoading,
      isError,
      retry: () => void refetch(),
      profilePreferences: profile?.preferences,
      focusTaskId,
      setFocusTaskId,
    }}>
      {children}
    </GoalContext.Provider>
  );
}

const navItems = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/roadmap', label: 'Roadmap', icon: RouteIcon },
  { href: '/progress', label: 'Analytics', icon: TrendingUp },
  { href: '/recommendations', label: 'Recommendations', icon: Lightbulb },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

function AppShell({ children, user, onLogout }: { children: ReactNode; user: AuthUser; onLogout: () => void }) {
  const [location] = useLocation();
  const { goals, selectedGoal, selectedId, setSelectedId } = useGoalsContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <div className="pathpilot-shell min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[250px] flex-col border-r border-sidebar-border bg-sidebar px-5 py-6 text-sidebar-foreground lg:flex">
        <Link href="/" className="mb-12 flex items-center gap-3" data-testid="link-brand">
          <span className="grid size-10 place-items-center rounded-[13px] bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_7px_20px_hsl(var(--sidebar-primary)/.25)]">
            <Compass size={22} strokeWidth={2.5} />
          </span>
          <span>
            <span className="block font-serif text-[21px] font-semibold tracking-[-.03em]">PathPilot</span>
            <span className="font-mono text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/55">adaptive planning</span>
          </span>
        </Link>
        <p className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/45">Workspace</p>
        <nav className="space-y-1" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : location.startsWith(href);
            return (
              <Link
                href={href}
                key={href}
                data-testid={`link-nav-${label.toLowerCase()}`}
                className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition-all ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_hsl(var(--sidebar-primary))]' : 'text-sidebar-foreground/63 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
              >
                <Icon size={17} strokeWidth={active ? 2.3 : 1.8} />
                <span>{label}</span>
                {active && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          <Link href="/goals" data-testid="link-goals" className="mb-4 flex items-center gap-3 rounded-xl border border-sidebar-border px-3 py-3 text-sidebar-foreground/75 transition-colors hover:border-sidebar-primary/60 hover:text-sidebar-foreground">
            <Target size={17} />
            <span className="text-[13px] font-semibold">Goal studio</span>
            <Plus size={15} className="ml-auto text-sidebar-primary" />
          </Link>
          <div className="border-t border-sidebar-border pt-4">
            <p className="px-3 font-mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/42">Planning season</p>
            <p className="mt-2 px-3 font-serif text-[16px] text-sidebar-foreground/90">{selectedGoal?.goalName || 'Choose a goal'}</p>
            {selectedGoal && <p className="mt-1 px-3 text-[11px] text-sidebar-foreground/46">{selectedGoal.overallProgress}% task completion</p>}
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/75 bg-background/90 px-5 backdrop-blur-xl lg:ml-[250px] lg:px-10">
        <div className="flex items-center gap-3 lg:hidden">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Compass size={19} /></span>
          <span className="font-serif text-xl font-semibold">PathPilot</span>
        </div>
        <div className="hidden items-center gap-2 text-[12px] text-muted-foreground lg:flex">
          <span className="font-mono text-[10px] uppercase tracking-[.16em]">Today</span>
          <span className="text-border">/</span>
          <span className="font-medium text-foreground">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date())}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex max-w-[190px] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-semibold transition-colors hover:border-primary/50" data-testid="button-select-goal">
              <span className="size-2 rounded-full bg-accent" />
              <span className="truncate">{selectedGoal?.goalName || 'Select a goal'}</span>
              <ChevronDown size={14} className="ml-1 shrink-0 text-muted-foreground" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-[0_16px_45px_hsl(var(--foreground)/.12)]">
                {goals.length ? goals.map((goal) => (
                  <button key={goal.id} type="button" onClick={() => { setSelectedId(goal.id); setMenuOpen(false); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted ${goal.id === selectedId ? 'bg-muted font-bold' : ''}`} data-testid={`button-goal-option-${goal.id}`}>
                    <span className="truncate">{goal.goalName}</span>
                    {goal.id === selectedId && <Check size={14} className="text-primary" />}
                  </button>
                )) : <p className="px-3 py-3 text-xs text-muted-foreground">No goals yet.</p>}
                <Link href="/goals" onClick={() => setMenuOpen(false)} className="mt-1 flex items-center gap-2 border-t border-border px-3 py-2.5 text-xs font-bold text-primary" data-testid="link-add-goal"><Plus size={14} /> Add a goal</Link>
              </div>
            )}
          </div>
           <Link href="/profile" className="hidden size-9 place-items-center rounded-full bg-secondary font-serif text-sm font-semibold text-secondary-foreground sm:grid" title="Open profile" data-testid="avatar-user">{getUserInitials(user)}</Link>
          <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground" data-testid="button-logout"><LogOut size={14} /><span className="hidden sm:inline">Log out</span></button>
          <button type="button" onClick={() => setLocation('/goals')} className="hidden rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:block" data-testid="button-open-goals"><MoreHorizontal size={18} /></button>
        </div>
      </header>
      <main className="min-h-[calc(100dvh-72px)] px-5 pb-28 pt-8 lg:ml-[250px] lg:px-10 lg:pb-12 lg:pt-10">
        <div className="mx-auto max-w-[1260px]">{children}</div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 px-3 py-2 backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? location === '/' : location.startsWith(href);
          return <Link key={href} href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className={`flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}><Icon size={18} /><span>{label}</span></Link>;
        })}
      </nav>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
    <div className="page-enter">
      <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-accent" />{eyebrow}</p>
      <h1 className="max-w-3xl font-serif text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[.98] tracking-[-.045em] text-foreground">{title}</h1>
      {description && <p className="mt-4 max-w-xl text-[14px] leading-6 text-muted-foreground">{description}</p>}
    </div>
    {action && <div className="page-enter stagger-1 shrink-0">{action}</div>}
  </div>;
}

function EmptyGoal({ compact = false }: { compact?: boolean }) {
  return <div className={`rounded-2xl border border-dashed border-border bg-card/70 text-center ${compact ? 'p-8' : 'p-12 md:p-20'}`}>
    <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Target size={22} /></span>
    <h2 className="font-serif text-2xl font-semibold">Give your next chapter a shape.</h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Set one important goal and PathPilot will turn the distance into a daily route you can actually follow.</p>
    <Link href="/goals" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-create-first-goal">Create your first goal <ArrowRight size={15} /></Link>
  </div>;
}

function QuerySkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" data-testid="status-loading"><div className="skeleton h-28 rounded-2xl" /><div className="grid gap-3 md:grid-cols-3">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div></div>;
}

function QueryError({ retry }: { retry: () => void }) {
  return <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center" data-testid="status-error"><AlertCircle className="mx-auto mb-3 text-destructive" size={24} /><h2 className="font-serif text-xl font-semibold">This route needs a second look.</h2><p className="mt-1 text-sm text-muted-foreground">We couldn't load your planning data right now.</p><button type="button" onClick={retry} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-bold hover:bg-muted" data-testid="button-retry"><RefreshCw size={14} /> Try again</button></div>;
}

function ProgressBar({ value, color = 'bg-primary' }: { value: number; color?: string }) {
  return <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`progress-fill h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function StatusPill({ status }: { status: Task['status'] }) {
  const content = {
    completed: { label: 'Completed', icon: Check, className: 'bg-emerald-100 text-emerald-800' },
    missed: { label: 'Missed', icon: XCircle, className: 'bg-red-100 text-red-800' },
    pending: { label: 'Pending', icon: CircleDashed, className: 'bg-amber-100 text-amber-800' },
  }[status];
  const Icon = content.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[.08em] ${content.className}`}><Icon size={11} />{content.label}</span>;
}

function TaskActions({ task, onMessage }: { task: Task; onMessage: (message: string) => void }) {
  const queryClient = useQueryClient();
  const complete = useCompleteTask();
  const miss = useMissTask();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['study-analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['progressDashboard', task.goalId] });
    void queryClient.invalidateQueries({ queryKey: getGetRoadmapQueryKey(task.goalId) });
    void queryClient.invalidateQueries({ queryKey: getGetGoalProgressQueryKey(task.goalId) });
    void queryClient.invalidateQueries({ queryKey: getGetGoalRecommendationsQueryKey(task.goalId) });
    void queryClient.invalidateQueries({ queryKey: getListGoalsQueryKey() });
  };
  if (task.status !== 'pending') return <StatusPill status={task.status} />;
  return <div className="flex items-center gap-2">
    <button type="button" disabled={complete.isPending || miss.isPending} onClick={() => complete.mutate({ taskId: task.id }, { onSuccess: () => { invalidate(); onMessage('Nice work — task marked complete.'); }, onError: () => onMessage('That update did not stick. Try again.') })} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60" data-testid={`button-complete-task-${task.id}`}>{complete.isPending ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />} Complete</button>
    <button type="button" disabled={complete.isPending || miss.isPending} onClick={() => miss.mutate({ taskId: task.id }, { onSuccess: () => { invalidate(); onMessage('Marked missed. PathPilot can now replan around it.'); }, onError: () => onMessage('That update did not stick. Try again.') })} className="rounded-lg border border-border px-2.5 py-2 text-[11px] font-bold text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-60" data-testid={`button-miss-task-${task.id}`}>Miss</button>
  </div>;
}

function Dashboard() {
  const { selectedGoal, selectedId, isLoading: goalsLoading, focusTaskId, setFocusTaskId } = useGoalsContext();
  const [message, setMessage] = useState('');
  const roadmapQuery = useGetRoadmap(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetRoadmapQueryKey(selectedId || 0) } });
  const progressQuery = useGetGoalProgress(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetGoalProgressQueryKey(selectedId || 0) } });
  const recommendationsQuery = useGetGoalRecommendations(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetGoalRecommendationsQueryKey(selectedId || 0) } });
  const tasks = roadmapQuery.data?.tasks || [];
  const focusTask = selectedId ? resolveFocusTask(tasks, focusTaskId, selectedId) : null;
  const focusInvalid = !!selectedId && !!roadmapQuery.data && focusTaskId !== null && !focusTask;
  const today = new Date().toISOString().slice(0, 10);
  const overviewTasks = selectedId ? buildOverviewTasks(tasks, today, focusTaskId, selectedId) : { tasks: [], invalidSelection: false };
  useEffect(() => {
    if (focusInvalid) setFocusTaskId(null);
  }, [focusInvalid, setFocusTaskId]);
  useEffect(() => {
    if (focusInvalid) setMessage('Your focus task is no longer pending in this goal, so it was cleared. Scheduled work is shown instead.');
  }, [focusInvalid]);
  if (goalsLoading) return <QuerySkeleton />;
  if (!selectedGoal) return <><PageIntro eyebrow="Overview" title="Make a plan that moves with you." description="Your focused workspace for turning an important goal into a sequence of doable days." /><EmptyGoal /></>;
  if (roadmapQuery.isLoading || progressQuery.isLoading || recommendationsQuery.isLoading) return <QuerySkeleton />;
  if (roadmapQuery.isError || progressQuery.isError || recommendationsQuery.isError) return <QueryError retry={() => { void roadmapQuery.refetch(); void progressQuery.refetch(); void recommendationsQuery.refetch(); }} />;
  const progress = progressQuery.data;
  const visibleTasks = overviewTasks.tasks;
  const recs = recommendationsQuery.data || [];
  return <div className="page-enter">
    <PageIntro eyebrow="Your command center" title={selectedGoal.goalName} description={`A clear route to ${formatDate(selectedGoal.deadline)}. Keep the next right step visible; PathPilot will handle the recalculation.`} action={<Link href="/roadmap" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/.16)] transition-transform hover:-translate-y-0.5" data-testid="link-open-roadmap">Open roadmap <ArrowRight size={15} /></Link>} />
    <div className="grid gap-4 lg:grid-cols-[1.45fr_.75fr]">
      <section className="relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground shadow-[0_18px_40px_hsl(var(--primary)/.18)] md:p-8" data-testid="card-goal-progress">
        <div className="absolute -right-12 -top-16 size-56 rounded-full border-[24px] border-primary-foreground/10" /><div className="absolute -right-2 -top-7 size-28 rounded-full border border-accent/35" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/60">Current trajectory</p><p className="mt-3 max-w-md font-serif text-[28px] font-semibold leading-tight">Small sessions compound into serious progress.</p></div><Award className="text-accent" size={28} /></div>
           <div className="mt-10 flex items-end gap-4"><span className="font-mono text-6xl font-bold tracking-[-.08em]">{Math.round(progress?.overallProgress ?? selectedGoal.overallProgress)}<small className="ml-1 text-3xl text-accent">%</small></span><span className="mb-2 text-xs text-primary-foreground/60">average task completion</span></div>
          <div className="mt-4 h-2.5 rounded-full bg-primary-foreground/15"><div className="progress-fill h-full rounded-full bg-accent" style={{ width: `${progress?.overallProgress ?? selectedGoal.overallProgress}%` }} /></div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-primary-foreground/65"><span><strong className="text-primary-foreground">{progress?.completed ?? selectedGoal.completedCount}</strong> completed</span><span><strong className="text-primary-foreground">{progress?.pending ?? selectedGoal.taskCount - selectedGoal.completedCount}</strong> in the queue</span><span><strong className="text-primary-foreground">{progress?.missed ?? selectedGoal.missedCount}</strong> missed</span></div>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-6" data-testid="card-deadline">
        <p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">The finish line</p><div className="mt-5 flex items-baseline gap-2"><span className="font-serif text-4xl font-semibold text-foreground">{daysUntil(selectedGoal.deadline)}</span><span className="text-sm text-muted-foreground">days to go</span></div><p className="mt-2 text-xs text-muted-foreground">{formatDate(selectedGoal.deadline, { month: 'long', day: 'numeric', year: 'numeric' })}</p><div className="mt-7 flex items-center justify-between border-t border-border pt-4 text-xs"><span className="text-muted-foreground">Daily commitment</span><strong>{selectedGoal.dailyHours} hrs</strong></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">Priority</span><span className="font-bold capitalize text-primary">{selectedGoal.priority}</span></div>
      </section>
    </div>
    {message && <div className="mt-4 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-4 py-3 text-xs font-bold text-primary" data-testid="status-action-message"><CheckCircle2 size={15} />{message}<button type="button" className="ml-auto" onClick={() => setMessage('')} aria-label="Dismiss message" data-testid="button-dismiss-message"><X size={14} /></button></div>}
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="section-todays-tasks"><div className="mb-5 flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Next up</p><h2 className="mt-1 font-serif text-2xl font-semibold">Today's work</h2></div><Link href="/roadmap" className="text-xs font-bold text-primary hover:underline" data-testid="link-view-all-tasks">View all</Link></div><p className="-mt-3 mb-4 text-[11px] text-muted-foreground">Choose a focus task from Recommendations. If it is completed, missed, or removed from this goal, the selection is cleared.</p>{visibleTasks.length ? <div className="space-y-2">{visibleTasks.map((task) => <div key={task.id} className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${task.id === focusTask?.id ? 'border-primary/50 bg-secondary/30' : 'border-border/80 hover:border-primary/35'}`} data-testid={`overview-task-${task.id}`}><div className="min-w-0"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${task.priority === 'high' ? 'bg-accent' : 'bg-primary/35'}`} /><h3 className="truncate text-sm font-bold">{task.taskName}</h3>{task.id === focusTask?.id && <span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[.08em] text-primary" data-testid="badge-focus-task">Queued focus</span>}</div><p className="mt-1 pl-4 font-mono text-[10px] uppercase tracking-[.05em] text-muted-foreground">{task.durationHours}h · {task.difficulty} difficulty</p></div><TaskActions task={task} onMessage={setMessage} /></div>)}</div> : <div className="rounded-xl bg-muted/50 p-7 text-center"><CheckCircle2 className="mx-auto text-primary" /><p className="mt-2 text-sm font-bold">Your queue is clear.</p><p className="mt-1 text-xs text-muted-foreground">Generate or replan your roadmap for the next move.</p></div>}</section>
      <section className="rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="section-recommendations"><div className="mb-5 flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Signal check</p><h2 className="mt-1 font-serif text-2xl font-semibold">Worth your attention</h2></div><Link href="/recommendations" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" data-testid="link-view-recommendations"><ArrowRight size={17} /></Link></div>{recs.length ? <div className="space-y-4">{recs.slice(0, 3).map((rec, index) => <div key={rec.task.id} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[10px] font-bold text-primary">{String(index + 1).padStart(2, '0')}</span><div><p className="text-sm font-bold leading-5">{rec.task.taskName}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{rec.reason}</p></div></div>)}</div> : <p className="text-sm text-muted-foreground">Recommendations will appear as your route gets underway.</p>}</section>
    </div>
  </div>;
}

function GoalsPage() {
  const { goals, selectedId, setSelectedId, isLoading, isError, retry, profilePreferences } = useGoalsContext();
  const queryClient = useQueryClient();
  const createGoal = useCreateGoal();
  const generateRoadmap = useGenerateRoadmap();
  const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteGoal = useMutation({
    mutationFn: (goal: Goal) => customFetch<void>(`/api/goals/${goal.id}`, { method: 'DELETE' }),
    onSuccess: (_data, deletedGoal) => {
      void queryClient.invalidateQueries({ queryKey: ['study-analytics'] });
      const goalQueryKey = getListGoalsQueryKey();
      const currentGoals = queryClient.getQueryData<Goal[]>(goalQueryKey) ?? goals;
      const remainingGoals = currentGoals.filter((goal) => goal.id !== deletedGoal.id);
      queryClient.setQueryData(goalQueryKey, remainingGoals);
      void queryClient.invalidateQueries({ queryKey: goalQueryKey });
      queryClient.removeQueries({ queryKey: getGetRoadmapQueryKey(deletedGoal.id) });
      queryClient.removeQueries({ queryKey: getGetGoalProgressQueryKey(deletedGoal.id) });
      queryClient.removeQueries({ queryKey: getGetGoalRecommendationsQueryKey(deletedGoal.id) });
      queryClient.removeQueries({ queryKey: ['progressDashboard', deletedGoal.id] });

      if (selectedId === deletedGoal.id) setSelectedId(remainingGoals[0]?.id ?? null);
      if (remainingGoals.length === 0) setFormOpen(true);
      setGoalToDelete(null);
      setDeleteError(null);
      setMessage(`Deleted “${deletedGoal.goalName}”.`);
    },
    onError: (_error, deletedGoal) => {
      setDeleteError(`Could not delete “${deletedGoal.goalName}”. Please try again.`);
    },
  });
  const [taskPlanPreview, setTaskPlanPreview] = useState<TaskPlanPreview | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<TaskPlanPreview['tasks']>([]);
  const taskPlan = useMutation({ mutationFn: (data: Record<string, unknown>) => customFetch<TaskPlanPreview>('/api/goals/task-plan-preview', { method: 'POST', body: JSON.stringify(data) }) });
  const [form, setForm] = useState({ goalName: '', goalType: 'Exam preparation', deadline: '', dailyHours: String(defaultGoalDailyHours()), priority: 'high', description: '', skills: '' });
  useEffect(() => {
    if (!profilePreferences || form.goalName || taskPlanPreview || createGoal.isPending) return;
    setForm((current) => ({ ...current, dailyHours: String(defaultGoalDailyHours(profilePreferences)) }));
  }, [createGoal.isPending, form.goalName, profilePreferences, taskPlanPreview]);
  const updateForm = (next: typeof form) => { setForm(next); setTaskPlanPreview(null); setTaskDrafts([]); };
  const [message, setMessage] = useState('');
  const [formOpen, setFormOpen] = useState(!goals.length);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.goalName.trim() || !form.deadline || !form.description.trim()) { setMessage('Add a name, deadline, and a short description to continue.'); return; }
    const goalData = { ...form, goalName: form.goalName.trim(), description: form.description.trim(), dailyHours: Number(form.dailyHours), skills: form.skills.split(',').map((skill) => skill.trim()).filter(Boolean) };
    if (!taskPlanPreview) {
      taskPlan.mutate(goalData, { onSuccess: (preview) => { setTaskPlanPreview(preview); setTaskDrafts(preview.tasks); setMessage(`${preview.message} Review the topic for each task before saving.`); }, onError: () => setMessage('Task suggestions are unavailable. Check the goal details and try again.') });
      return;
    }
    createGoal.mutate({ data: { ...goalData, confirmedTasks: taskDrafts } }, {
      onSuccess: (goal) => {
        void queryClient.invalidateQueries({ queryKey: ['study-analytics'] });
        setSelectedId(goal.id);
        setTaskPlanPreview(null);
        setTaskDrafts([]);
        setMessage('Goal created. Building your first route now…');
         setForm({ goalName: '', goalType: 'Exam preparation', deadline: '', dailyHours: String(defaultGoalDailyHours(profilePreferences)), priority: 'high', description: '', skills: '' });
        setFormOpen(false);
        void queryClient.invalidateQueries({ queryKey: getListGoalsQueryKey() });
        generateRoadmap.mutate({ goalId: goal.id }, { onSuccess: () => { setMessage(goal.taskGenerationMessage || 'Your first roadmap is ready.'); void queryClient.invalidateQueries({ queryKey: getGetRoadmapQueryKey(goal.id) }); }, onError: () => setMessage(`Goal saved. ${goal.taskGenerationMessage || 'Open Roadmap to generate your first route.'}`) });
      },
      onError: () => setMessage('We could not save that goal. Check the confirmed tasks and try again.'),
    });
  };
  return <div className="page-enter"><PageIntro eyebrow="Goal studio" title="Choose what deserves your attention." description="One clear goal creates a better plan. You can switch between goals anytime without losing their routes." action={<button type="button" onClick={() => setFormOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:-translate-y-0.5 transition-transform" data-testid="button-new-goal"><Plus size={16} /> New goal</button>} />
    {message && <div className="mb-5 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-4 py-3 text-xs font-bold text-primary" data-testid="status-goal-message"><Sparkles size={15} />{message}</div>}
    {formOpen && <section className="mb-6 rounded-2xl border border-primary/25 bg-card p-5 shadow-[0_12px_30px_hsl(var(--primary)/.05)] md:p-7" data-testid="section-goal-form"><div className="mb-6 flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">New route</p><h2 className="mt-1 font-serif text-2xl font-semibold">What are you working toward?</h2></div><button type="button" onClick={() => { setFormOpen(false); setTaskPlanPreview(null); setTaskDrafts([]); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" data-testid="button-close-goal-form"><X size={18} /></button></div><form onSubmit={submit} className="grid gap-5 md:grid-cols-2"><label className="md:col-span-2"><span className="field-label">Goal name</span><input value={form.goalName} onChange={(e) => updateForm({ ...form, goalName: e.target.value })} className="field" placeholder="e.g. Pass the GRE with confidence" data-testid="input-goal-name" /></label><label><span className="field-label">Goal type</span><select value={form.goalType} onChange={(e) => updateForm({ ...form, goalType: e.target.value })} className="field" data-testid="select-goal-type"><option>Exam preparation</option><option>Portfolio project</option><option>Certification</option><option>Course completion</option><option>Personal milestone</option></select></label><label><span className="field-label">Deadline</span><input type="date" value={form.deadline} onChange={(e) => updateForm({ ...form, deadline: e.target.value })} className="field" data-testid="input-deadline" /></label><label><span className="field-label">Daily hours</span><input type="number" min="0.5" step="0.5" value={form.dailyHours} onChange={(e) => updateForm({ ...form, dailyHours: e.target.value })} className="field" data-testid="input-daily-hours" /></label><label><span className="field-label">Priority</span><select value={form.priority} onChange={(e) => updateForm({ ...form, priority: e.target.value })} className="field" data-testid="select-priority"><option value="high">High — this matters now</option><option value="medium">Medium — steady progress</option><option value="low">Low — keep it warm</option></select></label><label className="md:col-span-2"><span className="field-label">Why this goal?</span><textarea value={form.description} onChange={(e) => updateForm({ ...form, description: e.target.value })} className="field min-h-[92px] resize-y" placeholder="Describe the outcome you want and what success looks like." data-testid="textarea-description" /></label><label className="md:col-span-2"><span className="field-label">Skills to practice <em>(comma separated)</em></span><input value={form.skills} onChange={(e) => updateForm({ ...form, skills: e.target.value })} className="field" placeholder="quantitative reasoning, vocabulary, timing" data-testid="input-skills" /></label>{taskPlanPreview && <section className="md:col-span-2 rounded-xl border border-primary/20 bg-secondary/40 p-4" data-testid="section-task-topic-review"><p className="text-sm font-bold">Review task topics before saving</p><p className="mt-1 text-xs text-muted-foreground">Each suggestion is limited to the skills you entered. Edit the task name or topic here; nothing is saved until you confirm.</p><div className="mt-3 space-y-2">{taskDrafts.map((task, index) => <div key={index} className="grid gap-2 rounded-lg bg-card p-3 sm:grid-cols-[1.3fr_1fr]"><label><span className="field-label">Task</span><input className="field" value={task.taskName} onChange={(event) => setTaskDrafts((drafts) => drafts.map((item, i) => i === index ? { ...item, taskName: event.target.value } : item))} data-testid={`input-task-name-${index}`} /></label><label><span className="field-label">Topic</span><select className="field" value={task.topic} onChange={(event) => setTaskDrafts((drafts) => drafts.map((item, i) => i === index ? { ...item, topic: event.target.value } : item))} data-testid={`select-task-topic-${index}`}>{(form.skills.split(',').map((value) => value.trim()).filter(Boolean).length ? form.skills.split(',').map((value) => value.trim()).filter(Boolean) : ['Uncategorized']).map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select></label><p className="text-[10px] text-muted-foreground sm:col-span-2">{task.durationHours} hours · {task.priority} priority · {task.difficulty} difficulty{task.dependsOn.length ? ` · depends on task ${task.dependsOn.map((dependency) => dependency + 1).join(', ')}` : ''}</p></div>)}</div></section>}<div className="flex items-center justify-end gap-3 md:col-span-2"><button type="button" onClick={() => { setFormOpen(false); setTaskPlanPreview(null); setTaskDrafts([]); }} className="rounded-lg px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-muted" data-testid="button-cancel-goal">Cancel</button><button type="submit" disabled={createGoal.isPending || generateRoadmap.isPending || taskPlan.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-goal">{createGoal.isPending || generateRoadmap.isPending || taskPlan.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {taskPlanPreview ? "Confirm topics & create goal" : "Preview task suggestions"}</button></div></form></section>}
    {isLoading ? <QuerySkeleton rows={2} /> : isError ? <QueryError retry={retry} /> : goals.length ? <div className="grid gap-4 md:grid-cols-2">{goals.map((goal) => <GoalCard key={goal.id} goal={goal} selected={goal.id === selectedId} onSelect={() => setSelectedId(goal.id)} onDelete={() => { setGoalToDelete(goal); setDeleteError(null); deleteGoal.reset(); }} />)}</div> : <EmptyGoal />}
    <AlertDialog open={!!goalToDelete} onOpenChange={(open) => { if (!open && !deleteGoal.isPending) setGoalToDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong className="text-foreground">{goalToDelete?.goalName}</strong> and its tasks, progress, milestones, and plan history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && <p role="alert" className="text-sm font-medium text-destructive">{deleteError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteGoal.isPending}>Cancel</AlertDialogCancel>
          <button type="button" disabled={deleteGoal.isPending || !goalToDelete} onClick={() => { if (goalToDelete) deleteGoal.mutate(goalToDelete); }} className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50" data-testid="button-confirm-delete-goal">
            {deleteGoal.isPending ? 'Deleting…' : 'Delete goal'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function RoadmapPage() {
  const { selectedGoal, isLoading } = useGoalsContext();
  if (isLoading) return <QuerySkeleton rows={3} />;
  if (!selectedGoal) return <><PageIntro eyebrow="Roadmap" title="Your route starts with a goal." /><EmptyGoal /></>;
  return <Suspense fallback={<QuerySkeleton rows={5} />}><SmartRoadmapPage goal={selectedGoal} /></Suspense>;
}

function LegacyRoadmapPage() {
  const { selectedGoal, selectedId, isLoading: goalsLoading } = useGoalsContext();
  const queryClient = useQueryClient();
  const roadmap = useGetRoadmap(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetRoadmapQueryKey(selectedId || 0) } });
  const replan = useReplanGoal();
  const [message, setMessage] = useState('');
  const [replanResult, setReplanResult] = useState<{ explanation: string; changedTaskNames: string[]; missedTaskName: string; changes: ReplanTaskChange[] } | null>(null);
  const [previewResult, setPreviewResult] = useState<AlternativePlanPreview | null>(null);
  const preview = useMutation({ mutationFn: (goalId: number) => customFetch<AlternativePlanPreview>(`/api/goals/${goalId}/preview-alternatives`, { method: 'POST' }) });
  useEffect(() => setPreviewResult(null), [selectedId]);
  if (goalsLoading || roadmap.isLoading) return <QuerySkeleton rows={3} />;
  if (!selectedGoal) return <><PageIntro eyebrow="Roadmap" title="Your route starts with a goal." /><EmptyGoal /></>;
  if (roadmap.isError) return <><PageIntro eyebrow="Roadmap" title={selectedGoal.goalName} /><QueryError retry={() => void roadmap.refetch()} /></>;
  const tasks = roadmap.data?.tasks || [];
  const grouped = tasks.reduce<Record<string, Task[]>>((acc, task) => { if (!task.scheduledDate) return acc; const date = String(task.scheduledDate).slice(0, 10); (acc[date] ||= []).push(task); return acc; }, {});
  const groupEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  return <div className="page-enter"><PageIntro eyebrow="Scheduled route" title="Your roadmap, one day at a time." description={roadmap.data?.generatedAt ? `Last mapped ${formatDate(roadmap.data.generatedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Complete the work or mark it missed — both signals help the plan get smarter.` : 'Your tasks are sequenced around your deadline and available study time.'} action={<button type="button" disabled={replan.isPending} onClick={() => replan.mutate({ goalId: selectedGoal.id }, { onSuccess: (result) => { setPreviewResult(null); setReplanResult(result); setMessage('Route updated around your latest signal.'); void queryClient.invalidateQueries({ queryKey: getGetRoadmapQueryKey(selectedGoal.id) }); void queryClient.invalidateQueries({ queryKey: getGetGoalProgressQueryKey(selectedGoal.id) }); }, onError: () => setMessage('Replanning is unavailable right now. Try again in a moment.') })} className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-card px-4 py-3 text-sm font-bold text-primary hover:bg-secondary disabled:opacity-60" data-testid="button-replan">{replan.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Replan remaining work</button>} />
    <div className="mb-5 flex justify-end"><button type="button" disabled={preview.isPending} onClick={() => preview.mutate(selectedGoal.id, { onSuccess: setPreviewResult, onError: () => setMessage('Plan previews are unavailable right now. Try again in a moment.') })} className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-card px-4 py-2.5 text-sm font-bold text-primary hover:bg-secondary disabled:opacity-60" data-testid="button-preview-plans">{preview.isPending ? <Loader2 size={15} className="animate-spin" /> : <Compass size={15} />} Compare plan options</button></div>
    {message && <div className="mb-5 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-4 py-3 text-xs font-bold text-primary" data-testid="status-roadmap-message"><CheckCircle2 size={15} />{message}</div>}
    {roadmap.data?.isFeasible === false && <section className="mb-6 rounded-2xl border border-destructive/35 bg-destructive/5 p-5" data-testid="card-deadline-infeasibility"><div className="flex items-start gap-3"><AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" /><div><h2 className="font-serif text-xl font-semibold">Some work will miss the deadline</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{roadmap.data.infeasibilityExplanation}</p><p className="mt-2 text-xs font-semibold">Unscheduled: {roadmap.data.unscheduledTaskNames.join(', ')}</p></div></div></section>}
    {previewResult && <section className="mb-6 rounded-2xl border border-primary/25 bg-card p-5 md:p-6" data-testid="section-plan-previews"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Temporary comparison</p><h2 className="font-serif text-xl font-semibold">Preview options for this goal</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">These schedules are previews only. Your saved roadmap and goal settings have not changed.</p></div><button type="button" onClick={() => setPreviewResult(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" data-testid="button-dismiss-previews"><X size={16} /></button></div><p className="mb-4 text-[11px] leading-5 text-muted-foreground">{previewResult.rankingMethod}</p>{!previewResult.hasFeasibleAlternative && <p className="mb-4 rounded-xl bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="status-no-feasible-alternative">{previewResult.plans.find((plan) => plan.scenario === 'current')?.feasible ? 'The current plan is feasible; none of the changed constraints produced another feasible option.' : 'None of the evaluated options fits all pending work. The scheduler lists the remaining unscheduled tasks below.'}</p>}<div className="grid gap-3 lg:grid-cols-3">{previewResult.plans.map((plan) => <article key={plan.scenario} className={`rounded-xl border p-4 ${plan.feasible ? 'border-border bg-background' : 'border-destructive/25 bg-destructive/[.03]'}`} data-testid={`card-plan-${plan.scenario}`}><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{plan.scenario === 'current' ? 'Current constraints' : plan.scenario === 'more_daily_time' ? 'More daily study time' : 'Deadline trade-off'}</p><h3 className="mt-1 font-serif text-lg font-semibold">{plan.feasible ? 'Feasible' : 'Does not fit'}</h3></div>{plan.rank !== null && <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] font-bold">Rank {plan.rank}</span>}</div><p className="mt-3 text-xs text-muted-foreground">{plan.dailyHours} hours/day · due {formatDate(plan.deadline, { month: 'short', day: 'numeric', year: 'numeric' })}{plan.deadlineExtensionDays ? ` · +${plan.deadlineExtensionDays} days` : ''}</p><p className="mt-1 text-xs text-muted-foreground">{plan.totalWorkloadHours} hours of pending work</p><p className="mt-3 text-xs font-semibold">{plan.changes.filter((change) => change.change !== 'unchanged').length} schedule changes from the saved dates</p>{plan.dailyWorkload.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Peak day: {Math.max(...plan.dailyWorkload.map((day) => day.hours))} of {plan.dailyHours} hours</p>}{plan.infeasibilityExplanation && <p className="mt-3 text-xs leading-5 text-destructive">{plan.infeasibilityExplanation}</p>}<div className="mt-3 space-y-1.5">{plan.changes.filter((change) => change.change !== 'unchanged').slice(0, 4).map((change) => <p key={change.taskId} className="text-[11px] text-muted-foreground">{change.change.replaceAll('_', ' ')}: {change.taskName}{change.scheduledDate ? ` · ${formatDate(change.scheduledDate, { month: 'short', day: 'numeric' })}` : ''}</p>)}</div>{plan.unscheduledTasks.length > 0 && <div className="mt-3 border-t border-border pt-3"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-destructive">Not scheduled</p>{plan.unscheduledTasks.map((task) => <p key={task.taskId} className="mt-1 text-[11px] text-muted-foreground">{task.taskName} · {task.reasonCode.replaceAll('_', ' ')}</p>)}</div>}</article>)}</div></section>}
    {replanResult && <section className="mb-6 rounded-2xl border border-accent/50 bg-accent/10 p-5 md:p-6" data-testid="card-replan-explanation"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><Sparkles size={17} /></span><div className="min-w-0"><div className="flex items-start justify-between gap-3"><h2 className="font-serif text-xl font-semibold">What changed</h2><button type="button" onClick={() => setReplanResult(null)} className="rounded-md p-1 text-muted-foreground hover:bg-card" data-testid="button-dismiss-replan"><X size={16} /></button></div><p className="mt-1 max-w-2xl text-sm leading-6 text-foreground/75">{replanResult.explanation}</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{replanResult.changes.filter((change) => change.change !== 'unchanged').map((change) => <div key={change.taskId} className="rounded-xl bg-card px-3 py-2.5"><p className="text-xs font-bold capitalize">{change.change.replaceAll('_', ' ')}: {change.taskName}</p><p className="mt-1 text-[10px] text-muted-foreground">{change.previousDate ? `${formatDate(change.previousDate, { month: 'short', day: 'numeric' })} â†’ ` : ''}{change.scheduledDate ? formatDate(change.scheduledDate, { month: 'short', day: 'numeric' }) : `not scheduled Â· ${change.reasonCode.replaceAll('_', ' ')}`}</p></div>)}</div></div></div></section>}
    {!tasks.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-14 text-center"><CalendarDays className="mx-auto text-primary" size={26} /><h2 className="mt-3 font-serif text-2xl font-semibold">Your route is being drawn.</h2><p className="mt-2 text-sm text-muted-foreground">Try generating the roadmap from your goal studio.</p></div> : <div className="space-y-7">{groupEntries.map(([date, dayTasks], index) => <section key={date} className="relative" data-testid={`section-roadmap-date-${date}`}><div className="mb-3 flex items-center gap-3"><span className={`grid size-9 place-items-center rounded-xl ${index === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'}`}><CalendarDays size={16} /></span><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">{index === 0 ? 'Next session' : `Day ${index + 1}`}</p><h2 className="font-serif text-xl font-semibold">{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div></div><div className="ml-4 space-y-2 border-l border-border pl-8">{dayTasks.map((task) => <div key={task.id} className="relative flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/35 md:flex-row md:items-center md:justify-between md:p-5"><span className={`absolute -left-[37px] top-6 size-2.5 rounded-full border-2 border-background ${task.status === 'completed' ? 'bg-emerald-600' : task.status === 'missed' ? 'bg-destructive' : 'bg-accent'}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{task.taskName}</h3><span className="rounded-full bg-secondary px-2 py-1 text-[9px] font-bold text-primary">{task.topic}</span><StatusPill status={task.status} /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[.06em] text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock3 size={12} />{task.durationHours} hours</span><span>{task.difficulty} difficulty</span><span className={task.priority === 'high' ? 'text-primary' : ''}>{task.priority} priority</span></div>{task.dependencyNames.length > 0 && <p className="mt-2 text-xs text-muted-foreground">After: {task.dependencyNames.join(', ')}</p>}</div><TaskActions task={task} onMessage={setMessage} /></div>)}</div></section>)}{tasks.some((task) => !task.scheduledDate) && <section className="rounded-2xl border border-border bg-card p-5" data-testid="section-unscheduled-tasks"><h2 className="font-serif text-xl font-semibold">Unscheduled before deadline</h2><div className="mt-3 space-y-2">{tasks.filter((task) => !task.scheduledDate).map((task) => <div key={task.id} className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 p-3"><div><p className="font-semibold">{task.taskName}</p><p className="text-xs text-muted-foreground">{task.topic} · {task.durationHours} estimated hours · {task.priority} priority</p></div><TaskActions task={task} onMessage={setMessage} /></div>)}</div></section>}</div>}
  </div>;
}

function ProgressPage() {
  return <div className="space-y-8"><Suspense fallback={<QuerySkeleton />}><StudyAnalyticsPage /></Suspense><details className="rounded-2xl border border-border bg-card p-5"><summary className="cursor-pointer font-serif text-2xl font-semibold text-primary">Selected goal: task estimates, milestones & plan history</summary><p className="mb-6 mt-3 text-sm text-muted-foreground">This task-only ledger is independent of the analytics date filter. Its estimated hours are not session records.</p><GoalProgressPage /></details></div>;
}

function GoalProgressPage() {
  const { selectedGoal, selectedId, isLoading: goalsLoading } = useGoalsContext();
  const queryClient = useQueryClient();
  const progress = useGetGoalProgress(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetGoalProgressQueryKey(selectedId || 0) } });
  const roadmap = useGetRoadmap(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetRoadmapQueryKey(selectedId || 0) } });
  const dashboard = useQuery({ queryKey: ['progressDashboard', selectedId], queryFn: () => customFetch<ProgressDashboard>(`/api/goals/${selectedId}/progress-dashboard`), enabled: !!selectedId });
  const dashboardCacheKey = ['progressDashboard', selectedId];
  const [milestoneEdits, setMilestoneEdits] = useState<Record<string, { title: string; targetDate: string }>>({});
  const confirmMilestone = useMutation({ mutationFn: (request: { goalId: number; title: string; targetDate: string | null; taskIds: number[] }) => customFetch<ConfirmedMilestone>(`/api/goals/${request.goalId}/milestones`, { method: 'POST', body: JSON.stringify({ title: request.title, targetDate: request.targetDate, taskIds: request.taskIds }) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: dashboardCacheKey }); } });
  if (goalsLoading || progress.isLoading || roadmap.isLoading) return <QuerySkeleton rows={4} />;
  if (!selectedGoal) return <><PageIntro eyebrow="Progress" title="Momentum needs a destination." /><EmptyGoal /></>;
  if (progress.isError || roadmap.isError) return <><PageIntro eyebrow="Progress" title="Your progress, made visible." /><QueryError retry={() => { void progress.refetch(); void roadmap.refetch(); }} /></>;
  const summary = progress.data;
  const tasks = roadmap.data?.tasks || [];
  const buckets = [{ label: 'Completed', value: summary?.completed || 0, color: 'bg-emerald-600', icon: CheckCircle2 }, { label: 'Pending', value: summary?.pending || 0, color: 'bg-accent', icon: CircleDashed }, { label: 'Missed', value: summary?.missed || 0, color: 'bg-destructive', icon: XCircle }];
  return <div className="page-enter"><PageIntro eyebrow="Progress ledger" title="See the distance you've covered." description="Progress is more than a percentage. This view shows the rhythm of your work, including the signals PathPilot uses to adjust the route." action={<Link href="/roadmap" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground" data-testid="link-progress-roadmap">Work the route <ArrowRight size={15} /></Link>} />
     <section className="grid gap-4 md:grid-cols-[1fr_1.35fr]"><div className="rounded-2xl bg-primary p-6 text-primary-foreground" data-testid="card-progress-summary"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/60">Average task completion</p><div className="mt-6 flex items-end gap-2"><span className="font-mono text-6xl font-bold tracking-[-.08em]">{Math.round(summary?.overallProgress || 0)}</span><span className="mb-2 text-2xl text-accent">%</span></div><ProgressBar value={summary?.overallProgress || 0} color="bg-accent" /><p className="mt-4 text-xs leading-5 text-primary-foreground/65">Each task contributes its saved completion percentage; recorded study time is tracked separately.</p></div><div className="grid gap-3 sm:grid-cols-3">{buckets.map(({ label, value, color, icon: Icon }) => <div key={label} className="rounded-2xl border border-border bg-card p-5" data-testid={`card-progress-${label.toLowerCase()}`}><div className="flex items-center justify-between"><span className={`grid size-9 place-items-center rounded-xl ${color}/15`}><Icon size={18} className={label === 'Completed' ? 'text-emerald-700' : label === 'Missed' ? 'text-destructive' : 'text-amber-700'} /></span><span className="font-mono text-3xl font-bold tracking-[-.06em]">{value}</span></div><p className="mt-8 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">{label}</p></div>)}</div></section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-7" data-testid="section-hours">
      <h2 className="font-serif text-2xl font-semibold">Task workload estimates</h2>
      <p className="mt-2 text-sm text-muted-foreground">{summary?.completedHours || 0} estimated hours on completed tasks / {summary?.totalHours || 0} estimated total hours. These are planning estimates, not recorded session durations.</p>
      <div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left text-xs text-muted-foreground">Current tasks for the selected goal</caption><thead><tr><th scope="col">Task</th><th scope="col">Estimated hours</th><th scope="col">Status</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} className="border-t border-border"><th scope="row" className="py-2 font-normal">{task.taskName}</th><td>{task.durationHours} h</td><td>{task.status}</td></tr>)}</tbody></table></div>
    </section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="section-weekly-progress">
      <div className="mb-4"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">UTC · Monday–Sunday</p><h2 className="mt-1 font-serif text-2xl font-semibold">Weekly task outcomes</h2><p className="mt-1 text-xs text-muted-foreground">Completed and missed counts come from progress events. Planned hours are snapshot estimates. Recorded session time appears in Study Analytics above.</p></div>
      {dashboard.isLoading ? <QuerySkeleton rows={2} /> : dashboard.isError ? <QueryError retry={() => void dashboard.refetch()} /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{dashboard.data?.weeks.map((week) => <article key={week.weekStart} className="rounded-xl border border-border p-4" data-testid={`card-week-${week.weekStart}`}><p className="font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">{String(week.weekStart).slice(0, 10)} – {String(week.weekEnd).slice(0, 10)}</p><p className="mt-3 font-serif text-2xl font-semibold">{week.completionPercent === null ? '—' : `${week.completionPercent}%`}</p><p className="text-[11px] text-muted-foreground">{week.hasProgressHistory ? `${week.completedTasks} completed · ${week.missedTasks} missed` : 'No recorded task events'}</p><p className="mt-3 text-[11px] text-muted-foreground">{week.hasPlanHistory ? `${week.plannedTaskCount} planned tasks · ${week.plannedHours === null ? 'estimate unavailable' : `${week.plannedHours} estimated h`}` : 'No plan snapshot for this week'}</p><p className="mt-1 text-[10px] text-muted-foreground">Rate: completed / (completed + missed) outcomes</p></article>)}</div>}
    </section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="section-topic-progress"><div className="mb-4"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Current task status</p><h2 className="mt-1 font-serif text-2xl font-semibold">Progress by topic</h2></div>{dashboard.data?.topics.length ? <div className="space-y-4">{dashboard.data.topics.map((topic) => <div key={topic.topic}><div className="flex justify-between gap-3 text-xs"><span className="font-semibold">{topic.topic}</span><span className="text-muted-foreground">{topic.completedTasks}/{topic.taskCount} complete · {topic.missedTasks} missed</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${topic.completionPercent}%` }} /></div></div>)}</div> : <p className="text-sm text-muted-foreground">Topic progress will appear when this goal has tasks.</p>}</section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="section-milestones"><div className="mb-4"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Goal checkpoints</p><h2 className="mt-1 font-serif text-2xl font-semibold">Milestones</h2><p className="mt-1 text-xs text-muted-foreground">Suggestions stay unconfirmed until you review and save them. A milestone completes when every associated task is complete.</p></div>{dashboard.data?.milestones.length ? <div className="grid gap-3 md:grid-cols-2">{dashboard.data.milestones.map((milestone) => { const edit = milestoneEdits[milestone.key] || { title: milestone.title, targetDate: milestone.targetDate || '' }; return <article key={milestone.key} className="rounded-xl border border-border p-4" data-testid={`card-milestone-${milestone.key}`}><div className="flex items-start justify-between gap-3"><div><p className="font-serif text-lg font-semibold">{milestone.confirmed ? milestone.title : edit.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{milestone.completed ? 'Complete' : `${milestone.completedTaskCount}/${milestone.taskCount} associated tasks complete`} · {milestone.confirmed ? 'Confirmed' : 'Suggestion'}</p></div>{milestone.confirmed && <CheckCircle2 size={18} className={milestone.completed ? 'text-emerald-700' : 'text-muted-foreground'} />}</div>{!milestone.confirmed && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px]"><label><span className="field-label">Milestone title</span><input className="field" value={edit.title} onChange={(event) => setMilestoneEdits((current) => ({ ...current, [milestone.key]: { ...edit, title: event.target.value } }))} /></label><label><span className="field-label">Target date</span><input className="field" type="date" value={edit.targetDate} onChange={(event) => setMilestoneEdits((current) => ({ ...current, [milestone.key]: { ...edit, targetDate: event.target.value } }))} /></label><button type="button" disabled={confirmMilestone.isPending || !edit.title.trim()} onClick={() => confirmMilestone.mutate({ goalId: selectedGoal.id, title: edit.title.trim(), targetDate: edit.targetDate || null, taskIds: milestone.taskIds })} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50 sm:col-span-2" data-testid={`button-confirm-${milestone.key}`}>Confirm milestone</button></div>}</article>; })}</div> : <p className="text-sm text-muted-foreground">No task-based milestone suggestions yet.</p>}{confirmMilestone.isError && <p className="mt-3 text-xs text-destructive">Could not save that milestone. Try again.</p>}</section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="section-plan-history"><div className="mb-4"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Saved roadmap versions</p><h2 className="mt-1 font-serif text-2xl font-semibold">Planned vs. completed</h2><p className="mt-1 text-xs text-muted-foreground">Task estimates and completion dates are separate from recorded study sessions. Earlier schedules cannot be reconstructed reliably.</p></div>{!dashboard.data?.timeline.length ? <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">No plan snapshots available for this goal.</p> : <div className="space-y-4">{dashboard.data.timeline.map((version) => <article key={version.planVersionId} className="rounded-xl border border-border p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-serif text-lg font-semibold">Plan version {version.version}</h3><span className="text-[10px] text-muted-foreground">Saved {formatDate(version.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>{version.tasks.map((task) => <div key={task.taskId} className="grid gap-1 border-t border-border py-2 text-xs sm:grid-cols-3"><span className="font-semibold">{task.taskName} · {task.topic}</span><span className="text-muted-foreground">Planned {task.plannedDate ? formatDate(task.plannedDate) : 'Unscheduled'} · {task.estimatedHours === null ? 'estimate unavailable' : task.estimatedHours + ' estimated h'}</span><span className={task.completedDate ? 'text-emerald-700' : 'text-muted-foreground'}>{task.completedDate ? `Completed ${formatDate(task.completedDate)}` : 'No completion record available'}</span></div>)}</article>)}</div>}</section>
  </div>;
}

function RecommendationsPage() {
  const { selectedGoal, selectedId, isLoading: goalsLoading, focusTaskId, setFocusTaskId } = useGoalsContext();
  const recommendations = useGetGoalRecommendations(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetGoalRecommendationsQueryKey(selectedId || 0) } });
  const roadmap = useGetRoadmap(selectedId || 0, { query: { enabled: !!selectedId, queryKey: getGetRoadmapQueryKey(selectedId || 0) } });
  const roadmapTasks = roadmap.data?.tasks || [];
  const selectedFocusTask = selectedId ? resolveFocusTask(roadmapTasks, focusTaskId, selectedId) : null;
  const focusInvalid = !!selectedId && !!roadmap.data && focusTaskId !== null && !selectedFocusTask;
  const [focusMessage, setFocusMessage] = useState('');
  useEffect(() => {
    if (focusInvalid) setFocusTaskId(null);
  }, [focusInvalid, setFocusTaskId]);
  useEffect(() => {
    if (focusInvalid) setFocusMessage('Your saved focus task is no longer pending in this goal, so it was cleared.');
  }, [focusInvalid]);
  if (goalsLoading || recommendations.isLoading) return <QuerySkeleton rows={4} />;
  if (!selectedGoal) return <><PageIntro eyebrow="Recommendations" title="The right next step starts with a goal." /><EmptyGoal /></>;
  if (recommendations.isError) return <><PageIntro eyebrow="Recommendations" title="A sharper next move." /><QueryError retry={() => void recommendations.refetch()} /></>;
  const recs = recommendations.data || [];
  return <div className="page-enter"><PageIntro eyebrow="Priority signals" title="A sharper next move." description="These suggestions are ranked from your route, dependencies, and current momentum. Pick one — not all of them." action={<div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-bold"><Sparkles size={15} className="text-accent-foreground" /><span>{recs.length} active signals</span></div>} />
    <p className="-mt-4 mb-5 text-[11px] text-muted-foreground">Your focus choice is saved for this account and goal on this browser. Choosing another task replaces it; completed, missed, or removed tasks are cleared.</p>
    {focusMessage && <p role="status" className="mb-4 rounded-lg border border-accent/40 bg-accent/15 px-4 py-3 text-xs font-semibold text-primary">{focusMessage}</p>}
    {recs.length ? <div className="space-y-3">{recs.map((rec, index) => { const canQueue = !!roadmap.data && roadmapTasks.some((task) => task.id === rec.task.id && task.goalId === selectedId && task.status === 'pending'); const queued = selectedFocusTask?.id === rec.task.id; return <article key={rec.task.id} className={`rounded-2xl border bg-card p-5 transition-all md:p-6 ${queued ? 'border-primary/35 bg-secondary/30' : 'border-border hover:border-primary/45'}`} data-testid={`card-recommendation-${rec.task.id}`}><div className="flex flex-col gap-5 md:flex-row md:items-center"><div className="flex items-start gap-4 md:w-[43%]"><span className={`grid size-10 shrink-0 place-items-center rounded-xl font-mono text-xs font-bold ${index === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'}`}>{String(index + 1).padStart(2, '0')}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl font-semibold">{rec.task.taskName}</h2>{index === 0 && <span className="rounded-full bg-accent px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[.08em] text-accent-foreground">Start here</span>}</div><p className="mt-1 text-xs text-muted-foreground">{rec.task.durationHours}h · {rec.task.difficulty} difficulty · {rec.task.priority} priority</p></div></div><div className="flex-1"><p className="text-sm leading-6 text-muted-foreground">{rec.reason}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, rec.score)}%` }} /></div></div><button type="button" disabled={!canQueue} onClick={() => setFocusTaskId(queued ? null : rec.task.id)} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${queued ? 'border border-border text-muted-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`} data-testid={`button-recommendation-${rec.task.id}`}>{queued ? <><Check size={14} /> Clear focus</> : <><ArrowRight size={14} /> Queue this next</>}</button></div></article>; })}</div> : <div className="rounded-2xl border border-dashed border-border bg-card p-14 text-center"><Lightbulb className="mx-auto text-accent-foreground" size={28} /><h2 className="mt-3 font-serif text-2xl font-semibold">No signals yet.</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Once your roadmap has tasks and a little activity, we'll surface the next most useful move.</p><Link href="/roadmap" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-recommendation-roadmap">Open roadmap <ArrowRight size={15} /></Link></div>}
  </div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AuthVisual() {
  return <div className="relative mx-auto mt-8 h-48 w-64" aria-hidden="true">
    <style>{`@keyframes pathpilot-orbit { from { transform: rotate(-18deg) translateY(0); } 50% { transform: rotate(-10deg) translateY(-7px); } to { transform: rotate(-18deg) translateY(0); } } @keyframes pathpilot-float { from { transform: translateY(5px) rotate(-14deg); } to { transform: translateY(-9px) rotate(-14deg); } } @media (prefers-reduced-motion: reduce) { .pathpilot-auth-orbit, .pathpilot-auth-plane { animation: none !important; } }`}</style>
    <div className="pathpilot-auth-orbit absolute left-1/2 top-1/2 h-36 w-60 -translate-x-1/2 -translate-y-1/2 rotate-[-16deg] rounded-[50%] border border-primary/20" style={{ animation: 'pathpilot-orbit 7s ease-in-out infinite' }} />
    <div className="absolute left-1/2 top-1/2 h-24 w-44 -translate-x-1/2 -translate-y-1/2 rotate-[18deg] rounded-[50%] border border-accent/45" />
    <div className="pathpilot-auth-plane absolute left-[51%] top-[28%] text-primary" style={{ animation: 'pathpilot-float 3.6s ease-in-out infinite alternate' }}><Plane size={32} strokeWidth={1.7} /></div>
    <span className="absolute left-[16%] top-[58%] size-2 rounded-full bg-accent" />
    <span className="absolute right-[13%] top-[22%] size-1.5 rounded-full bg-primary/45" />
  </div>;
}

function WelcomePage() {
  const [, setLocation] = useLocation();
  return <main className="min-h-[100dvh] overflow-hidden px-5 py-8 lg:px-12">
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1180px] flex-col rounded-[2rem] border border-border/80 bg-card/55 px-6 py-7 shadow-[0_24px_80px_hsl(var(--foreground)/.06)] md:px-10 lg:px-14">
      <header className="flex items-center justify-between">
        <button type="button" onClick={() => setLocation('/')} className="flex items-center gap-3 text-left" data-testid="link-welcome-brand">
          <span className="grid size-10 place-items-center rounded-[13px] bg-primary text-primary-foreground shadow-[0_7px_20px_hsl(var(--primary)/.25)]"><Compass size={22} strokeWidth={2.5} /></span>
          <span><span className="block font-serif text-[21px] font-semibold tracking-[-.03em]">PathPilot</span><span className="font-mono text-[9px] uppercase tracking-[.22em] text-muted-foreground">adaptive planning</span></span>
        </button>
        <button type="button" onClick={() => setLocation('/signin')} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="link-welcome-signin">Sign in</button>
      </header>
      <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.1fr_.9fr] lg:gap-16 lg:py-16">
        <section className="page-enter max-w-2xl">
          <p className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-accent" />A calmer way forward</p>
          <h1 className="font-serif text-[clamp(3rem,8vw,6.7rem)] font-semibold leading-[.88] tracking-[-.065em] text-foreground">Make progress feel <span className="text-primary">possible.</span></h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-muted-foreground md:text-lg">PathPilot turns an important goal into a clear, adaptive route — so you always know what to do next.</p>
          <button type="button" onClick={() => setLocation('/signin')} className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_10px_28px_hsl(var(--primary)/.2)] transition-transform hover:-translate-y-0.5" data-testid="button-get-started">Get started <ArrowRight size={16} /></button>
          <p className="mt-4 text-xs text-muted-foreground">A focused workspace for the next chapter.</p>
        </section>
        <section className="rounded-[2rem] border border-border bg-background/65 p-5 shadow-[0_18px_45px_hsl(var(--foreground)/.06)] md:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Your route, in view</p>
          <AuthVisual />
          <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"><div className="rounded-xl bg-secondary/70 p-3"><p className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">01</p><p className="mt-2 text-xs font-bold">Choose one goal</p></div><div className="rounded-xl bg-secondary/70 p-3"><p className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">02</p><p className="mt-2 text-xs font-bold">See the next step</p></div><div className="rounded-xl bg-secondary/70 p-3"><p className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">03</p><p className="mt-2 text-xs font-bold">Keep moving</p></div></div>
        </section>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><span>Plan with intention</span><span>Move at your pace</span><span>Adapt as you go</span></footer>
    </div>
  </main>;
}

function AuthLoading() {
  return <main className="grid min-h-[100dvh] place-items-center px-5"><div className="text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Compass size={24} /></span><p className="mt-4 font-serif text-xl font-semibold">Finding your route…</p><div className="mx-auto mt-4 h-1.5 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse rounded-full bg-accent" /></div></div></main>;
}

function AuthPage({ mode, onAuthenticated }: { mode: 'signin' | 'signup'; onAuthenticated: (session: AuthSession) => void }) {
  const [, setLocation] = useLocation();
  const isSignUp = mode === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const normalizedEmail = email.trim().toLowerCase();
    if (isSignUp && !name.trim()) { setError('Enter your full name to continue.'); return; }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Enter a valid email address.'); return; }
    if (!password) { setError('Enter your password to continue.'); return; }
    if (isSignUp && password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    setIsSubmitting(true);
    try {
      const session = isSignUp ? await signUp({ name: name.trim(), email: normalizedEmail, password }) : await signIn({ email: normalizedEmail, password, rememberMe });
      if (!session.authenticated || !session.user) throw new Error('Your account could not be verified. Please try again.');
      onAuthenticated(session);
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, isSignUp ? 'We could not create your account.' : 'We could not sign you in. Check your details and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return <main className="grid min-h-[100dvh] place-items-center px-5 py-8"><div className="w-full max-w-[980px] overflow-hidden rounded-[2rem] border border-border bg-card/75 shadow-[0_24px_80px_hsl(var(--foreground)/.08)] md:grid md:grid-cols-[.85fr_1.15fr]">
    <section className="hidden bg-primary p-8 text-primary-foreground md:block lg:p-10"><button type="button" onClick={() => setLocation('/')} className="flex items-center gap-3 text-left" data-testid="link-auth-brand"><span className="grid size-10 place-items-center rounded-[13px] bg-accent text-accent-foreground"><Compass size={22} /></span><span><span className="block font-serif text-[21px] font-semibold">PathPilot</span><span className="font-mono text-[9px] uppercase tracking-[.2em] text-primary-foreground/60">adaptive planning</span></span></button><div className="mt-20"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/60">{isSignUp ? 'Start with intention' : 'Welcome back'}</p><h1 className="mt-3 font-serif text-5xl font-semibold leading-[.95] tracking-[-.05em]">{isSignUp ? 'Give your next chapter a shape.' : 'Pick up where you left off.'}</h1><p className="mt-5 max-w-xs text-sm leading-6 text-primary-foreground/70">Your goals, route, and momentum stay in one focused workspace.</p></div><div className="mt-20 opacity-80"><AuthVisual /></div></section>
    <section className="p-6 md:p-10 lg:p-14"><div className="mb-8 flex items-center justify-between md:hidden"><button type="button" onClick={() => setLocation('/')} className="flex items-center gap-2 font-serif text-xl font-semibold"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Compass size={17} /></span>PathPilot</button><button type="button" onClick={() => setLocation('/')} className="text-xs font-bold text-muted-foreground">Back</button></div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">{isSignUp ? 'Create your account' : 'Sign in to your workspace'}</p><h2 className="mt-2 font-serif text-4xl font-semibold tracking-[-.045em]">{isSignUp ? 'Ready when you are.' : 'Good to see you.'}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{isSignUp ? 'Build a route that meets you where you are.' : 'Keep the next useful step visible.'}</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>{isSignUp && <label><span className="field-label">Full name</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name" data-testid="input-signup-name" /></label>}<label><span className="field-label">Email</span><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" data-testid="input-auth-email" /></label><label><span className="field-label">Password</span><span className="relative block"><input className="field pr-11" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignUp ? 'new-password' : 'current-password'} placeholder="Your password" data-testid="input-auth-password" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>{!isSignUp && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="size-4 accent-[hsl(var(--primary))]" data-testid="checkbox-remember-me" /> Remember me</label>}{error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive" data-testid="status-auth-error">{error}</p>}<button type="submit" disabled={isSubmitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_8px_22px_hsl(var(--primary)/.16)] transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60" data-testid="button-auth-submit">{isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}{isSignUp ? 'Create account' : 'Sign in'}</button></form>
      <p className="mt-7 text-center text-xs text-muted-foreground">{isSignUp ? 'Already have an account?' : 'New to PathPilot?'} <button type="button" onClick={() => setLocation(isSignUp ? '/signin' : '/signup')} className="font-bold text-primary hover:underline" data-testid="link-auth-switch">{isSignUp ? 'Sign in' : 'Sign up'}</button></p>
    </section>
  </div></main>;
}

function AuthenticatedRouter({ user, onLogout, onProfileUpdated }: { user: AuthUser; onLogout: () => void; onProfileUpdated: (profile: UserProfile) => void }) {
  return <GoalProvider userId={user.id}><AppShell user={user} onLogout={onLogout}><RoutedErrorBoundary><Switch><Route path="/" component={Dashboard} /><Route path="/goals" component={GoalsPage} /><Route path="/roadmap" component={RoadmapPage} /><Route path="/progress" component={ProgressPage} /><Route path="/recommendations" component={RecommendationsPage} /><Route path="/profile"><ProfilePage onProfileUpdated={onProfileUpdated} /></Route><Route component={NotFound} /></Switch></RoutedErrorBoundary></AppShell></GoalProvider>;
}

function AuthGate() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ['auth-session'], queryFn: getAuthSession, retry: false });
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    if (sessionQuery.data) setSession(sessionQuery.data);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (session?.authenticated && session.user && (location === '/signin' || location === '/signup')) setLocation('/');
  }, [location, session, setLocation]);

  useEffect(() => {
    if (!session?.authenticated && !sessionQuery.isLoading && location !== '/' && location !== '/signin' && location !== '/signup') setLocation('/signin');
  }, [location, session, sessionQuery.isLoading, setLocation]);

  const onAuthenticated = (nextSession: AuthSession) => {
    setSession(nextSession);
    queryClient.setQueryData(['auth-session'], nextSession);
    setLocation('/');
  };

  const onLogout = async () => {
    try { await signOut(); } catch { /* Clear the local session even if the server has already expired it. */ }
    queryClient.clear();
    setSession({ authenticated: false, user: null });
    setLocation('/');
  };

  if (sessionQuery.isLoading || (!session && !sessionQuery.isError)) return <AuthLoading />;
  if (session?.authenticated && session.user) {
    return <AuthenticatedRouter user={session.user} onLogout={() => void onLogout()} onProfileUpdated={(profile) => setSession((current) => current?.authenticated ? { authenticated: true, user: { id: profile.id, name: profile.name, email: profile.email } } : current)} />;
  }
  if (location === '/signin') return <AuthPage mode="signin" onAuthenticated={onAuthenticated} />;
  if (location === '/signup') return <AuthPage mode="signup" onAuthenticated={onAuthenticated} />;
  return <WelcomePage />;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AuthGate /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
