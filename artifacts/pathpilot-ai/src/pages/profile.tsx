import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, KeyRound, Loader2, Save, ShieldCheck, UserRound } from 'lucide-react';
import { getUserInitials } from '@/lib/auth';
import { formatDate } from '@/lib/date-utils';
import {
  changePassword,
  getProfile,
  getProfileError,
  updateProfile,
  updateStudyPreferences,
  type UserProfile,
} from '@/lib/profile';

type ProfilePageProps = {
  onProfileUpdated: (profile: UserProfile) => void;
};

type FieldErrors = Record<string, string>;

function readClientProfileErrors(name: string): FieldErrors {
  const trimmed = name.trim();
  if (!trimmed) return { name: 'Full name is required.' };
  if (trimmed.length > 120) return { name: 'Full name must be 120 characters or fewer.' };
  return {};
}

function readClientPreferenceErrors(preferences: UserProfile['preferences']): FieldErrors {
  const errors: FieldErrors = {};
  if (!Number.isFinite(preferences.availableHours) || preferences.availableHours < 0.5 || preferences.availableHours > 24) {
    errors.availableHours = 'Choose between 0.5 and 24 hours.';
  }
  if (!/^\d{2}:\d{2}$/.test(preferences.preferredStart)) errors.preferredStart = 'Use HH:MM format.';
  if (!/^\d{2}:\d{2}$/.test(preferences.preferredEnd)) errors.preferredEnd = 'Use HH:MM format.';
  if (!errors.preferredStart && !errors.preferredEnd && preferences.preferredStart >= preferences.preferredEnd) {
    errors.preferredEnd = 'End time must be after the start time. Overnight windows are not supported yet.';
  }
  return errors;
}

