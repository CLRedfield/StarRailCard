import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, RotateCcw, Sparkles } from 'lucide-react';
import type { GameState } from '../game';
import { getLegalActions } from '../game';
import {
  advanceTutorial,
  getCoopCoachStep,
  getTutorialDiagnostic,
  getTutorialStep,
  restartTutorial,
  skipTutorial,
  updateTutorialProgress,
  type TutorialProgress,
} from '../lib/tutorial';
import './BattleTutorial.css';

const COOP_COACH_KEY = 'starrailcard.coop-coach-v1';

export interface BattleTutorialProps {
  state: GameState;
  playerId: string;
  progress?: TutorialProgress;
  onProgressChange?: (progress: TutorialProgress) => void;
  resolving?: boolean;
}

function loadCoopDismissed(): boolean {
  try {
    return window.localStorage.getItem(COOP_COACH_KEY) === 'done';
  } catch {
    return false;
  }
}

export default function BattleTutorial({ state, playerId, progress, onProgressChange, resolving = false }: BattleTutorialProps) {
  const [coopDismissed, setCoopDismissed] = useState(loadCoopDismissed);

  const isCoop = state.mode === 'coop';
  const updated = !isCoop && progress ? updateTutorialProgress(state, playerId, progress) : progress;

  useEffect(() => {
    if (!isCoop && progress && updated && updated !== progress && onProgressChange) {
      onProgressChange(updated);
    }
  }, [isCoop, updated, progress, onProgressChange]);

  const diag = getTutorialDiagnostic(state, playerId);

  if (isCoop) {
    const coopStep = getCoopCoachStep(state, playerId);
    if (!coopStep) return null;
    if (coopDismissed) {
      return (
        <div className="battle-tutorial-rest">
          <BookOpen size={13}/>
          <span>共斗指引已收起</span>
          <button
            onClick={() => {
              try { window.localStorage.removeItem(COOP_COACH_KEY); } catch { /* ignore */ }
              setCoopDismissed(false);
            }}
          >
            <RotateCcw size={12}/>重看共斗指引
          </button>
        </div>
      );
    }
    return (
      <aside className="battle-tutorial" data-active="true" data-target={resolving ? 'none' : coopStep.target} aria-label="双人共斗指引">
        <div className="tutorial-copy" aria-live="polite" aria-atomic="true">
          <div className="tutorial-heading">
            <span className="tutorial-number">{String(coopStep.number).padStart(2, '0')} / 03</span>
            <strong>{coopStep.title}</strong>
            <small>/ 双人共斗指引</small>
          </div>
          <p>{coopStep.text}</p>
          <div className="tutorial-chips">
            {state.phase === 'roll' && (
              <span className={`tutorial-chip ${diag.overSelected > 0 ? 'is-warn' : diag.remaining === 0 && diag.selectedCount > 0 ? 'is-ready' : ''}`}>
                {diag.statusLabel}
              </span>
            )}
            {diag.skillLabel && <span className="tutorial-chip skill"><Sparkles size={11}/>{diag.skillLabel}</span>}
          </div>
          <small className="tutorial-hint">{coopStep.hint}</small>
        </div>
        <div className="tutorial-controls">
          <button
            className="tutorial-skip"
            onClick={() => {
              try { window.localStorage.setItem(COOP_COACH_KEY, 'done'); } catch { /* ignore */ }
              setCoopDismissed(true);
            }}
          >
            收起指引
          </button>
        </div>
      </aside>
    );
  }

  if (!updated || !onProgressChange) return null;
  const step = getTutorialStep(state, playerId, updated);
  const legal = getLegalActions(state, playerId);
  const active = updated.status === 'active';
  if (!active) {
    return (
      <div className="battle-tutorial-rest">
        <BookOpen size={13}/>
        <span>{updated.status === 'completed' ? updated.attackConfirmed && updated.defenseConfirmed ? '基础教学已完成' : '教学已收起' : '教学已跳过'}</span>
        <button onClick={() => onProgressChange(restartTutorial(state, playerId))}><RotateCcw size={12}/>重看教学</button>
      </div>
    );
  }
  const showDiag = legal.canSelect && ['dice', 'reroll', 'confirm'].includes(step.target);
  return (
    <aside className="battle-tutorial" data-active="true" data-target={resolving ? 'none' : step.target} aria-label="新手教学">
      <div className="tutorial-copy" aria-live="polite" aria-atomic="true">
        <div className="tutorial-heading">
          <span className="tutorial-number">{String(step.number).padStart(2, '0')} / 08</span>
          <strong>{step.title}</strong>
          <small>/ 新手教学</small>
        </div>
        <p>{step.text}</p>
        <div className="tutorial-chips">
          {showDiag && (
            <span className={`tutorial-chip ${diag.overSelected > 0 ? 'is-warn' : legal.canConfirm ? 'is-ready' : ''}`}>
              {diag.statusLabel}
            </span>
          )}
          {diag.skillLabel && <span className="tutorial-chip skill"><Sparkles size={11}/>{diag.skillLabel}</span>}
        </div>
        <small className="tutorial-hint">{showDiag && diag.overSelected > 0 ? diag.tip : step.hint}</small>
      </div>
      <div className="tutorial-controls">
        {step.button && (
          <button className="tutorial-next" disabled={resolving} onClick={() => onProgressChange(advanceTutorial(state, playerId, updated))}>
            {step.button}<ArrowRight size={13}/>
          </button>
        )}
        <button className="tutorial-skip" onClick={() => onProgressChange(skipTutorial(updated))}>跳过教学</button>
      </div>
    </aside>
  );
}
