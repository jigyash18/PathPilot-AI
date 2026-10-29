import { Check, Target, Trash2 } from 'lucide-react';
import type { Goal } from '@workspace/api-client-react';
import { formatDate } from '@/lib/date-utils';

export function GoalCard({
  goal,
  selected,
  onSelect,
  onDelete,
}: {
  goal: Goal;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const formattedDeadline = formatDate(goal.deadline, { month: 'short', day: 'numeric' }, 'Due date unavailable — review goal data');

  return (
    <article className={`overflow-hidden rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_hsl(var(--foreground)/.06)] ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`} data-testid={`card-goal-${goal.id}`}>
      <button type="button" onClick={onSelect} className="block w-full p-5 text-left" data-testid={`button-select-goal-${goal.id}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className={`font-mono text-[9px] uppercase tracking-[.16em] ${selected ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{goal.goalType}</span>
            <h2 className="mt-2 font-serif text-2xl font-semibold leading-tight">{goal.goalName}</h2>
          </div>
          <span className={`grid size-9 place-items-center rounded-xl ${selected ? 'bg-primary-foreground/15' : 'bg-secondary text-primary'}`}>{selected ? <Check size={17} /> : <Target size={17} />}</span>
        </div>
        <p className={`mt-4 line-clamp-2 text-sm leading-5 ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{goal.description}</p>
        <div className={`mt-6 flex items-center justify-between border-t pt-4 text-xs ${selected ? 'border-primary-foreground/15 text-primary-foreground/70' : 'border-border text-muted-foreground'}`}>
           <span>{goal.overallProgress}% task completion</span>
          <span>Due {formattedDeadline}</span>
        </div>
        <div className={`mt-3 h-1.5 rounded-full ${selected ? 'bg-primary-foreground/15' : 'bg-muted'}`}>
          <div className={`h-full rounded-full ${selected ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${goal.overallProgress}%` }} />
        </div>
      </button>
      <div className={`flex justify-end border-t px-5 py-3 ${selected ? 'border-primary-foreground/15' : 'border-border'}`}>
        <button type="button" onClick={onDelete} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${selected ? 'text-primary-foreground hover:bg-primary-foreground/10' : 'text-destructive hover:bg-destructive/10'}`} data-testid={`button-delete-goal-${goal.id}`}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </article>
  );
}