export default function ProfilePage({ onProfileUpdated }: ProfilePageProps) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const [name, setName] = useState('');
  const [preferences, setPreferences] = useState<UserProfile['preferences']>({ availableHours: 4, preferredStart: '09:00', preferredEnd: '18:00' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileErrors, setProfileErrors] = useState<FieldErrors>({});
  const [preferenceErrors, setPreferenceErrors] = useState<FieldErrors>({});
  const [passwordErrors, setPasswordErrors] = useState<FieldErrors>({});
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!profileQuery.data) return;
    setName(profileQuery.data.name);
    setPreferences(profileQuery.data.preferences);
  }, [profileQuery.data]);

  const saveProfile = useMutation({
    mutationFn: () => updateProfile({ name: name.trim() }),
    onSuccess: (profile) => {
      queryClient.setQueryData(['profile'], profile);
      onProfileUpdated(profile);
      setProfileErrors({});
      setProfileMessage('Profile details saved.');
    },
    onError: (error) => {
      const next = getProfileError(error, 'Could not save your profile.');
      setProfileErrors(next.field ? { [next.field]: next.message } : {});
      setProfileMessage(next.field ? null : next.message);
    },
  });

  const savePreferences = useMutation({
    mutationFn: () => updateStudyPreferences(preferences),
    onSuccess: (profile) => {
      queryClient.setQueryData(['profile'], profile);
      setPreferences(profile.preferences);
      setPreferenceErrors({});
      setPreferenceMessage('Study preferences saved. They will be the default for new goals.');
    },
    onError: (error) => {
      const next = getProfileError(error, 'Could not save your study preferences.');
      setPreferenceErrors(next.field ? { [next.field]: next.message } : {});
      setPreferenceMessage(next.field ? null : next.message);
    },
  });

  const savePassword = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword, confirmPassword }),
    onSuccess: (result) => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
      setPasswordMessage(result.message);
      queryClient.setQueryData(['auth-session'], { authenticated: true, user: result.user });
      onProfileUpdated({ ...(profileQuery.data as UserProfile), name: result.user.name, email: result.user.email });
    },
    onError: (error) => {
      const next = getProfileError(error, 'Could not change your password.');
      setPasswordErrors(next.field ? { [next.field]: next.message } : {});
      setPasswordMessage(next.field ? null : next.message);
    },
  });

  if (profileQuery.isLoading) {
    return <div className="space-y-4" data-testid="profile-loading"><div className="skeleton h-40 rounded-2xl" /><div className="skeleton h-64 rounded-2xl" /></div>;
  }
  if (profileQuery.isError || !profileQuery.data) {
    return <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center" data-testid="profile-error"><p className="font-serif text-xl font-semibold">Your profile could not be loaded.</p><p className="mt-2 text-sm text-muted-foreground">Try again without leaving your workspace.</p><button type="button" onClick={() => void profileQuery.refetch()} className="mt-5 rounded-lg border border-border bg-card px-4 py-2 text-xs font-bold hover:bg-muted" data-testid="button-profile-retry">Try again</button></div>;
  }

  const profile = profileQuery.data;
  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = readClientProfileErrors(name);
    setProfileErrors(errors);
    setProfileMessage(null);
    if (Object.keys(errors).length === 0) saveProfile.mutate();
  };
  const submitPreferences = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = readClientPreferenceErrors(preferences);
    setPreferenceErrors(errors);
    setPreferenceMessage(null);
    if (Object.keys(errors).length === 0) savePreferences.mutate();
  };
  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!currentPassword) errors.currentPassword = 'Current password is required.';
    if (newPassword.length < 8 || newPassword.length > 200) errors.newPassword = 'Use 8 to 200 characters.';
    if (newPassword !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    setPasswordErrors(errors);
    setPasswordMessage(null);
    if (Object.keys(errors).length === 0) savePassword.mutate();
  };

  return <div className="page-enter">
    <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-accent" />Personal workspace</p><h1 className="font-serif text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[.98] tracking-[-.045em]">Shape the way you study.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">Keep your identity and planning rhythm in one place. Changes apply to future planning unless you explicitly replan a goal.</p></div>
    </div>
    <section className="mb-5 flex flex-col gap-5 rounded-2xl bg-primary p-6 text-primary-foreground shadow-[0_18px_40px_hsl(var(--primary)/.18)] sm:flex-row sm:items-center sm:p-8" data-testid="card-profile-summary"><div className="grid size-16 shrink-0 place-items-center rounded-full bg-accent font-serif text-2xl font-semibold text-accent-foreground">{getUserInitials(profile)}</div><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/60">Your profile</p><h2 className="mt-1 font-serif text-3xl font-semibold">{profile.name}</h2><p className="mt-1 text-sm text-primary-foreground/70">{profile.email}</p></div></section>
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-5 md:p-7" data-testid="section-account-information"><div className="mb-6 flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><UserRound size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Account information</p><h2 className="mt-1 font-serif text-2xl font-semibold">How PathPilot knows you</h2></div></div><form onSubmit={submitProfile} className="space-y-4" noValidate><label className="block"><span className="field-label">Full name</span><input className={`field ${profileErrors.name ? 'border-destructive' : ''}`} value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setProfileErrors({}); setProfileMessage(null); }} autoComplete="name" aria-invalid={Boolean(profileErrors.name)} data-testid="input-profile-name" />{profileErrors.name && <span className="mt-1 block text-xs font-semibold text-destructive">{profileErrors.name}</span>}</label><label className="block"><span className="field-label">Email address</span><input className="field bg-muted/50" value={profile.email} readOnly aria-describedby="profile-email-note" data-testid="input-profile-email" /><span id="profile-email-note" className="mt-1 block text-xs text-muted-foreground">Email changes require a verified account-recovery flow and are not available here.</span></label><div className="rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Account created:</span> {profile.accountCreatedAt ? formatDate(profile.accountCreatedAt, { dateStyle: 'medium' }, 'Date unavailable in the current account record.') : 'Date unavailable in the current account record.'}</div>{profileMessage && <p className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-2.5 text-xs font-semibold text-primary" role="status">{profileMessage}</p>}<button type="submit" disabled={saveProfile.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-xs font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-profile">{saveProfile.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saveProfile.isPending ? 'Saving…' : 'Save profile'}</button></form></section>
      <section className="rounded-2xl border border-border bg-card p-5 md:p-7" data-testid="section-study-preferences"><div className="mb-6 flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Clock3 size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Study preferences</p><h2 className="mt-1 font-serif text-2xl font-semibold">Set your natural rhythm</h2></div></div><form onSubmit={submitPreferences} className="space-y-4" noValidate><label className="block"><span className="field-label">Daily study target <span className="font-normal normal-case tracking-normal text-muted-foreground">(hours)</span></span><input className={`field ${preferenceErrors.availableHours ? 'border-destructive' : ''}`} type="number" min="0.5" max="24" step="0.5" value={preferences.availableHours} onChange={(event) => setPreferences({ ...preferences, availableHours: Number(event.target.value) })} aria-invalid={Boolean(preferenceErrors.availableHours)} data-testid="input-preference-hours" />{preferenceErrors.availableHours && <span className="mt-1 block text-xs font-semibold text-destructive">{preferenceErrors.availableHours}</span>}</label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="field-label">Preferred start</span><input className={`field ${preferenceErrors.preferredStart ? 'border-destructive' : ''}`} type="time" value={preferences.preferredStart} onChange={(event) => setPreferences({ ...preferences, preferredStart: event.target.value })} aria-invalid={Boolean(preferenceErrors.preferredStart)} data-testid="input-preference-start" />{preferenceErrors.preferredStart && <span className="mt-1 block text-xs font-semibold text-destructive">{preferenceErrors.preferredStart}</span>}</label><label className="block"><span className="field-label">Preferred end</span><input className={`field ${preferenceErrors.preferredEnd ? 'border-destructive' : ''}`} type="time" value={preferences.preferredEnd} onChange={(event) => setPreferences({ ...preferences, preferredEnd: event.target.value })} aria-invalid={Boolean(preferenceErrors.preferredEnd)} data-testid="input-preference-end" />{preferenceErrors.preferredEnd && <span className="mt-1 block text-xs font-semibold text-destructive">{preferenceErrors.preferredEnd}</span>}</label></div><div className="rounded-xl bg-muted/50 p-4 text-xs leading-5 text-muted-foreground">The daily target becomes the default for new goals. Your current scheduler places work by day, so the saved time window is ready for future time-aware scheduling; it does not rewrite existing roadmaps.</div>{preferenceMessage && <p className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-2.5 text-xs font-semibold text-primary" role="status">{preferenceMessage}</p>}<button type="submit" disabled={savePreferences.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-xs font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-preferences">{savePreferences.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{savePreferences.isPending ? 'Saving…' : 'Save preferences'}</button></form></section>
    </div>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-7" data-testid="section-password-security"><div className="mb-6 flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><KeyRound size={18} /></span><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Password & security</p><h2 className="mt-1 font-serif text-2xl font-semibold">Keep your account protected</h2></div></div><form onSubmit={submitPassword} className="grid gap-4 md:grid-cols-3" noValidate><label className="block"><span className="field-label">Current password</span><input className={`field ${passwordErrors.currentPassword ? 'border-destructive' : ''}`} type="password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordErrors({}); setPasswordMessage(null); }} autoComplete="current-password" aria-invalid={Boolean(passwordErrors.currentPassword)} data-testid="input-current-password" />{passwordErrors.currentPassword && <span className="mt-1 block text-xs font-semibold text-destructive">{passwordErrors.currentPassword}</span>}</label><label className="block"><span className="field-label">New password</span><input className={`field ${passwordErrors.newPassword ? 'border-destructive' : ''}`} type="password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordErrors({}); setPasswordMessage(null); }} minLength={8} maxLength={200} autoComplete="new-password" aria-invalid={Boolean(passwordErrors.newPassword)} data-testid="input-new-password" />{passwordErrors.newPassword && <span className="mt-1 block text-xs font-semibold text-destructive">{passwordErrors.newPassword}</span>}</label><label className="block"><span className="field-label">Confirm new password</span><input className={`field ${passwordErrors.confirmPassword ? 'border-destructive' : ''}`} type="password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordErrors({}); setPasswordMessage(null); }} autoComplete="new-password" aria-invalid={Boolean(passwordErrors.confirmPassword)} data-testid="input-confirm-password" />{passwordErrors.confirmPassword && <span className="mt-1 block text-xs font-semibold text-destructive">{passwordErrors.confirmPassword}</span>}</label><div className="md:col-span-3 flex flex-col gap-3 rounded-xl bg-muted/50 p-4 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />Changing your password signs out every other session and keeps this browser signed in with a fresh secure session.</p><button type="submit" disabled={savePassword.isPending} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-xs font-bold text-primary-foreground disabled:opacity-60" data-testid="button-change-password">{savePassword.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}{savePassword.isPending ? 'Changing…' : 'Change password'}</button></div>{passwordMessage && <p className="md:col-span-3 rounded-lg border border-accent/40 bg-accent/15 px-3 py-2.5 text-xs font-semibold text-primary" role="status">{passwordMessage}</p>}</form></section>
  </div>;
}
